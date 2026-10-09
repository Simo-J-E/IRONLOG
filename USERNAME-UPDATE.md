# IRONLOG username update

New account usernames require **4–24 characters**, using letters, numbers, `_` and `/`.
For example, `simo/1234` is valid. Existing 3-character usernames may still **sign in**, but cannot be newly registered.
Passwords are unchanged. This update does **not** migrate, delete or reset existing accounts or workouts.

## Deploy with the existing GitHub Pages and Cloudflare D1 setup

1. Copy `src/AccountPanel.tsx` and `cloudflare/worker.mjs` into your IRONLOG repository, replacing the older files. (`server/index.mjs` was also updated if you run the local Node backend.)
2. From your project root, deploy the Worker:

   ```powershell
   npx wrangler deploy --config cloudflare/wrangler.toml
   ```

3. Commit and push the changes to GitHub. The existing Pages workflow will rebuild your website.
4. Refresh your GitHub Pages site, then open **Profile → Account → Create account** to try the new username rules.

**Use your existing `cloudflare/wrangler.toml`** if you already configured D1; don't run `wrangler d1 create` again. The full ZIP supplied here includes the D1 binding and origin from your earlier deployment, but using only the changed code files is safest if you have additional changes in your local project.

## Tests

Run with Node.js 24.13 or later after installing dependencies:

```powershell
npm ci
npm run test:cloudflare
npm run test:server
npm run test
```
