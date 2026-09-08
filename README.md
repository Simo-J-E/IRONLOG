# IRONLOG

Offline workout tracker with optional accounts, sync and automatic rankings. React + TypeScript + IndexedDB; a small Node.js 24 server with SQLite. The existing training programs and visual style are retained.

## Start locally

Install **Node.js 24.13 or newer**, then run:

```bash
npm ci
npm run dev
```

Open the Vite address printed in the terminal, normally `http://localhost:5173`. This starts the frontend and backend together. In **Profile → Account**, create an account or sign in. Select **Copy my guest workouts** to bring existing local training into your account. Account creation needs no API keys or external authentication service.

To run a built version:

```bash
npm run build
npm start
```

Open `http://localhost:3001`. Keep using the same browser and website address: browser data is separate for each origin.

## What changed

- Each input is saved immediately. A synchronous recovery journal protects changes while IndexedDB writes are still pending.
- Reopening automatically resumes the unfinished workout, exercise position, weights, reps, completed sets and partially typed numbers.
- **Save & exit** keeps a workout open. **Resume workout** returns to it. Existing unfinished workouts from version 1 are recovered too.
- Rest timers use an absolute deadline, so switching apps or suspending the browser does not pause their countdown.
- The workout keeps its original program snapshot even if the selected program or day changes.
- The offline installation caches the actual JavaScript and CSS, not only the HTML. API responses are never cached. Updates wait until old tabs close.
- Guest data and each account use separate local databases. Training continues offline after signing in once.
- Signed-in changes are queued locally, then synced after edits, reconnecting, returning to the app, and every 15 seconds while visible. Check **Profile** for sync status.
- Concurrent device edits produce a choice between the device and synced versions. Nothing is silently replaced while a record has local changes. The discarded version remains in the next JSON export under `conflictBackups`; unresolved versions are in `unresolvedConflicts`.
- Import validates the whole backup before writing and merges records by ID. Unrelated workouts are retained.
- Local save failures are visible. If storage is unavailable, **Export data** can still download the current in-memory workout and recovery copies; such a backup is marked `partial` if older records could not be read.

## Rankings

Participation is optional. Enable it when creating an account or in Profile. The leaderboard shows usernames, workout counts and points, and updates after sync.

- 100 points for a finished workout containing at least one completed working set.
- 10 additional points per completed working set, up to 30 sets per workout.
- Warm-ups, unfinished workouts and zero-rep sets earn no points.
- Equal points share a rank. Scores are calculated by the server from stored sets. Retrying a sync does not add points twice.
- These are self-reported training points, not a verified competition or a strength comparison.

## GitHub Pages

The included workflow still validates and deploys the frontend on pushes to `main`. Set **Settings → Pages → Source → GitHub Actions**. The lockfile is included, so CI uses `npm ci`.

**GitHub Pages runs the offline frontend only. Accounts, sync and shared rankings require the included backend.** The full version serves the frontend and API from the same origin; it deliberately does not rely on third-party cookies or browser-stored authentication tokens.

For an existing Pages installation, upload these source files to the same repository and URL. Do not clear site data. The database upgrades in place. If moving to a different address, export on the old address and import on the new one. Close old app tabs once after deployment to activate the updated offline worker.

## Deploy the full version

Use a Node-capable host with a persistent disk, or Docker on your server. Put the application behind an HTTPS reverse proxy. SQLite is stored in `data/ironlog.sqlite`; it must survive restarts and redeployments. Run one application instance against this local disk.

Docker setup:

1. Copy `.env.example` to `.env`.
2. Set `PUBLIC_ORIGIN` to your exact HTTPS origin, for example `https://training.example.com`, without a trailing slash.
3. Run `docker compose up -d --build`.
4. Point your HTTPS reverse proxy to `127.0.0.1:3001`.

For example, an existing Caddy server can use:

```caddyfile
training.example.com {
    reverse_proxy 127.0.0.1:3001
}
```

Docker stores the database in the `ironlog-data` named volume. Keep that volume when updating the app. No backend is deployed automatically by the Pages workflow.

Without Docker, build the frontend, configure `.env`, then run:

```bash
node --env-file=.env server/index.mjs
```

In production, `NODE_ENV=production` and an HTTPS `PUBLIC_ORIGIN` are required. The server uses Secure, HttpOnly, SameSite cookies; salted scrypt password hashes; expiring sessions; origin checks; request limits; parameterized queries; and per-account authorization. Passwords must contain 12–128 characters. Email verification and password recovery are not included, so save your password.

## Backups and deletion

Use **Profile → Export my data** for a portable JSON copy, including an active workout. Keep occasional copies outside the browser. Browser storage requests cannot prevent someone clearing website data, uninstalling the browser, or every form of storage eviction. Account sync provides a second copy once its status says **Synced to your account**.

For a consistent SQLite backup while the Node server is running:

```bash
npm run backup -- backups/ironlog.sqlite
```

Set `DATABASE_PATH` when using a different database path. Keep server backups outside the application disk as well. The server backup includes accounts and password hashes; keep it private. Restore with the server stopped.

Signing out keeps that account’s local copy for offline recovery; it never becomes guest data or another account’s data. Profile offers both training-data deletion and password-confirmed account deletion. Account deletion removes the server account and its records plus this browser’s account copy. Other devices may retain offline copies until their website data is cleared.

## Validation

```bash
npm run check
```

This runs lint, TypeScript, storage/recovery/sync and React regression tests, real HTTP + SQLite backend tests, and the production build. The backend tests cover authentication, origin checks, account separation, retries, ranking calculations, conflict rejection, atomic invalid-batch rejection, deletion, and restart persistence. Tests use temporary databases.

The existing mobile Playwright smoke test remains available:

```bash
npx playwright install chromium
npm run test:e2e
```

## Implementation references

- [Node.js SQLite](https://nodejs.org/api/sqlite.html)
- [Node.js crypto](https://nodejs.org/api/crypto.html)
- [MDN: visibility and mobile unload limitations](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event)

The updated project is provided as source code. Hosting credentials, account data, local databases and Git history are excluded from the ZIP.
