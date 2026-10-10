import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AccountPanel } from './AccountPanel'
import { localStatus } from './sync'

afterEach(cleanup)

it('allows 1–50 characters for new usernames/passwords, slash usernames, and requires an email', () => {
  render(<AccountPanel
    account={null}
    status={localStatus}
    onAuthenticate={async () => {}}
    onLogout={async () => {}}
    onAccount={() => {}}
    onSync={async () => {}}
    onDelete={async () => {}}
  />)
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
  const username = screen.getByRole('textbox', { name: 'Username' }) as HTMLInputElement
  const email = screen.getByRole('textbox', { name: 'Email' }) as HTMLInputElement
  const password = screen.getByLabelText('Password') as HTMLInputElement
  expect(username.minLength).toBe(-1)
  expect(username.maxLength).toBe(50)
  expect(password.minLength).toBe(-1)
  expect(password.maxLength).toBe(50)
  expect(email.required).toBe(true)
  expect(email.type).toBe('email')
  fireEvent.change(username, { target: { value: 'a/b' } })
  expect(username.validity.patternMismatch).toBe(false)
  fireEvent.change(username, { target: { value: 'a' } })
  expect(username.validity.patternMismatch).toBe(false)
  fireEvent.change(email, { target: { value: 'not-an-email' } })
  expect(email.validity.typeMismatch).toBe(true)
  fireEvent.change(email, { target: { value: 'lifter@example.com' } })
  expect(email.validity.valid).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  expect(screen.getByRole('textbox', { name: 'Username or email' })).toBe(username)
})
