# IRONLOG ESLint username fix

The two backend username-validation regexes now use `RegExp` with an unescaped `/` character.

- Registration: 4–24 characters; ASCII letters, numbers, `_` or `/`.
- Login: 3–24 characters, preserving access for existing 3-character accounts.

## Apply

Copy `server/index.mjs` and `cloudflare/worker.mjs` into the corresponding locations in your existing IRONLOG project. Keep your own `cloudflare/wrangler.toml` intact to preserve your D1 database binding and domain setting.

## Test locally (Node.js >=24.13)

```
npm ci
npm run check
npm run test:e2e
```

## Deploy

```
npx wrangler deploy --config cloudflare/wrangler.toml
```

Commit and push the two modified source files to GitHub for GitHub Pages to rebuild.

## Verification performed

- Node backend native tests: 8/8 pass.
- Cloudflare backend native tests: 3/3 pass.
- Node syntax checks on both updated backend files: pass.
- ESLint / TypeScript / Vitest / Playwright and frontend build: not verified here because npm dependencies are unavailable in the execution environment. GitHub Actions will run them after you push.
