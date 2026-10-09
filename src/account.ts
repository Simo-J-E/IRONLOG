import type { Account } from './types'

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}
// Vite embeds this public URL at build time. Keep the backend URL in GitHub Actions variables.
const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')
const TOKEN_KEY = 'ironlog:session-token'
export function saveSessionToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}
export async function api<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
  const token = API_URL ? localStorage.getItem(TOKEN_KEY) : null
  const response = await fetch(`${API_URL}/api${path}`, {
    method,
    // The legacy local Node backend uses cookies; Cloudflare uses a bearer token
    // because third-party cookies fail on GitHub Pages -> workers.dev.
    credentials: API_URL ? 'omit' : 'same-origin',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'X-Ironlog-Client': '1',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(15000),
  })
  if (!response.headers.get('Content-Type')?.includes('application/json')) throw new ApiError('Accounts need the IRONLOG API. Offline training is ready to use.', 503)
  const result = await response.json()
  if (!response.ok) throw new ApiError(result.error || 'Could not connect. Your device copy is safe.', response.status)
  return result as T
}
const ACCOUNT_KEY = 'ironlog:account'
export function cachedAccount(): Account | null {
  try { const value = JSON.parse(localStorage.getItem(ACCOUNT_KEY) ?? 'null'); return value && typeof value.id === 'string' && /^[a-f0-9-]{36}$/.test(value.id) && typeof value.username === 'string' ? value : null } catch { return null }
}
export function cacheAccount(account: Account | null) {
  if (account) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account))
  else localStorage.removeItem(ACCOUNT_KEY)
}
