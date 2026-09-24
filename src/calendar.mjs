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

// How the calendar looks, whatever it's drawn on.
const STYLE = {
  dotRatio: 0.62,
  markerScale: 1.2,
  shape: 'circle',
}

export const DEFAULT_FOOTER = {
  showYear: true,
  maxMilestones: 12, // the list also self-limits to the space above safeBottom
}

// Every screen the calendar is drawn for, in that screen's own pixels. The type
// and its spacing were drawn for the phone; `scale` sizes them for the others.
export const DEVICES = {
  // iPhone 14 Pro Max lock screen. 1180 clears the clock and widget stack.
  phone: {
    layout: { width: 1290, height: 2796, marginX: 96, top: 1180, scale: 1 },
    footer: {
      gap: 118,        // breathing room between the year count and the list
      safeBottom: 340, // keep clear of the lock screen's bottom controls
      columns: 1,
    },
  },
  // The desktops sit in a picture framer's mat: side and top margins about
  // equal, the bottom a quarter larger so the block doesn't look to be
  // sliding down (framers weight the bottom 8-25%). That puts its centre just
  // above the middle, where the eye reads it as centred. `safeTop` keeps the
  // month labels below the lock screen clock, 263pt down on both screens.
  //
  // MacBook Pro 14" at its native 3024x1964, at 2x. Equal top and sides under
  // the clock's limit make the block two thirds of the width, with a whole
  // 38px dot pitch; the right margin clears the first column of desktop icons.
  desktop: {
    layout: {
      width: 3024, height: 1964, marginX: 505, scale: 1.3,
      top: 'auto', balance: 1.25, safeTop: 526, corners: 2,
    },
    footer: { gap: 153, safeBottom: 260, columns: 3 },
  },
  // 43" 32:10 super-ultrawide (ASUS ROG Strix XG43VQ) at its native 3840x1200,
  // which macOS drives at 1x. The MacBook's proportions, with type a little
  // larger than a pure angular match because 1x has half the pixels per glyph.
  // The margins make the dot pitch a whole 32px, so every dot draws alike. The
  // screen is too short for the mat's bottom weighting with a full list, so
  // the clock's limit holds the block there; shorter lists centre properly.
  ultrawide: {
    layout: {
      width: 3840, height: 1200, marginX: 1072, scale: 1.1,
      top: 'auto', balance: 1.25, safeTop: 268, corners: 1,
    },
    footer: { gap: 112, safeBottom: 130, columns: 3 },
  },
}

// Settings that describe the look rather than the screen, so every device
// inherits them from the top level. Everything else is per device: 1180px is a
// sensible top on a phone and most of the way down a laptop.
const SHARED = {
  layout: ['shape', 'markerScale', 'dotRatio'],
  footer: ['showYear', 'maxMilestones'],
}

// The phone reads the top-level `layout` and `footer`, as it always has. Any
// other device reads the same two keys under its own name — `desktop.layout.top`
// — and falls back to the top level only for SHARED settings.
export function resolveDevice(config = {}, device = 'phone') {
  const preset = DEVICES[device]
  if (!preset) throw new Error(`unknown device "${device}" (expected ${Object.keys(DEVICES).join(' or ')})`)
  const own = device === 'phone' ? config : (config[device] ?? {})
  const shared = (key) =>
    Object.fromEntries(SHARED[key].filter((k) => config[key]?.[k] !== undefined).map((k) => [k, config[key][k]]))
  return {
    layout: { ...STYLE, ...preset.layout, ...shared('layout'), ...own.layout },
    footer: { ...DEFAULT_FOOTER, ...preset.footer, ...shared('footer'), ...own.footer },
  }
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

export function renderSVG({ todayStr, config = {}, device = 'phone', sprites = {} }) {
  const { layout, footer } = resolveDevice(config, device)
  const { width: W, height: H } = layout
  // Type and spacing in phone pixels, scaled to this device.
  const px = (v) => Math.round(v * layout.scale * 10) / 10
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

  // Every milestone in the year, listed under the grid in calendar order rather
  // than by proximity, so the list reads as a year at a glance. Past dates
  // count backwards.
  const all = (config.milestones ?? [])
    .slice()
    .filter((m) => m.date?.startsWith(String(year)))
    .sort((a, b) => utc(a.date) - utc(b.date))
  // Anything but a positive number means one column. JSON's 1e400 is Infinity.
  const asked = Math.floor(Number(footer.columns))
  const listCols = Number.isFinite(asked) ? Math.max(1, asked) : 1

  const cols = Math.max(...days.map((d) => d.col)) + 1
  const pitch = (W - 2 * layout.marginX) / cols
  const r = (pitch * layout.dotRatio) / 2
  const gridW = cols * pitch
  const x0 = (W - gridW) / 2 + pitch / 2
  const gridH = 7 * pitch

  // The block runs from the month labels' cap tops, this far above the grid
  // (JetBrains Mono's caps are 0.73em tall), to the last list row.
  const above = px(46) + px(17) * 0.73

  // `top: 'auto'` places the whole block so the space below it is `balance`
  // times the space above, and never starts above `safeTop`. The list holds
  // every milestone in the year, so the block keeps its height, and its place,
  // all year.
  const autoTop = () => {
    const rows = Math.ceil(Math.min(all.length, footer.maxMilestones) / listCols)
    const yearLine = gridH + px(74)
    const listFrom = footer.showYear ? yearLine + footer.gap : yearLine
    const lastDot = gridH - pitch / 2 + r
    const below = rows ? listFrom + (rows - 1) * px(46) : footer.showYear ? yearLine : lastDot
    const space = (H - above - below) / (1 + (layout.balance ?? 1))
    return Math.round(Math.max(layout.safeTop ?? 0, space) + above)
  }
  const y0 = layout.top === 'auto' ? autoTop() : layout.top
  const left = x0 - pitch / 2
  const right = x0 + gridW - pitch / 2

  const out = [`<rect width="${W}" height="${H}" fill="${THEME.bg}"/>`]

  for (let m = 0; m < 12; m++) {
    const d = byDate.get(`${year}-${String(m + 1).padStart(2, '0')}-01`)
    const x = x0 + d.col * pitch
    out.push(`<rect x="${(x - px(1)).toFixed(1)}" y="${y0 - px(34)}" width="${px(2)}" height="${px(12)}" fill="${THEME.future}"/>`)
    out.push(
      `<text x="${x.toFixed(1)}" y="${y0 - px(46)}" font-family="JetBrains Mono" font-weight="500" font-size="${px(17)}" letter-spacing="${px(1.5)}" fill="${THEME.label}" text-anchor="middle">${MONTHS[m]}</text>`
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
  let y = y0 + gridH + px(74)
  // The block's lowest baseline so far, for the corner marks.
  let bottom = y0 + gridH - pitch / 2 + r

  // The year countdown sits directly under the grid and carries the most
  // weight, so a milestone's number can never be mistaken for it.
  if (footer.showYear) {
    const yearStart = utc(`${year}-01-01`)
    const yearEnd = utc(`${year}-12-31`)
    const pct = Math.round(((today - yearStart) / (yearEnd - yearStart)) * 100)
    const daysLeft = Math.round((yearEnd - today) / DAY)
    const big = String(daysLeft)

    out.push(
      `<text x="${left.toFixed(1)}" y="${y}" font-family="JetBrains Mono" font-weight="700" font-size="${px(68)}" letter-spacing="${px(-2)}" fill="${THEME.past}">${big}</text>`
    )
    const tx = left + big.length * px(41) + px(16)
    out.push(
      `<text x="${tx.toFixed(1)}" y="${y}" font-family="JetBrains Mono" font-weight="700" font-size="${px(28)}" letter-spacing="${px(3)}" fill="${THEME.past}">DAYS LEFT</text>`
    )
    // Same baseline, opposite edge: the year and percentage read as context for
    // the count rather than as a second line of it.
    out.push(
      `<text x="${right.toFixed(1)}" y="${y}" font-family="JetBrains Mono" font-weight="500" font-size="${px(24)}" letter-spacing="${px(3)}" fill="${THEME.dim}" text-anchor="end">IN ${year} · ${pct}%</text>`
    )
    bottom = y
    y += footer.gap
  }

  // A wide screen splits the list into columns, filled top to bottom and then
  // left to right, so each column still reads in calendar order. They're filled
  // as evenly as possible, earlier columns taking the remainder, so four items
  // across three columns span the width rather than leaving the last one empty.
  const ROW = px(46)
  const room = Math.max(0, Math.floor((layout.height - footer.safeBottom - y) / ROW))
  // When the year won't fit, the oldest past dates go first: the list shows the
  // latest run of consecutive milestones that still starts at or before the next
  // upcoming one. If the upcoming ones alone overflow, that keeps the nearest.
  const fits = Math.max(0, Math.floor(Math.min(room * listCols, footer.maxMilestones))) || 0
  const next = all.findIndex((m) => daysTo(m) >= 0)
  const start = Math.min(next === -1 ? all.length : next, Math.max(0, all.length - fits))
  const shown = all.slice(start, start + fits)
  const used = Math.min(listCols, shown.length)
  const perCol = Math.floor(shown.length / listCols)
  const extra = shown.length % listCols
  const colW = (right - left) / listCols

  // A label stops a gutter short of the next column, or at the grid's edge when
  // no column follows it. JetBrains Mono advances 0.6em per glyph plus the
  // letter-spacing, which the last glyph doesn't need. Composed characters are
  // what's counted, so a decomposed é isn't charged two cells.
  const clip = (s, width) => {
    const fit = Math.floor((width + px(3)) / (px(24) * 0.6 + px(3)))
    const chars = [...s.normalize('NFC')]
    return chars.length > fit ? chars.slice(0, Math.max(0, fit - 1)).join('').trimEnd() + '…' : s
  }

  for (let c = 0; c < used; c++) {
    // No markers here — the emoji live in the grid, where they mark a position.
    // Repeating them down the list just adds colour the list doesn't need.
    const COUNT_RIGHT = left + c * colW + px(96)
    const LABEL_LEFT = left + c * colW + px(124)
    const labelWidth = (c === used - 1 ? right - left - c * colW : colW - px(40)) - px(124)
    let row = y

    const from = c * perCol + Math.min(c, extra)
    for (const m of shown.slice(from, from + perCol + (c < extra ? 1 : 0))) {
      const n = daysTo(m)
      const past = n < 0
      const tone = past ? THEME.dim : THEME.label

      // Right-align the counts so the column reads as a column.
      const count = n === 0 ? 'TODAY' : String(n)
      out.push(
        `<text x="${COUNT_RIGHT.toFixed(1)}" y="${row}" font-family="JetBrains Mono" font-weight="${n === 0 ? 700 : 500}" font-size="${px(28)}" letter-spacing="0" fill="${n === 0 ? THEME.today : tone}" text-anchor="end">${count}</text>`
      )

      const lbl = publicLabel(m, redactAll)
      if (lbl) {
        out.push(
          `<text x="${LABEL_LEFT.toFixed(1)}" y="${row}" font-family="JetBrains Mono" font-weight="500" font-size="${px(24)}" letter-spacing="${px(3)}" fill="${tone}" opacity="${past ? 0.75 : 1}">${esc(clip(lbl.toUpperCase(), labelWidth))}</text>`
        )
      }
      bottom = Math.max(bottom, row)
      row += ROW
    }
  }

  // Corner marks: a mat implied only by its corners, one pitch outside the
  // block and one pitch long, `corners` px wide and in a future day's grey.
  // Snapped to the pixel grid so a 1px or 2px line stays crisp.
  if (layout.corners > 0) {
    const w = layout.corners
    const snap = (v) => (w % 2 ? Math.round(v - 0.5) + 0.5 : Math.round(v))
    const [x1, x2] = [snap(left - pitch), snap(right + pitch)]
    const [y1, y2] = [snap(y0 - above - pitch), snap(bottom + pitch)]
    const [ax1, ax2, ay1, ay2] = [snap(x1 + pitch), snap(x2 - pitch), snap(y1 + pitch), snap(y2 - pitch)]
    out.push(
      `<path d="M${x1} ${ay1}V${y1}H${ax1}M${ax2} ${y1}H${x2}V${ay1}M${x2} ${ay2}V${y2}H${ax2}M${ax1} ${y2}H${x1}V${ay2}" fill="none" stroke="${THEME.future}" stroke-width="${w}"/>`
    )
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${out.join('')}</svg>`
}
