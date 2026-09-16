import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from './App'
import { db, flushWrites, switchDatabase } from './storage'

beforeEach(async () => {
  localStorage.clear(); await switchDatabase(); await db.delete(); await switchDatabase()
  const settings = (await db.settings.get('settings'))!
  await db.settings.put({ ...settings, language: 'en', onboardingDone: true })
})
afterEach(async () => { cleanup(); await flushWrites(); await db.delete(); vi.restoreAllMocks() })
it('resumes the same exercise and inputs after the entire React app is destroyed and reopened', async () => {
  const first = render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'START WORKOUT' }))
  fireEvent.change(await screen.findByLabelText('Set 1 weight'), { target: { value: '82.5' } })
  fireEvent.change(screen.getByLabelText('Set 1 reps'), { target: { value: '9' } })
  fireEvent.click(screen.getAllByRole('button', { name: '✓' })[0]!)
  fireEvent.click(screen.getByRole('button', { name: 'NEXT →' }))
  fireEvent.change(screen.getByLabelText('Set 1 weight'), { target: { value: '24,' } })
  fireEvent.change(screen.getByLabelText('Set 1 reps'), { target: { value: '' } })
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved on this device'))
  const id = (await db.workouts.toArray())[0]!.id
  first.unmount(); db.close()
  render(<App />)
  expect(await screen.findByLabelText('Set 1 weight')).toHaveValue('24,')
  expect(screen.getByLabelText('Set 1 reps')).toHaveValue('')
  expect(screen.getByRole('button', { name: '← PREV' })).not.toBeDisabled()
  const restored = (await db.workouts.get(id))!
  expect(restored.exercises[0]!.sets[0]).toMatchObject({ weightKg: 82.5, reps: 9, completed: true })
  expect(restored.progress?.exerciseIndex).toBe(1)
  expect(restored.progress?.restEndsAt).toBeGreaterThan(Date.now())
  fireEvent.click(screen.getByRole('button', { name: 'Save & exit' }))
  fireEvent.click(await screen.findByRole('button', { name: /RESUME WORKOUT/ }))
  expect(screen.getByLabelText('Set 1 weight')).toHaveValue('24,')
  expect(await db.workouts.count()).toBe(1)
})
it('preserves a completed session and does not reopen it as active', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const first = render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'START WORKOUT' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Finish' }))
  await screen.findByText('SESSION COMPLETE')
  first.unmount(); render(<App />)
  await screen.findByRole('button', { name: 'START WORKOUT' })
  expect(screen.queryByRole('button', { name: /RESUME WORKOUT/ })).toBeNull()
  expect((await db.workouts.toArray())[0]?.finishedAt).toBeTruthy()
})

it('shows completed workout details in history after finishing and reopening', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const first = render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'START WORKOUT' }))
  fireEvent.change(await screen.findByLabelText('Set 1 weight'), { target: { value: '42.5' } })
  fireEvent.change(screen.getByLabelText('Set 1 reps'), { target: { value: '11' } })
  fireEvent.click(screen.getAllByRole('button', { name: '✓' })[0]!)
  fireEvent.click(screen.getByRole('button', { name: 'Finish' }))
  fireEvent.click(await screen.findByRole('button', { name: /View history/ }))
  expect(await screen.findByText('Workout log')).toBeVisible()
  expect(screen.getByText('42.5', { selector: 'td' })).toBeInTheDocument()
  const id = (await db.workouts.toArray())[0]!.id
  first.unmount(); render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: '04 History' }))
  const record = document.querySelector(`[data-workout-id="${id}"]`)!
  expect(record).toBeInTheDocument()
  expect(screen.getByText('42.5', { selector: 'td' })).toBeInTheDocument()
  expect(screen.getByText('11', { selector: 'td' })).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Search workouts or exercises'), { target: { value: 'does not exist' } })
  expect(screen.getByText('No workouts match these filters.')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
  expect(document.querySelector(`[data-workout-id="${id}"]`)).toBeInTheDocument()
})

it('shows next Wednesday exercises, keeps the selected plan on reload, and returns from exercise info to the calendar', async () => {
  const settings = (await db.settings.get('settings'))!
  await db.settings.put({ ...settings, scheduleStartDate: '2026-09-14', trainingDays: [5, 1, 3] })
  const first = render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: '03 Calendar' }))
  fireEvent.change(screen.getByLabelText('Go to date'), { target: { value: '2026-09-23' } })
  expect(screen.getByRole('heading', { name: 'Upper B · Back + Arms' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Lat Pulldown' }))
  fireEvent.click(screen.getByRole('button', { name: '← BACK' }))
  expect(screen.getByRole('heading', { name: 'Calendar' })).toBeVisible()
  expect(screen.getByLabelText('Go to date')).toHaveValue('2026-09-23')
  fireEvent.click(screen.getByRole('button', { name: '02 Programs' }))
  const programCard = screen.getByRole('heading', { name: 'Beginner Full Body' }).closest('article')!
  fireEvent.click(programCard.querySelector('.primary')!)
  expect(await screen.findByRole('heading', { name: 'Calendar' })).toBeVisible()
  await waitFor(async () => expect((await db.settings.get('settings'))?.activeProgramId).toBe('beginner-full'))
  first.unmount(); render(<App />)
  expect(await screen.findByText('Beginner Full Body', { selector: '.selected-plan strong' })).toBeVisible()
})
