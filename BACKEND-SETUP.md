# IRONLOG backend setup

IRONLOG already contains a Node.js API, user accounts and a SQLite database. **GitHub Pages only serves the frontend**: it cannot execute this API or persist its SQLite file. To get cloud sync, serve **both** the built app and `/api/*` from the same HTTPS domain using the backend below.

## 1. Test it on your computer

Requires Node.js **24.13 or newer**.

```sh
npm ci
npm run dev
```

Visit `http://localhost:5173`. Open **Profile → Account → Create account**, choose a username and a strong password; existing guest workouts and custom plans on the device are added automatically. Wait for **Synced to your account** in Profile. Data goes into `data/ironlog.sqlite`; don't delete that directory.

You can test recovery: record a workout, wait for sync, open the site in a second browser, sign into the same account and check History. You must keep the server running for sync to work.

## 2. Deploy online (Docker + automatic HTTPS)

On an always-on computer or VPS with Docker Compose:

1. Point a DNS hostname (e.g. `ironlog.example.com`) to the server's public IP. Allow incoming TCP ports **80** and **443**, and forward them from your router if self-hosting. This may require a public, non-CGNAT IP.
2. Copy `.env.example` to `.env` and edit these lines:
   ```dotenv
   PUBLIC_ORIGIN=https://ironlog.example.com
   IRONLOG_DOMAIN=ironlog.example.com
   ```
3. Start the website, backend, SQLite and HTTPS reverse proxy:
   ```sh
   docker compose -f compose.yaml -f compose.public.yaml up -d --build
   ```
4. Visit your **HTTPS** URL, register or sign in, automatically merge any device workouts, and wait for **Synced to your account**. You can now sign into the same account from another phone or computer.

Caddy automatically requests and renews the HTTPS certificate. Use the optional `compose.public.yaml` only if **nothing else occupies ports 80/443**. If you already use a reverse proxy, use just `docker compose up -d --build` and forward your HTTPS hostname to `127.0.0.1:3001` (the original `compose.yaml` file).

Check server health with `docker compose -f compose.yaml -f compose.public.yaml ps` and `curl https://ironlog.example.com/api/health`. A healthy API returns `database: "ok"`.

**Do not deploy just the `dist/` folder to GitHub Pages and expect online accounts to work.** GitHub Pages cannot connect to the same-origin `/api` unless the site itself is served from the backend host as described above. Running this on your PC makes sync unavailable whenever the PC is off; previously synced and local workouts remain saved.

## 3. Backups and disaster recovery

The SQLite file lives in the Docker volume `ironlog-data`, which survives restarting and rebuilding containers. Never run `docker compose down -v` unless you intend to delete all server data.

In production IRONLOG also creates a consistent database snapshot every **6 hours**, plus an early snapshot after startup, keeping **28** copies in `/app/data/backups/`. Configure `BACKUP_INTERVAL_HOURS` and `BACKUP_KEEP` in `.env` (set hours to `0` to disable automatic backups). These protect against some accidental data corruption/deletion, but **not** losing the entire server/disk/volume. Copy them to another disk or private storage regularly:

```sh
docker compose cp ironlog:/app/data/backups ./ironlog-backups
```

These database copies contain private workout history and password hashes. Never upload them to a public repo. You can also use **Profile → Export my data** for a portable workout JSON file, and **Import data** to restore it later.

To restore a SQLite snapshot, **stop the server**, copy your chosen snapshot to the SQLite database path (`/app/data/ironlog.sqlite` inside the volume) with appropriate permissions, then start the server again. Because this replaces the entire database, it also rolls back accounts, sessions and changes made since that snapshot. Back up the current file before replacing it. The SQLite `backup` API is used to create snapshots safely even while the server is online; do not copy a live `ironlog.sqlite` file directly without its WAL.

For a manual snapshot when running without Docker:

```sh
npm run backup -- backups/my-backup.sqlite
```

For a manual snapshot *inside* the Docker container (the `backup.mjs` script is included):

```sh
docker compose exec ironlog node scripts/backup.mjs /app/data/backups/manual.sqlite
```

## 4. Important details

- **Account sync is not instant on every keystroke.** Changes are queued locally, then synced in the background and retried after reconnection. Only **Synced to your account** confirms the cloud copy is up to date.
- Export a backup from your old website **before switching hostnames**; browser local data is tied to the website address. Import it on the new site and then sync.
- No password-reset email system is included; keep your password safe.
- Keep the service up, use HTTPS, and keep off-site backups. The backend only stores data on the computer/VPS where you run it—there is no hosted database until you actually deploy it.
