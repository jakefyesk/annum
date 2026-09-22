// Fluent indexes assets by CLDR name, not codepoint, so there is no way to go
// from 🎃 to a URL without a map. This builds one and writes it to
// emoji/fluent-index.json, which is committed. Re-run only when Fluent adds
// emoji you want — day to day, add-emoji.mjs just reads the index.
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CDN = 'https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji@main'

const res = await fetch(
  'https://api.github.com/repos/microsoft/fluentui-emoji/git/trees/main?recursive=1',
  { headers: process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {} }
)
const paths = (await res.json()).tree.map((t) => t.path)

const folders = [...new Set(paths.filter((p) => p.endsWith('/metadata.json')).map((p) => p.split('/')[1]))]

// Two shapes: plain emoji are <name>_3d.png, while emoji with skin tones nest
// under a tone folder and are named <name>_3d_<tone>.png. Take the neutral
// Default tone for those, and prefer it if both somehow exist.
const pngFor = new Map()
for (const p of paths) {
  const plain = p.endsWith('_3d.png')
  const neutral = p.endsWith('_3d_default.png')
  if (!plain && !neutral) continue
  const folder = p.split('/')[1]
  if (!pngFor.has(folder) || neutral) pngFor.set(folder, p)
}

const index = {}
const queue = folders.filter((f) => pngFor.has(f))
const total = queue.length
let done = 0

async function worker() {
  while (queue.length) {
    const folder = queue.pop()
    try {
      const r = await fetch(`${CDN}/assets/${encodeURIComponent(folder)}/metadata.json`)
      if (r.ok) {
        const meta = await r.json()
        if (meta.glyph) index[meta.glyph] = pngFor.get(folder)
      }
    } catch {
      /* a missing entry just means that emoji can't be looked up by glyph */
    }
    if (++done % 250 === 0) console.log(`  ${done}/${total}`)
  }
}

await Promise.all(Array.from({ length: 24 }, worker))

writeFileSync(join(ROOT, 'emoji', 'fluent-index.json'), JSON.stringify(index) + '\n')
console.log(`indexed ${Object.keys(index).length} of ${total} emoji -> emoji/fluent-index.json`)
