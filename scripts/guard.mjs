// Refuses to let personal data reach a public repo. Runs as a pre-commit hook
// and again in CI, so "be careful" is enforced rather than remembered.
import { execSync } from 'node:child_process'
import { readFileSync, existsSync, statSync } from 'node:fs'

const DENY_PATHS = [
  /^config\.json$/,
  /^\.env(\..*)?$/,
  /\.local\.json$/,
  /^dist\//,
  /^site\/preview-config\.json$/,
]

const SECRET_PATTERNS = [
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/, 'GitHub token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/, 'email address'],
]

const TEXT = /\.(mjs|js|ts|json|md|html|css|ya?ml|txt|sh)$/

const tracked = () => {
  const staged = execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
  if (staged.length) return staged
  // No staged changes (CI): check everything git knows about.
  return execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean)
}

const problems = []

for (const file of tracked()) {
  for (const rx of DENY_PATHS) {
    if (rx.test(file)) problems.push(`${file}: must never be committed (matches ${rx})`)
  }

  if (!TEXT.test(file) || !existsSync(file) || statSync(file).size > 512_000) continue
  const body = readFileSync(file, 'utf8')

  for (const [rx, what] of SECRET_PATTERNS) {
    const hit = rx.exec(body)
    if (hit) problems.push(`${file}: looks like a ${what} — "${hit[0].slice(0, 24)}…"`)
  }

  // Only the example file may carry a milestones/ranges block, and it must
  // declare itself an example.
  if (file.endsWith('.json')) {
    let parsed
    try {
      parsed = JSON.parse(body)
    } catch {
      continue
    }
    const hasPersonal = parsed && (parsed.milestones || parsed.ranges || parsed.birthday)
    if (hasPersonal && parsed._example !== true) {
      problems.push(`${file}: contains milestones/ranges but is not marked "_example": true`)
    }
  }
}

if (problems.length) {
  console.error('\n  annum guard — refusing to commit:\n')
  for (const p of problems) console.error(`  ✗ ${p}`)
  console.error('\n  Personal dates belong in the ANNUM_CONFIG secret, not the repo.')
  console.error('  See README → Privacy.\n')
  process.exit(1)
}

console.log('annum guard: clean')
