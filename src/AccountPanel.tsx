import { useEffect, useState } from 'react'
import { api } from './account'
import { resolveConflict } from './storage'
import type { Account } from './types'
import type { SyncStatus } from './sync'

export interface Credentials { username: string; password: string; ranked: boolean; importGuest: boolean; register: boolean }
interface Rank { id: string; username: string; rank: number; points: number; workouts: number; sets: number; bench: number }
interface Ranking { entries: Rank[]; me: Rank | null; updatedAt: string }
export function AccountPanel({ account, status, onAuthenticate, onLogout, onAccount, onSync, onDelete }: {
  account: Account | null; status: SyncStatus
  onAuthenticate: (credentials: Credentials) => Promise<void>
  onLogout: () => Promise<void>; onAccount: (account: Account) => void
  onSync: () => Promise<void>; onDelete: (password: string) => Promise<void>
}) {
  const [register, setRegister] = useState(false)
  const [username, setUsername] = useState(account?.username ?? '')
  const [password, setPassword] = useState('')
  const [ranked, setRanked] = useState(false)
  const [importGuest, setImportGuest] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [ranking, setRanking] = useState<Ranking | null>(null)
  const [rankingError, setRankingError] = useState('')
  const [reauth, setReauth] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  useEffect(() => {
    let alive = true
    if (!account) return
    api<Ranking>('/rankings').then(r => { if (alive) { setRanking(r); setRankingError('') } }).catch(() => { if (alive) setRankingError('Rankings are unavailable while disconnected.') })
    return () => { alive = false }
  }, [account, status.state])
  async function act(action: () => Promise<void>) {
    setBusy(true); setError('')
    try { await action() } catch (e) { setError(e instanceof Error ? e.message : 'Could not connect. Please try again.') } finally { setBusy(false) }
  }
  return <section className="account-panel" aria-label="Account and rankings">
    <h2 className="section-title">ACCOUNT</h2>
    {account && !reauth ? <>
      <div className="account-heading"><strong>{account.username}</strong><span>{status.pending ? `${status.pending} changes waiting` : status.message}</span></div>
      {status.pending > 0 && <p>Keep this device copy until syncing finishes.</p>}
      {status.state === 'error' && <><p role="status">{status.message}</p><button className="text-button" onClick={() => setReauth(true)}>Sign in again</button></>}
      <div className="account-actions"><button disabled={busy} onClick={() => act(onSync)}>Sync now</button><button disabled={busy} onClick={() => act(onLogout)}>Sign out</button></div>
      <label className="check-field"><input type="checkbox" checked={account.ranked} disabled={busy} onChange={e => { const next = e.target.checked; void act(async () => { const result = await api<{ user: Account }>('/account', 'PATCH', { ranked: next }); onAccount(result.user) }) }}/><span>Show my username and training totals in rankings</span></label>
    </> : <form onSubmit={e => { e.preventDefault(); void act(async () => { await onAuthenticate({ username, password, ranked, importGuest, register: register && !account }); setPassword(''); setReauth(false) }) }}>
      <p>Training saves on your device. Sign in to sync it between devices.</p>
      {!account && <div className="account-actions"><button type="button" aria-pressed={!register} onClick={() => setRegister(false)}>Sign in</button><button type="button" aria-pressed={register} onClick={() => setRegister(true)}>Create account</button></div>}
      <label className="field-label">Username<input autoComplete="username" required pattern="[A-Za-z0-9_]{3,24}" minLength={3} maxLength={24} value={username} onChange={e => setUsername(e.target.value)} spellCheck={false} autoCapitalize="none"/></label>
      <label className="field-label">Password<input type="password" autoComplete={register ? 'new-password' : 'current-password'} required minLength={12} maxLength={128} value={password} onChange={e => setPassword(e.target.value)}/></label>
      {register && <p className="muted">Use at least 12 characters. Save your password: email recovery is not available.</p>}
      {!account && <label className="check-field"><input type="checkbox" checked={importGuest} onChange={e => setImportGuest(e.target.checked)}/><span>Copy my guest workouts and programs into this account</span></label>}
      {register && <label className="check-field"><input type="checkbox" checked={ranked} onChange={e => setRanked(e.target.checked)}/><span>Join rankings with my username and training totals</span></label>}
      <button className="primary" disabled={busy}>{busy ? 'Connecting…' : register && !account ? 'Create account' : 'Sign in'}</button>
      {reauth && <button type="button" className="text-button" onClick={() => setReauth(false)}>Cancel</button>}
    </form>}
    {error && <p className="save-warning" role="alert">{error}</p>}
    {status.conflicts.map(conflict => <div className="conflict-card" key={conflict.key}>
      <h3>Two versions: {conflict.collection === 'workouts' ? 'workout' : conflict.collection}</h3>
      <p>Another device changed this record. Your version is still saved here. Both versions are included in your next export.</p>
      <div className="account-actions"><button disabled={busy} onClick={() => act(async () => { await resolveConflict(conflict, true); await onSync() })}>Keep this device</button><button disabled={busy} onClick={() => act(async () => { await resolveConflict(conflict, false); await onSync() })}>Use synced version</button></div>
    </div>)}
    <h2 className="section-title">RANKINGS</h2>
    <p>100 points per finished workout + 10 per completed working set, up to 30 sets per workout. Warm-ups and unfinished workouts do not count. Training is self-reported.</p>
    {!account ? <p>Sign in to see rankings. Joining is optional.</p> : <>
      {rankingError && <p role="status">{rankingError} {ranking ? 'Showing the last loaded results.' : ''}</p>}
      {ranking?.me && <p className="my-rank">YOUR RANK <strong>#{ranking.me.rank}</strong> · {ranking.me.points.toLocaleString()} points</p>}
      {ranking && ranking.entries.length > 0 ? <div className="rank-table"><table><caption>All-time training points</caption><thead><tr><th scope="col">Rank</th><th scope="col">Lifter</th><th scope="col">Workouts</th><th scope="col">Points</th></tr></thead><tbody>{ranking.entries.map(entry => <tr key={entry.id} className={entry.id === account.id ? 'own-rank' : ''}><td>{entry.rank}</td><th scope="row">{entry.username}</th><td>{entry.workouts}</td><td>{entry.points.toLocaleString()}</td></tr>)}</tbody></table></div> : !rankingError && <p>{ranking ? 'No lifters have joined yet.' : 'Loading rankings…'}</p>}
      <button className="text-button danger" onClick={() => setDeleting(v => !v)}>Delete account</button>
      {deleting && <form onSubmit={e => { e.preventDefault(); if (confirm('Permanently delete this account, its synced workouts, and this device’s account copy?')) void act(() => onDelete(deletePassword)) }}><p>Export your data first if you want to keep it. Other devices may retain offline copies.</p><label className="field-label">Confirm password<input type="password" autoComplete="current-password" required value={deletePassword} onChange={e => setDeletePassword(e.target.value)}/></label><button disabled={busy} className="primary">Permanently delete account</button></form>}
    </>}
  </section>
}
