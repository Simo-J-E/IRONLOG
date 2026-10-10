# IRONLOG — free Cloudflare Workers + D1 backend

GitHub Pages continues hosting your React frontend. The Worker handles accounts, syncing and rankings; Cloudflare D1 stores the user and workout data. No computer needs to be on at home. All services have free usage limits.

## One-time setup

Requirements: Node.js 24+ and a free [Cloudflare account](https://dash.cloudflare.com/).

1. Extract the ZIP, open its `IRONLOG` folder in VS Code/PowerShell and run:

   ```powershell
   npm ci
   npx wrangler login
   ```

2. Edit **`cloudflare/wrangler.toml`**. Replace `https://YOUR-USERNAME.github.io` with your **actual frontend origin**, e.g. `https://example.github.io`. Do not include `/IRONLOG/` or a trailing `/`. If you use a custom GitHub Pages domain, put that origin instead. Keep `http://localhost:5173` as the second allowed origin for local testing.

3. Create a database on Cloudflare and connect it to the Worker:

   ```powershell
   npx wrangler d1 create ironlog-db --binding DB --update-config --config cloudflare/wrangler.toml --jurisdiction eu
   ```

   Wrangler adds a `[[d1_databases]]` block to `cloudflare/wrangler.toml`. If the command only prints the binding instead, paste the printed `binding`, `database_name` and `database_id` block into the same config file. Use `DB` as the binding name. The `--jurisdiction eu` option creates an EU-jurisdiction database (optional, remove it if you do not want this constraint).

4. Create the database tables:

   ```powershell
   npx wrangler d1 migrations apply DB --remote --config cloudflare/wrangler.toml
   ```

5. Deploy the backend:

   ```powershell
   npx wrangler deploy --config cloudflare/wrangler.toml
   ```

   The command prints an HTTPS URL similar to `https://ironlog-api.<your-subdomain>.workers.dev`. **Keep this URL.** Open `<that-URL>/api/health` in a browser. It should report `"database":"ok"`.

6. Open your GitHub repository → **Settings** → **Secrets and variables** → **Actions** → **Variables** → **New repository variable**. Add:

   - Name: `IRONLOG_API_URL`
   - Value: the **exact Worker HTTPS origin** printed above, with no `/api` and no trailing `/`.

7. Push this updated project to your existing GitHub repository. The included GitHub Actions workflow builds the frontend with `IRONLOG_API_URL` and publishes it to GitHub Pages.

8. Open your GitHub Pages website → **Profile → Account → Create account**. Guest workouts and custom training data on that device are automatically added to the account. After the account says **Synced to your account**, sign in on another device to test.

**Important:** A Worker deployment does not deploy the GitHub Pages frontend. Pushing the code to GitHub does that. GitHub Pages must be enabled in repository settings with source **GitHub Actions**.

## Updating an existing Cloudflare installation

**Do not create a new D1 database.** Keep the `database_id` of your existing D1 binding in `cloudflare/wrangler.toml`. Before updating, export a backup of your existing data, then run:

```powershell
npx wrangler d1 export ironlog-db --remote --output ironlog-pre-email-backup.sql --config cloudflare/wrangler.toml
npx wrangler d1 migrations apply DB --remote --config cloudflare/wrangler.toml
npx wrangler deploy --config cloudflare/wrangler.toml
```

Migration `0002_user_emails.sql` adds an optional email column and a unique email index without deleting old accounts or workouts. New accounts require an email; existing accounts still sign in by username and do not automatically gain an email address. Email is stored but **not verified and cannot be used for password recovery**. Existing long passwords remain valid for sign-in.

Then push the updated frontend to GitHub Pages. Deploying the Worker alone does not update the website.

## Local frontend + local Worker

Open two terminals from the project root. Apply the migration locally and start Wrangler:

```powershell
npx wrangler d1 migrations apply DB --local --config cloudflare/wrangler.toml
npx wrangler dev --config cloudflare/wrangler.toml
```

In the other terminal:

```powershell
'VITE_API_URL=http://localhost:8787' | Set-Content .env.local
npm run dev:client
```

Open `http://localhost:5173`. The local D1 database is separate from your remote production database. Remove `.env.local` (or update it) when you no longer need local development.

## Backups and security

- **Export your remote D1 backup regularly:**

  ```powershell
  npx wrangler d1 export ironlog-db --remote --output ironlog-backup.sql --config cloudflare/wrangler.toml
  ```

  Store backup files privately; they contain user information and password hashes. Do **not** commit them to your public GitHub repository. Cloudflare D1 also has Time Travel recovery, up to **7 days on the Free plan**.

- Login uses PBKDF2 password hashes, revocable 30-day session tokens, and exact-origin CORS. The GitHub Pages frontend stores its session token in browser local storage because cross-site cookies do not work reliably for `github.io` → `workers.dev`. Avoid third-party scripts or untrusted code in the frontend. Log out on shared devices.
- Registration now requires an email. Email verification and password resets are **not** implemented. Store your password safely. New username/password fields allow 1–50 characters; choose a long, unique password for security.
- Workers Free is limited (including 100,000 requests/day and 10 ms CPU/request); D1 also has daily database usage limits. A service can temporarily return errors if a quota is exceeded. Local device records remain usable offline.
- **Existing accounts on the old Node/SQLite backend do not automatically migrate.** Export your workouts from that old app before switching, then import them into your Cloudflare account.
- Updating or removing the Worker or database may stop syncing. Cloudflare stores your data while the database exists, but no provider promises 100% uptime. Keep independent exports.

## Troubleshooting

- **“D1 database is not bound”:** check that the config contains `[[d1_databases]]` with `binding = "DB"`.
- **“no such table”:** run the **remote** migration command in step 4.
- **CORS 403:** `ALLOWED_ORIGIN` is wrong. It must match `window.location.origin` on your GitHub Pages website *exactly*; deploy the Worker again.
- **The website returns HTML instead of API JSON:** GitHub Actions variable `IRONLOG_API_URL` wasn't set or the site wasn't rebuilt; set the variable, push a new commit and redeploy GitHub Pages.
- **Sync shows unauthorized:** sign in again. Cached workouts remain on your device.
- **Cloudflare test:** `npm run test:cloudflare` verifies auth, sync, conflict responses, rankings, logout, deletion and CORS using a SQLite D1-compatible test adapter. It does not replace checking your deployed Worker.
