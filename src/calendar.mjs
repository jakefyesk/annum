// The renderer. Emits an SVG string and nothing else — no filesystem, no network —
// so the same module runs in the browser preview, in CI, and on an edge runtime.

export const THEME = {
  bg: '#0A0A0A',
  past: '#FFFFFF',
  today: '#D71921',
  future: '#333333',
  dim: '#6E6E6E',
  label: '#8A8A8A',
  rule: '#1E1E1E',
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
  markerScale: 1.2,
  shape: 'circle',
}

export const DEFAULT_FOOTER = {
  showYear: true,
  gap: 118,          // breathing room between the year count and the list
  maxMilestones: 12, // the list also self-limits to the space above safeBottom
  safeBottom: 340,   // keep clear of the lock screen's bottom controls
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

// Sprites arrive either as SVG markup (inlined) or as a URL / data URI. The
// browser passes a relative path; CI passes a data URI, because resvg has no
// notion of a base directory.
function spriteTag(art, x, y, size, opacity = 1) {
  if (art.trimStart().startsWith('<')) {
    const inner = art
      .replace(/<\?xml[^>]*\?>/, '')
      .replace(/^\s*<svg[^>]*>/, '')
      .replace(/<\/svg>\s*$/, '')
    const vb = /viewBox="([^"]+)"/.exec(art)?.[1] ?? '0 0 36 36'
    return `<svg x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${size.toFixed(1)}" height="${size.toFixed(1)}" viewBox="${vb}" opacity="${opacity}">${inner}</svg>`
  }
  return `<image x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${size.toFixed(1)}" height="${size.toFixed(1)}" href="${esc(art)}" opacity="${opacity}"/>`
}

// Sprite keys come from filenames, which carry neither variation selectors nor
// skin-tone modifiers, while config emoji usually do. Normalising here keeps CI
// and the browser preview from disagreeing about whether a sprite exists.
const SKIN_TONE = /[\u{1F3FB}-\u{1F3FF}]/gu
function spriteFor(sprites, emoji) {
  if (!emoji) return null
  const bare = emoji.replace(SKIN_TONE, '').replace(/\uFE0F/g, '')
  return sprites[emoji] ?? sprites[bare] ?? sprites[bare + '\uFE0F'] ?? null
}

export function renderSVG({ todayStr, config = {}, layout: over = {}, sprites = {} }) {
  const layout = { ...DEFAULT_LAYOUT, ...over }
  const footer = { ...DEFAULT_FOOTER, ...(config.footer ?? {}) }
  const { width: W, height: H } = layout
  const year = Number(todayStr.slice(0, 4))
  const today = utc(todayStr)
  const redactAll = config.redactLabels === true

  const days = buildYear(year, today)
  const byDate = new Map(days.map((d) => [d.date, d]))

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
  const left = x0 - pitch / 2
  const right = x0 + gridW - pitch / 2

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
    const size = pitch * layout.markerScale
    const art = spriteFor(sprites, m.emoji)
    out.push(
      art
        ? spriteTag(art, cx - size / 2, cy - size / 2, size, d.state === 'past' ? 0.45 : 1)
        : `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(r * 1.7).toFixed(1)}" fill="none" stroke="${m.color ?? THEME.today}" stroke-width="${(r * 0.7).toFixed(1)}"/>`
    )
  }

  // ---- Footer -------------------------------------------------------------
  // The year count leads, then the full milestone list in calendar order.

  const daysTo = (m) => Math.round((utc(m.date) - today) / DAY)
  let y = y0 + gridH + 74

  // The year countdown sits directly under the grid and carries the most
  // weight, so a milestone's number can never be mistaken for it.
  if (footer.showYear) {
    const yearStart = utc(`${year}-01-01`)
    const yearEnd = utc(`${year}-12-31`)
    const pct = Math.round(((today - yearStart) / (yearEnd - yearStart)) * 100)
    const daysLeft = Math.round((yearEnd - today) / DAY)
    const big = String(daysLeft)

    out.push(
      `<text x="${left.toFixed(1)}" y="${y}" font-family="JetBrains Mono" font-weight="700" font-size="68" letter-spacing="-2" fill="${THEME.past}">${big}</text>`
    )
    const tx = left + big.length * 41 + 16
    out.push(
      `<text x="${tx.toFixed(1)}" y="${y}" font-family="JetBrains Mono" font-weight="700" font-size="28" letter-spacing="3" fill="${THEME.past}">DAYS LEFT</text>`
    )
    // Same baseline, opposite edge: the year and percentage read as context for
    // the count rather than as a second line of it.
    out.push(
      `<text x="${right.toFixed(1)}" y="${y}" font-family="JetBrains Mono" font-weight="500" font-size="24" letter-spacing="3" fill="${THEME.dim}" text-anchor="end">IN ${year} · ${pct}%</text>`
    )
    y += footer.gap
  }

  // Every milestone, in calendar order rather than by proximity, so the list
  // reads as a year at a glance. Past dates count backwards.
  const all = (config.milestones ?? [])
    .slice()
    .filter((m) => m.date?.startsWith(String(year)))
    .sort((a, b) => utc(a.date) - utc(b.date))

  const ROW = 46
  const room = Math.max(0, Math.floor((layout.height - footer.safeBottom - y) / ROW))
  const shown = all.slice(0, Math.min(room, footer.maxMilestones))

  // No markers here — the emoji live in the grid, where they mark a position.
  // Repeating them down the list just adds colour the list doesn't need.
  const COUNT_RIGHT = left + 96
  const LABEL_LEFT = left + 124

  for (const m of shown) {
    const n = daysTo(m)
    const past = n < 0
    const tone = past ? THEME.dim : THEME.label

    // Right-align the counts so the column reads as a column.
    const count = n === 0 ? 'TODAY' : String(n)
    out.push(
      `<text x="${COUNT_RIGHT.toFixed(1)}" y="${y}" font-family="JetBrains Mono" font-weight="${n === 0 ? 700 : 500}" font-size="28" letter-spacing="0" fill="${n === 0 ? THEME.today : tone}" text-anchor="end">${count}</text>`
    )

    const lbl = publicLabel(m, redactAll)
    if (lbl) {
      out.push(
        `<text x="${LABEL_LEFT.toFixed(1)}" y="${y}" font-family="JetBrains Mono" font-weight="500" font-size="24" letter-spacing="3" fill="${tone}" opacity="${past ? 0.75 : 1}">${esc(lbl.toUpperCase())}</text>`
      )
    }
    y += ROW
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${out.join('')}</svg>`
}
