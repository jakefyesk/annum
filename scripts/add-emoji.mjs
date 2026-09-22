// Vendors a Fluent Emoji 3D sprite so CI never needs a colour emoji font.
//   node scripts/add-emoji.mjs 🎃 🎄 ✈️
import { writeFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CDN = 'https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji@main'
const index = JSON.parse(readFileSync(join(ROOT, 'emoji', 'fluent-index.json'), 'utf8'))

// Skin-tone modifiers and variation selectors aren't part of the sprite name.
const SKIN = /[\u{1F3FB}-\u{1F3FF}]/gu
const base = (ch) => ch.replace(SKIN, '').replace(/️/g, '')
const codepoint = (ch) => [...base(ch)].map((c) => c.codePointAt(0).toString(16)).join('-')

const chars = process.argv.slice(2)
if (!chars.length) {
  console.error('usage: node scripts/add-emoji.mjs 🎃 🎄')
  process.exit(1)
}

let failed = 0
for (const raw of chars) {
  const stripped = base(raw)
  // Fluent keys its metadata by whatever glyph it declares, which may or may
  // not carry the variation selector.
  const path = index[raw] ?? index[stripped] ?? index[stripped + '️']
  if (!path) {
    console.error(`  ✗ ${raw} — not in Fluent. Pick a near neighbour, or re-run build-emoji-index.mjs.`)
    failed++
    continue
  }
  const res = await fetch(`${CDN}/${path.split('/').map(encodeURIComponent).join('/')}`)
  if (!res.ok) {
    console.error(`  ✗ ${raw} — ${path} returned ${res.status}`)
    failed++
    continue
  }
  const buf = Buffer.from(await res.arrayBuffer())
  writeFileSync(join(ROOT, 'emoji', `${codepoint(raw)}.png`), buf)
  console.log(`  ✓ ${raw} -> emoji/${codepoint(raw)}.png  (${(buf.length / 1024).toFixed(0)} KB)`)
}

process.exit(failed ? 1 : 0)
