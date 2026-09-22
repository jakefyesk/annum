// The wallpaper has ~500 distinct colours, so truecolour PNG wastes about two
// thirds of the payload. Palette encoding is visually lossless here: the only
// pixels that move are emoji antialiasing (~0.01% of the image).
import sharp from 'sharp'
import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function* pngs(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) yield* pngs(p)
    else if (entry.name.endsWith('.png')) yield p
  }
}

const files = [...pngs(join(ROOT, 'dist'))]
const before = files.reduce((n, f) => n + statSync(f).size, 0)
const t0 = Date.now()

const LIMIT = 8
let i = 0
async function worker() {
  while (i < files.length) {
    const f = files[i++]
    // Write the palette buffer straight to disk. Passing it back through sharp
    // re-encodes it as truecolour and undoes the whole saving.
    const buf = await sharp(f).png({ palette: true, colours: 256, dither: 0, effort: 9 }).toBuffer()
    writeFileSync(f, buf)
  }
}
await Promise.all(Array.from({ length: LIMIT }, worker))

const after = files.reduce((n, f) => n + statSync(f).size, 0)
console.log(
  `optimised ${files.length} files in ${((Date.now() - t0) / 1000).toFixed(1)}s: ` +
    `${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB ` +
    `(${Math.round((100 * after) / before)}%)`
)
