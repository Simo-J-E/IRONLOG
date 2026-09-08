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
