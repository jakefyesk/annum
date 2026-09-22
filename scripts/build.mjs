// Renders a year of wallpapers into dist/. Never commits anything; the workflow
// hands dist/ straight to actions/upload-pages-artifact.
import { Resvg } from '@resvg/resvg-js'
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderSVG, DEFAULT_LAYOUT } from '../src/calendar.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// Config comes from the ANNUM_CONFIG secret (base64 JSON) in CI, or a local
// gitignored config.json when you're iterating. Never from a tracked file.
function loadConfig() {
  if (process.env.ANNUM_CONFIG) {
    return JSON.parse(Buffer.from(process.env.ANNUM_CONFIG, 'base64').toString('utf8'))
  }
  try {
    return JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'))
  } catch {
    console.warn('no ANNUM_CONFIG and no local config.json — rendering the example')
    return JSON.parse(readFileSync(join(ROOT, 'config.example.json'), 'utf8'))
  }
}

const config = loadConfig()

// resvg has no base directory for relative hrefs, so PNG sprites are inlined
// as data URIs. The browser preview points at the files instead.
const sprites = {}
const cpToChar = (name) =>
  String.fromCodePoint(...name.replace(/\.(png|svg)$/, '').split('-').map((h) => parseInt(h, 16)))
for (const f of readdirSync(join(ROOT, 'emoji'))) {
  if (f.endsWith('.svg')) {
    sprites[cpToChar(f)] = readFileSync(join(ROOT, 'emoji', f), 'utf8')
  } else if (f.endsWith('.png')) {
    sprites[cpToChar(f)] = 'data:image/png;base64,' + readFileSync(join(ROOT, 'emoji', f)).toString('base64')
  }
}

// An unguessable path segment keeps the wallpapers off the guessable Pages URL.
// Empty slug = published at /w/ directly.
const SLUG = (process.env.ANNUM_SLUG ?? config.slug ?? '').replace(/[^a-zA-Z0-9_-]/g, '')

const layout = { ...DEFAULT_LAYOUT, ...(config.layout ?? {}) }
const years = config.years ?? [new Date().getUTCFullYear(), new Date().getUTCFullYear() + 1]

const DIST = join(ROOT, 'dist')
rmSync(DIST, { recursive: true, force: true })
const outDir = join(DIST, 'w', SLUG)
mkdirSync(outDir, { recursive: true })

const t0 = Date.now()
let n = 0
let bytes = 0

for (const year of years) {
  const start = Date.parse(`${year}-01-01T00:00:00Z`)
  const end = Date.parse(`${year}-12-31T00:00:00Z`)
  for (let t = start; t <= end; t += 86400000) {
    const todayStr = new Date(t).toISOString().slice(0, 10)
    const svg = renderSVG({ todayStr, config, layout, sprites })
    const png = new Resvg(svg, {
      fitTo: { mode: 'width', value: layout.width },
      // fontDirs, not fontBuffers — fontBuffers re-parses the fonts on every
      // construction and costs ~7x (355ms vs 50ms per render).
      font: {
        fontDirs: [join(ROOT, 'fonts')],
        defaultFontFamily: 'JetBrains Mono',
        loadSystemFonts: false,
      },
    })
      .render()
      .asPng()
    writeFileSync(join(outDir, `${todayStr}.png`), png)
    n++
    bytes += png.length
  }
}

console.log(`rendered ${n} days across ${years.join(', ')} in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
console.log(`${(bytes / 1048576).toFixed(1)} MB before quantisation`)
console.log(`published under /w/${SLUG || ''}`)
