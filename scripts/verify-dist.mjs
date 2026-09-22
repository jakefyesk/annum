// The repo can be clean and the *payload* still leak — config.json could be
// copied into dist/ by a careless change to site.mjs. This checks what is
// actually about to be published, not what is committed.
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')

const ALLOWED = [/\.png$/, /^index\.html$/, /^calendar\.mjs$/, /^emoji\/[0-9a-f-]+\.(png|svg)$/]

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) yield* walk(p)
    else yield p
  }
}

const problems = []
let pngs = 0
let bytes = 0

for (const abs of walk(DIST)) {
  const rel = relative(DIST, abs).split('\\').join('/')
  const inW = rel.startsWith('w/')
  const name = inW ? rel.slice(rel.lastIndexOf('/') + 1) : rel

  if (!ALLOWED.some((rx) => rx.test(name))) {
    problems.push(`unexpected file in payload: ${rel}`)
    continue
  }

  bytes += statSync(abs).size
  if (rel.endsWith('.png')) {
    pngs++
    continue
  }

  // Text files in the payload must not carry a milestone block.
  const body = readFileSync(abs, 'utf8')
  if (/"milestones"\s*:\s*\[\s*\{/.test(body)) {
    problems.push(`${rel}: embeds a populated milestones array`)
  }
}

if (problems.length) {
  console.error('\n  annum verify-dist — refusing to publish:\n')
  for (const p of problems) console.error(`  ✗ ${p}`)
  console.error('')
  process.exit(1)
}

console.log(`verify-dist: ${pngs} wallpapers, ${(bytes / 1048576).toFixed(1)} MB, nothing unexpected`)
