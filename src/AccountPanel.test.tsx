import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AccountPanel } from './AccountPanel'
import { localStatus } from './sync'

afterEach(cleanup)

it('allows a slash in usernames, requires 4 characters at signup, but lets existing 3-character users log in', () => {
  render(<AccountPanel
    account={null}
    status={localStatus}
    onAuthenticate={async () => {}}
    onLogout={async () => {}}
    onAccount={() => {}}
    onSync={async () => {}}
    onDelete={async () => {}}
  />)
  const username = screen.getByRole('textbox', { name: 'Username' }) as HTMLInputElement
  expect(username.minLength).toBe(3)
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
  expect(username.minLength).toBe(4)
  fireEvent.change(username, { target: { value: 'ab/c' } })
  expect(username.validity.patternMismatch).toBe(false)
  fireEvent.change(username, { target: { value: 'abc' } })
  expect(username.validity.tooShort || username.validity.patternMismatch).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  expect(username.minLength).toBe(3)
  expect(username.validity.patternMismatch).toBe(false)
})
