// Assembles the Pages payload: config site + the renderer module + emoji sprites.
// The site imports the same calendar.mjs that CI renders with, so preview and
// wallpaper can never drift.
import { cpSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')

mkdirSync(DIST, { recursive: true })
cpSync(join(ROOT, 'site'), DIST, { recursive: true })
cpSync(join(ROOT, 'src', 'calendar.mjs'), join(DIST, 'calendar.mjs'))
// The index ships too: it's a public emoji->path map with nothing personal in
// it, and the preview needs it to resolve sprites that aren't vendored.
cpSync(join(ROOT, 'emoji'), join(DIST, 'emoji'), { recursive: true })
console.log('site assembled into dist/')
