# IRONLOG account update (email + 50-character limits)

- New username: 1–50 characters. Letters, numbers, `_`, and `/` allowed.
- New password: 1–50 characters. Choose a strong password, ideally 12+ characters even though the form does not enforce a minimum.
- New email address: required (must be a valid email format, up to 254 characters).
- Sign in: by username **or** email plus password. Existing accounts with no email still work. Existing longer passwords continue to work for sign-in.
- Email is stored, but not verified. Sending recovery emails and resetting passwords are **not implemented**.
- Accounts and workout data are not deleted or reset by this change.

## Update an existing Cloudflare + D1 deployment

**Use your existing Cloudflare D1 database. Never create a new one for this update.**

1. Backup your production database:

   ```powershell
   npx wrangler d1 export ironlog-db --remote --output ironlog-pre-email-backup.sql --config cloudflare/wrangler.toml
   ```

2. Add the email column to D1 (migration `0002_user_emails.sql`):

   ```powershell
   npx wrangler d1 migrations apply DB --remote --config cloudflare/wrangler.toml
   ```

3. Deploy the updated Cloudflare backend:

   ```powershell
   npx wrangler deploy --config cloudflare/wrangler.toml
   ```

4. Commit/push the updated frontend and Worker code to GitHub so your GitHub Pages website is rebuilt. Verify the account form and try logging in with email.

Keep the existing `[[d1_databases]]` section and `database_id` in `cloudflare/wrangler.toml`. The updated full ZIP contains the original existing binding reported for your installation.

## Run the full checks locally (Node.js 24.13+)

```powershell
npm ci
npm run check
npm run test:e2e
```
