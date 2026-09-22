// Vendors a Twemoji sprite so CI never needs a colour emoji font.
//   node scripts/add-emoji.mjs 🏃 🎄 ✈️
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CDN = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/svg'

const chars = process.argv.slice(2)
if (!chars.length) {
  console.error('usage: node scripts/add-emoji.mjs 🏃 🎄')
  process.exit(1)
}

for (const ch of chars) {
  const cp = [...ch].map((c) => c.codePointAt(0).toString(16)).filter((h) => h !== 'fe0f').join('-')
  const res = await fetch(`${CDN}/${cp}.svg`)
  if (!res.ok) {
    console.error(`  ✗ ${ch} (${cp}) — not in Twemoji`)
    continue
  }
  writeFileSync(join(ROOT, 'emoji', `${cp}.svg`), await res.text())
  console.log(`  ✓ ${ch} -> emoji/${cp}.svg`)
}
