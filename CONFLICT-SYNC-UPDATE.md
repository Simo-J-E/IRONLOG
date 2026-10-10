# IRONLOG automatic conflict sync fix

The Profile page no longer displays repeated **Two versions** decisions.

- Conflicting built-in exercises and programs use the server version. Older conflicting content is retained in the account's local export under `conflictBackups`.
- Differences in saved workout history and custom programs/exercises become separate saved records, so both versions are available rather than silently overwritten. This can result in two workout entries if the same session was independently edited on two devices.
- Settings use the synced version when both devices change them. Remote changes superseded by an intentional local deletion are kept in `conflictBackups` while the deletion retries.
- Old unresolved conflicts from previous versions are automatically processed at the next online sync.
- Existing IndexedDB data and the Cloudflare D1 database are left intact.

## Update

1. Replace the project files from this ZIP (or the four edited `src` files from the smaller ZIP).
2. On your own PC, run `npm ci` followed by `npm run check` and `npm run test:e2e`.
3. Commit and push the frontend changes to GitHub Pages.
4. Refresh IRONLOG and sign into your account on each device. Online sync will run automatically.

No Cloudflare Worker redeploy, SQL migration or database reset is required.

## Checks performed here

- Node backend: 9 tests passed with Node 22's `--experimental-strip-types` option.
- Cloudflare Worker backend: 4 tests passed.
- Changed TypeScript/TSX files transpile without syntax errors.
- Frontend unit tests were expanded to cover automatic conflict resolution. Full TypeScript type checking, React unit tests, ESLint, production build and Playwright E2E were **not** verified: this environment could not install npm dependencies. GitHub Actions should run the full validation.

**Tip:** Export your existing account data before rolling out sync changes. The app also keeps conflict backups in its export.
