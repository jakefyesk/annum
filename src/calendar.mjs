// The renderer. Emits an SVG string and nothing else — no filesystem, no network —
// so the same module runs in the browser preview, in CI, and on an edge runtime.

export const THEME = {
  bg: '#0A0A0A',
  past: '#FFFFFF',
  today: '#D71921',
  future: '#333333',
  dim: '#6E6E6E',
  label: '#8A8A8A',
  range: '#3D7EFF',
}

const DAY = 86400000
const utc = (s) => Date.parse(s + 'T00:00:00Z')
const iso = (t) => new Date(t).toISOString().slice(0, 10)
const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

export const DEFAULT_LAYOUT = {
  width: 1290,
  height: 2796,
  marginX: 96,
  top: 1180,
  dotRatio: 0.62,
  shape: 'circle',
}

function buildYear(year, today) {
  const start = utc(`${year}-01-01`)
  const end = utc(`${year}-12-31`)
  const days = []
  for (let t = start; t <= end; t += DAY) days.push({ t, date: iso(t) })
  const firstDow = (new Date(start).getUTCDay() + 6) % 7 // 0 = Monday
  days.forEach((d, i) => {
    const off = firstDow + i
    d.col = Math.floor(off / 7)
    d.row = off % 7
    d.state = d.t < today ? 'past' : d.t === today ? 'today' : 'future'
  })
  return days
}

// A milestone's label is drawn as literal text in the wallpaper, which is served
// publicly. `private: true` keeps the marker and the countdown but drops the words.
function publicLabel(milestone, redactAll) {
  if (!milestone) return null
  if (redactAll || milestone.private) return milestone.publicLabel ?? null
  return milestone.label ?? null
}

export function renderSVG({ todayStr, config = {}, layout: over = {}, sprites = {} }) {
  const layout = { ...DEFAULT_LAYOUT, ...over }
  const { width: W, height: H } = layout
  const year = Number(todayStr.slice(0, 4))
  const today = utc(todayStr)
  const redactAll = config.redactLabels === true

  const days = buildYear(year, today)
  const byDate = new Map(days.map((d) => [d.date, d]))

  // Ranges first, point milestones on top.
  for (const r of config.ranges ?? []) {
    for (let t = utc(r.start); t <= utc(r.end); t += DAY) {
      const d = byDate.get(iso(t))
      if (d) d.range = r
    }
  }
  for (const m of config.milestones ?? []) {
    const d = byDate.get(m.date)
    if (d) d.milestone = m
  }

  const cols = Math.max(...days.map((d) => d.col)) + 1
  const pitch = (W - 2 * layout.marginX) / cols
  const r = (pitch * layout.dotRatio) / 2
  const gridW = cols * pitch
  const x0 = (W - gridW) / 2 + pitch / 2
  const y0 = layout.top
  const gridH = 7 * pitch

  const out = [`<rect width="${W}" height="${H}" fill="${THEME.bg}"/>`]

  for (let m = 0; m < 12; m++) {
    const d = byDate.get(`${year}-${String(m + 1).padStart(2, '0')}-01`)
    const x = x0 + d.col * pitch
    out.push(`<rect x="${(x - 1).toFixed(1)}" y="${y0 - 34}" width="2" height="12" fill="${THEME.future}"/>`)
    out.push(
      `<text x="${x.toFixed(1)}" y="${y0 - 46}" font-family="JetBrains Mono" font-weight="500" font-size="17" letter-spacing="1.5" fill="${THEME.label}" text-anchor="middle">${MONTHS[m]}</text>`
    )
  }

  const markers = []
  for (const d of days) {
    const cx = x0 + d.col * pitch
    const cy = y0 + d.row * pitch + pitch / 2
    if (d.milestone) {
      markers.push({ d, cx, cy })
      continue
    }
    let fill = THEME.future
    let op = 1
    if (d.state === 'past') fill = THEME.past
    if (d.state === 'today') fill = THEME.today
    if (d.range) {
      fill = d.range.color ?? THEME.range
      op = d.state === 'past' ? 0.55 : 1
    }
    out.push(
      layout.shape === 'square'
        ? `<rect x="${(cx - r).toFixed(1)}" y="${(cy - r).toFixed(1)}" width="${(r * 2).toFixed(1)}" height="${(r * 2).toFixed(1)}" fill="${fill}" opacity="${op}"/>`
        : `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${fill}" opacity="${op}"/>`
    )
  }

  for (const { d, cx, cy } of markers) {
    const m = d.milestone
    const size = pitch * 1.9
    const sprite = m.emoji ? sprites[m.emoji] : null
    if (sprite) {
      const inner = sprite
        .replace(/<\?xml[^>]*\?>/, '')
        .replace(/^<svg[^>]*>/, '')
        .replace(/<\/svg>\s*$/, '')
      const vb = /viewBox="([^"]+)"/.exec(sprite)?.[1] ?? '0 0 36 36'
      out.push(
        `<svg x="${(cx - size / 2).toFixed(1)}" y="${(cy - size / 2).toFixed(1)}" width="${size.toFixed(1)}" height="${size.toFixed(1)}" viewBox="${vb}" opacity="${d.state === 'past' ? 0.45 : 1}">${inner}</svg>`
      )
    } else {
      out.push(
        `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(r * 1.7).toFixed(1)}" fill="none" stroke="${m.color ?? THEME.today}" stroke-width="${(r * 0.7).toFixed(1)}"/>`
      )
    }
  }

  const upcoming = (config.milestones ?? [])
    .filter((m) => utc(m.date) >= today)
    .sort((a, b) => utc(a.date) - utc(b.date))[0]

  const yearStart = utc(`${year}-01-01`)
  const yearEnd = utc(`${year}-12-31`)
  const pct = Math.round(((today - yearStart) / (yearEnd - yearStart)) * 100)
  const left = Math.round((yearEnd - today) / DAY)

  let fy = y0 + gridH + 78
  if (upcoming) {
    const n = Math.round((utc(upcoming.date) - today) / DAY)
    const big = n === 0 ? 'TODAY' : String(n)
    out.push(
      `<text x="${x0 - pitch / 2}" y="${fy}" font-family="JetBrains Mono" font-weight="700" font-size="76" letter-spacing="-2" fill="${THEME.past}">${big}</text>`
    )
    if (n !== 0) {
      out.push(
        `<text x="${x0 - pitch / 2 + big.length * 46 + 14}" y="${fy}" font-family="JetBrains Mono" font-weight="500" font-size="26" letter-spacing="2" fill="${THEME.dim}">DAYS</text>`
      )
    }
    const lbl = publicLabel(upcoming, redactAll)
    if (lbl) {
      out.push(
        `<text x="${x0 - pitch / 2}" y="${fy + 38}" font-family="JetBrains Mono" font-weight="500" font-size="24" letter-spacing="3" fill="${THEME.today}">${esc(lbl.toUpperCase())}</text>`
      )
    }
    fy += 38
  }
  out.push(
    `<text x="${x0 + gridW - pitch / 2}" y="${fy}" font-family="JetBrains Mono" font-weight="500" font-size="24" letter-spacing="3" fill="${THEME.label}" text-anchor="end">${left}D LEFT · ${pct}%</text>`
  )

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${out.join('')}</svg>`
}
