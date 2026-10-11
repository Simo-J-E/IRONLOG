import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// Local developer setup only. CI and published archives must not modify Git settings.
if (process.env.CI !== 'true') {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  try {
    const repositoryRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (resolve(repositoryRoot) === projectRoot) {
      execFileSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], {
        cwd: projectRoot,
        stdio: 'ignore',
      })
      console.log('Installed read-only pre-commit checks (no automatic fixes).')
    }
  } catch {
    // ZIPs and deployment builds may not have a Git worktree; installation is optional.
  }
}
