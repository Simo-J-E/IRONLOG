# IRONLOG

Offline workout tracker with optional accounts, sync and automatic rankings. React + TypeScript + IndexedDB; a small Node.js 24 server with SQLite. Includes a workout calendar, complete session history and a three-day chest, back and arms plan.

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

## Calendar and workout history (2.1)

- **Today** shows the selected plan, next scheduled workout with all exercises, and the next three training dates. Tap a date to open it in the calendar.
- **Programs** opens the selected plan in full. Each session lists its exercises, primary muscles, sets, rep targets and rest times. Other programs can be previewed before selection.
- **Calendar** shows a month at a time. Tap a day or use **Go to date** to see exactly what is scheduled, including future Wednesdays. A/B/C refer to the sessions in the legend. Completed and unfinished workouts are marked separately.
- Open **Training days** in the calendar to change weekdays. Monday/Wednesday/Friday is the default. Days always use Monday-to-Sunday order, regardless of the order you tapped them.
- Workouts rotate continuously across the chosen days. For example, a two-session A/B plan on three weekly days alternates A/B/A then B/A/B. Missing a workout does not shift future dates.
- Changing the plan or weekdays restarts the rotation from Monday of the current week, with planned dates shown from the day of the change onward. Old completed and unfinished records remain visible on their actual training dates. Earlier planned schedules are not archived.
- On rest days, Today previews the next scheduled session. Starting it early, or doing a missed session from the calendar, records it on the date you actually train. It does not mark a future date complete. Future dates in the calendar are previews.
- **History** now lists every saved session, newest first, including unfinished sessions. Expand one to see the date, duration, exercises, every set's weight/reps, warm-ups, completion status and notes. Search by workout/exercise name or filter by dates. Only completed working sets contribute to volume. Units follow your profile.
- **Finish → View history** opens your completed workout log directly. **Save & exit** leaves a session unfinished; use **Resume workout** to continue.
- Existing browser data upgrades in place. The previous built-in Chest + Arms Growth plan becomes **Chest, Back + Arms**. Custom plans, saved sessions and active workout snapshots are preserved. Other selected plans remain selected.

### Recommended plan

Default schedule, about 50–65 minutes per session:

| Day | Session | Exercises (sets × reps) |
| --- | --- | --- |
| Monday | Upper A · Chest + Back | Bench press 3×6–10; seated row 3×8–12; incline dumbbell press 2×8–12; dumbbell curl 3×8–12; pushdown 3×10–15; lateral raise 2×12–15 |
| Wednesday | Upper B · Back + Arms | Lat pulldown 3×8–12; chest press 3×8–12; chest supported row 2×8–12; hammer curl 3×8–12; overhead triceps extension 3×10–15; rear delt fly 2×12–15 |
| Friday | Upper C · Chest + Arms | Incline dumbbell press 3×8–12; seated row 3×8–12; cable fly 2×10–15; lat pulldown 2×8–12; EZ-bar curl 2×8–12; pushdown 2×10–15 |

Warm up before working sets. Choose weights you can control, leave about 1–2 reps in reserve, and increase the weight gradually when you reach the top of the rep range with good form. This is the requested upper-body routine. Exact exercises and sets are an app template, not an ACSM-prescribed routine. General programming reference: [ACSM resistance training guidance (2026)](https://acsm.org/resistance-training-guidelines-update-2026/).

## Existing workout saving and accounts

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

The Playwright tests cover onboarding, mobile logging, calendar previews, changing weekdays, plan selection, history after reload, and narrow/desktop layouts:

```bash
npx playwright install chromium
npm run test:e2e
```

## Implementation references

- [Node.js SQLite](https://nodejs.org/api/sqlite.html)
- [Node.js crypto](https://nodejs.org/api/crypto.html)
- [MDN: visibility and mobile unload limitations](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event)

The updated project is provided as source code. Hosting credentials, account data, local databases and Git history are excluded from the ZIP.
