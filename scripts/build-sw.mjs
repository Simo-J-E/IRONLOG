import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
const files = readdirSync('dist', { recursive: true }).filter(path => /\.(js|css|svg|png|woff2|html|webmanifest)$/.test(path) && path !== 'sw.js').sort()
const hash = createHash('sha256')
for (const file of files) hash.update(readFileSync(`dist/${file}`))
const worker = readFileSync('public/sw.js', 'utf8').replace('__BUILD_HASH__', hash.digest('hex').slice(0, 16)).replace('__PRECACHE__', JSON.stringify(files.map(path => `./${path}`)))
writeFileSync('dist/sw.js', worker)
console.log(`Offline shell includes ${files.length} files.`)
