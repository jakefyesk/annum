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
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

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
  // The desktops sit in a picture framer's mat: the bottom margin a quarter
  // larger than the top, so the block doesn't look to be sliding down
  // (framers weight the bottom 8-25%). That puts its centre just above the
  // middle, where the eye reads it as centred. `safeTop` keeps the block's top
  // edge, the month labels' caps, below the lock screen clock; the block sits
  // well clear of it.
  //
  // Both are small and quiet: dots and type shrink together, keeping the
  // pitch-to-type ratio that makes this the same design, down to the smallest
  // type that still reads on the MacBook (list labels at 10pt) and
  // 20-character labels. Each margin makes the dot pitch a whole number of
  // pixels, so every dot draws alike.
  //
  // MacBook Pro 14" at its native 3024x1964, at 2x: a 25px pitch, the block
  // about two fifths of the width and a quarter of the height.
  desktop: {
    layout: {
      width: 3024, height: 1964, marginX: 849.5, scale: 0.86,
      top: 'auto', balance: 1.25, safeTop: 526, corners: 2,
    },
    footer: { gap: 101, safeBottom: 260, columns: 3 },
  },
  // 43" 32:10 super-ultrawide (ASUS ROG Strix XG43VQ) at its native 3840x1200,
  // which macOS drives at 1x: a 15px pitch, so the block looks the MacBook's
  // size from where each is seen, about 90cm and 55cm. Both screens stand
  // about 20 degrees tall from there, and the block takes the same angle and
  // the same share of the height on each. Matching its share of the width
  // isn't the same thing on a screen this wide, whose sides are out in
  // peripheral vision, and nor is matching area, which left the block half as
  // big again. Month labels come out near 9px, the MacBook's size by angle; a
  // pixel there is about an arcminute, so drawing them at 1x costs little.
  ultrawide: {
    layout: {
      width: 3840, height: 1200, marginX: 1522.5, scale: 0.515,
      top: 'auto', balance: 1.25, safeTop: 268, corners: 1,
    },
    footer: { gap: 61, safeBottom: 130, columns: 3 },
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

// The share of a life of `lifeExpectancy` years (rounded, 1 to 150; 75
// otherwise) that `today` has used, past 1 once it's over, or null without a
// real birthday or before it. The life ends on the birthday that many years
// on, which setUTCFullYear rolls from 29 February to 1 March in a year without
// one. (Date.UTC would read years 0-99 as 1900-1999.)
function lifeOf(config, today) {
  const b = config.birthday
  const born = typeof b === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b) ? utc(b) : NaN
  // Date.parse takes 30 February as 2 March, so only a round trip proves a date.
  if (!Number.isFinite(born) || iso(born) !== b || today < born) return null
  const asked = Math.round(Number(config.lifeExpectancy ?? 75))
  const years = asked >= 1 && asked <= 150 ? asked : 75
  const end = new Date(born).setUTCFullYear(new Date(born).getUTCFullYear() + years)
  return (today - born) / (end - born)
}

// Where a mark `w` pixels wide that's lit as far as `exact` changes tone: the
// nearest whole pixel that leaves neither part under 3px. Thinner reads as a
// stray pixel rather than as the mark changing tone, so a part that would be
// 1px or 2px goes to nothing or to 3px, whichever is nearer.
const split = (exact, w) =>
  [Math.round(exact), 0, 3, w - 3, w]
    .filter((on) => on === 0 || on === w || (on >= 3 && on <= w - 3))
    .reduce((a, b) => (Math.abs(b - exact) < Math.abs(a - exact) ? b : a))

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

  // With a birthday, a life, drawn under the grid as a dashed rule: a dash on
  // each week column, as wide as that column's dots, so it runs edge to edge
  // with the grid in the grid's own rhythm, and a year and a life read at the
  // same length. The share lived is in the dim grey of a past milestone's
  // count, the rest in a future day's, and the dash where they meet is split
  // between the two rather than lit red. Nothing is written on it.
  // `life: false` in a device's layout leaves it off that screen.
  const lived = layout.life === false ? null : lifeOf(config, today)
  // Whole pixels, the dots' width rounded, so the gaps between dashes are the
  // gaps between dots to within a pixel. Where every column is centred on a
  // whole pixel, as on both desktops in a 53-week year, it's the nearest even
  // width instead, so each dash is centred on its column exactly.
  const whole = Number.isInteger(pitch) && Number.isInteger(x0)
  const dash = { w: whole ? 2 * Math.round(r) : Math.round(2 * r), h: Math.max(1, Math.round(px(3))) }

  // The month labels head the grid, their baseline px(24) over it, as far as
  // the quarters' caps stand under it, so the grid sits between its labels
  // like a picture in a mat. No ticks: each label is centred on the column its
  // month starts in.
  const over = px(24)

  // Under the grid the progress marks run on from the days to longer spans,
  // the year's quarters and then a life, before the footer: the three read as
  // one graphic, the grid and two rules under it, and the count and the list
  // follow. Each mark stands further off than the one over it, so every label
  // reads as its own bar's without a tick to say which: the quarters' caps
  // px(24) under the grid, their bars px(12) under the labels' baseline, and
  // the life's rule px(38) under the bars, so it reads as a rule of its own
  // rather than one more of the bars, a rule of the same weight. Without the
  // quarters it takes their labels' place, px(24) under the grid as the
  // months' baseline is over it: there it's the grid's, and the count stands
  // more than twice as far off. At px(38) it would hang nearly midway between
  // the two and read as neither's. Offsets are whole pixels from the grid's
  // bottom edge, the one the month labels stand over at its top.
  // `quarters: false` leaves the quarters off every screen, and in a device's
  // layout, off that one.
  const quarters = config.quarters !== false && layout.quarters !== false
  const qbar = quarters ? Math.round(over + px(20) * 0.73 + px(12)) : null
  const rule = lived === null ? null : quarters ? qbar + dash.h + Math.round(px(38)) : Math.round(over)
  // The marks' lowest edge under the grid's, or 0 with neither.
  const marks = rule !== null ? rule + dash.h : quarters ? qbar + dash.h : 0
  // The year count's baseline under the grid's top. With nothing under the
  // grid its caps (0.73em) stand px(24) under it, as far as the months'
  // baseline stands over it, and px(74) puts them there. The marks take it
  // down until its caps stand px(56) under the lowest of them, further off
  // than any mark from the one over it, so the rules stay the grid's and the
  // count starts the numbers. They take it down in whole pixels, as they're
  // drawn, so its type falls on the pixels just as it does without them.
  // Everything under it moves down as far.
  const countAt = gridH + px(74) + (marks && Math.round(marks + px(56) - over))

  // The block runs from the month labels' cap tops, this far above the grid
  // (JetBrains Mono's caps are 0.73em tall), to the last list row.
  const above = over + px(17) * 0.73

  // `top: 'auto'` places the whole block so the space below it is `balance`
  // times the space above, and never starts above `safeTop`. The list holds
  // every milestone in the year, so the block keeps its height, and its place,
  // all year.
  const autoTop = () => {
    const rows = Math.ceil(Math.min(all.length, footer.maxMilestones) / listCols)
    const listFrom = footer.showYear ? countAt + footer.gap : countAt
    const lastMark = marks ? gridH + marks : gridH - pitch / 2 + r
    const below = rows ? listFrom + (rows - 1) * px(46) : footer.showYear ? countAt : lastMark
    const balance = Number(layout.balance ?? 1)
    const space = (H - above - below) / (1 + (Number.isFinite(balance) && balance >= 0 ? balance : 1))
    // No lower than keeps the last list row above safeBottom, or the list would
    // drop rows; the 1e-6 is slack for the room check's float division. Never
    // higher than safeTop, rounding down included.
    const lowest = rows ? Math.floor(H - footer.safeBottom - px(46) - below - 1e-6) : Infinity
    const highest = Math.ceil(Number(layout.safeTop ?? 0) + above)
    return Math.max(highest, Math.min(Math.round(space + above), lowest))
  }
  // A number pins the block's top edge, the month labels' caps: their baseline
  // stands px(46) over it, which on a phone was chosen to keep the block under
  // the clock and widgets. Nothing stands over the months, so the grid always
  // starts px(46) less px(24), rounded, over `top`, 22px on the phone, with
  // the marks or without them; they push the count and the list down instead.
  // So the preview's autoTop, JAN's baseline plus px(46), rounded, gives back
  // the `top` that holds auto's placement.
  const y0 = layout.top === 'auto' ? autoTop() : Number(layout.top) - Math.round(px(46) - over)
  const left = x0 - pitch / 2
  const right = x0 + gridW - pitch / 2

  const out = [`<rect width="${W}" height="${H}" fill="${THEME.bg}"/>`]

  // The month labels head the block. JAN is the image's first text, which the
  // preview measures `top` from (see y0), so nothing before it may be text.
  for (let m = 0; m < 12; m++) {
    const d = byDate.get(`${year}-${String(m + 1).padStart(2, '0')}-01`)
    const x = x0 + d.col * pitch
    out.push(
      `<text x="${x.toFixed(1)}" y="${(y0 - over).toFixed(1)}" font-family="JetBrains Mono" font-weight="500" font-size="${px(17)}" letter-spacing="${px(1.5)}" fill="${THEME.label}" text-anchor="middle">${MONTHS[m]}</text>`
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

  // ---- Marks --------------------------------------------------------------
  // The quarters, then a life, hung from the grid's bottom edge (see qbar).

  const edge = y0 + gridH
  // The block's lowest edge or baseline so far, for the corner marks.
  let bottom = edge - pitch / 2 + r

  // The quarters: a bar under each label, from the column its quarter starts in
  // to the column the next one does, centre to centre like the month labels,
  // with a dot's gap at each turn. The days run down a column, not across it,
  // so a quarter that turns mid-week, or on a Monday or a Sunday, breaks in
  // that week's column, up to half a column from the exact day: half late for
  // a Monday, over a third early for a Sunday. The outer ends are on the outer
  // dots, like the life rule's, so the four still read as the year's one bar,
  // and the breaks sit under APR, JUL and OCT, across the grid.
  // One that's over is in the dim grey of a life lived, label and bar; the one
  // under way is lit white to the right edge of today's dot, as today counts as
  // spent, and the rest of it, like the quarters to come, is in a future day's
  // grey, under labels in the months' grey. So the only white under the grid,
  // before the count, is the quarter you're in: its name, in bold, and how far
  // through it you are. After the name, in the months' grey, come the days
  // left in it, counted as the footer counts the year's, or on its last day,
  // that it is.
  if (quarters) {
    const y = Math.round(edge + qbar)
    const end = Math.round(x0 - dash.w / 2)
    const gap = Math.round(pitch - 2 * r)
    const starts = ['01', '04', '07', '10'].map((m) => utc(`${year}-${m}-01`)).concat(utc(`${year + 1}-01-01`))
    const turn = (q) => Math.round(x0 + byDate.get(iso(starts[q])).col * pitch)
    const spent = x0 + byDate.get(iso(today)).col * pitch + r
    // JetBrains Mono advances 0.6em per glyph plus the letter-spacing, as the
    // footer's clip() assumes.
    const cell = px(20) * 0.6 + px(2)
    const bars = { [THEME.dim]: [], [THEME.past]: [], [THEME.future]: [] }
    const bar = (fill, from, width) =>
      width > 0 && bars[fill].push(`<rect x="${from}" y="${y}" width="${width}" height="${dash.h}"/>`)
    const labels = []
    for (let q = 0; q < 4; q++) {
      const a = q === 0 ? end : turn(q) + Math.ceil(gap / 2)
      const b = q === 3 ? W - end : turn(q + 1) - Math.floor(gap / 2)
      const now = today >= starts[q] && today < starts[q + 1]
      const done = today >= starts[q + 1]
      // Never less than the 3px nub: on a quarter's first days the bar starts
      // only a pixel or two short of the dot's edge, which split would round
      // away, and today is spent.
      const on = now ? Math.max(3, split(Math.min(b, Math.max(a, spent)) - a, b - a)) : done ? b - a : 0
      bar(now ? THEME.past : THEME.dim, a, on)
      bar(THEME.future, a + on, b - a - on)
      // Through Q4 the days left in it are the year's, which the year's count
      // under the marks gives in bigger type, so there the name stands alone
      // until its last day. Without the year's count it counts like any other,
      // so the number is never lost. The count stops two cells, a blank one
      // more than a word space, short of the next label (past the gap at the
      // turn) or of the bar's end, or it drops DAYS; on the phone a quarter can
      // be twelve columns wide.
      const n = Math.round((starts[q + 1] - DAY - today) / DAY)
      const say = (unit) => (n ? `${n} ${unit}` : 'LAST DAY')
      const long = say(n === 1 ? 'DAY LEFT' : 'DAYS LEFT')
      const fits = (`Q${q + 1} · ${long}`.length + 2) * cell - px(2) <= (q === 3 ? b : b + gap) - a
      const count = q === 3 && n && footer.showYear ? '' : ` · ${fits ? long : say('LEFT')}`
      const text = now ? `<tspan font-weight="700" fill="${THEME.past}">Q${q + 1}</tspan>${count}` : `Q${q + 1}`
      labels.push(
        `<text x="${a}" y="${y - px(12)}" font-family="JetBrains Mono" font-weight="500" font-size="${px(20)}" letter-spacing="${px(2)}" fill="${done ? THEME.dim : THEME.label}">${text}</text>`
      )
    }
    for (const [fill, rects] of Object.entries(bars)) rects.length && out.push(`<g fill="${fill}">${rects.join('')}</g>`)
    out.push(...labels)
    bottom = y + dash.h
  }

  if (lived !== null) {
    // Mirrored about the centre, like the corner marks, so both ends sit alike
    // on the outer dots whichever way a half pixel rounds.
    const y = Math.round(edge + rule)
    const x = (c) => (c > (cols - 1) / 2 ? W - x(cols - 1 - c) - dash.w : Math.round(x0 + c * pitch - dash.w / 2))
    // Each column holds an equal share of the life. The one `today` falls in is
    // split where it falls, without slivers (see split). Past the life's end
    // it's all lit.
    const at = Math.min(lived, 1) * cols
    const lit = []
    const rest = []
    const seg = (to, from, width) =>
      width > 0 && to.push(`<rect x="${from}" y="${y}" width="${width}" height="${dash.h}"/>`)
    for (let c = 0; c < cols; c++) {
      const on = split(Math.max(0, Math.min(1, at - c)) * dash.w, dash.w)
      seg(lit, x(c), on)
      seg(rest, x(c) + on, dash.w - on)
    }
    for (const [fill, rects] of [[THEME.dim, lit], [THEME.future, rest]])
      rects.length && out.push(`<g fill="${fill}">${rects.join('')}</g>`)
    bottom = y + dash.h
  }

  // ---- Footer -------------------------------------------------------------
  // The year count leads, then the full milestone list in calendar order.

  const daysTo = (m) => Math.round((utc(m.date) - today) / DAY)
  let y = y0 + countAt

  // The year countdown sits directly under the marks and carries the most
  // weight, so a milestone's number can never be mistaken for it.
  if (footer.showYear) {
    const daysLeft = Math.round((utc(`${year}-12-31`) - today) / DAY)
    const big = String(daysLeft)
    const date = new Date(today)
    const tx = left + big.length * px(41) + px(16)

    out.push(
      `<text x="${left.toFixed(1)}" y="${y}" font-family="JetBrains Mono" font-weight="700" font-size="${px(68)}" letter-spacing="${px(-2)}" fill="${THEME.past}">${big}</text>`
    )
    // Today's date is set into the count rather than beside it: over DAYS
    // LEFT, its caps' top on the number's, so the two small lines fill the
    // big one's height and the date adds no line and no column. Ten characters
    // at most, it never runs past DAYS LEFT, and past DAY LEFT, on 30
    // December, by about a character. Nothing answers it at the far edge: the
    // grid is the year and shows how much of it is gone.
    out.push(
      `<text x="${tx.toFixed(1)}" y="${(y - (px(68) - px(24)) * 0.73).toFixed(1)}" font-family="JetBrains Mono" font-weight="500" font-size="${px(24)}" letter-spacing="${px(3)}" fill="${THEME.label}">${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}</text>`
    )
    out.push(
      `<text x="${tx.toFixed(1)}" y="${y}" font-family="JetBrains Mono" font-weight="700" font-size="${px(28)}" letter-spacing="${px(3)}" fill="${THEME.past}">${daysLeft === 1 ? 'DAY' : 'DAYS'} LEFT</text>`
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
  // Whole-pixel rects rather than a stroke, so every pixel of a 1px or 2px
  // mark is solid and the two sides mirror exactly. Skipped outright if any
  // would fall off the canvas, rather than drawn lopsided.
  const w = Math.round(Number(layout.corners))
  if (w > 0) {
    const len = Math.round(pitch) + Math.floor(w / 2)
    const xl = Math.round(left - pitch) - Math.floor(w / 2)
    // The block is always centred, so the right marks mirror the left ones;
    // rounding each side on its own shifts one a pixel when the block's edges
    // fall on half pixels, as an odd grid width puts them.
    const xr = W - xl - w
    const yt = Math.round(y0 - above - pitch) - Math.floor(w / 2)
    const yb = Math.round(bottom + pitch) - Math.ceil(w / 2)
    if (xl >= 0 && xr + w <= W && yt >= 0 && yb + w <= H) {
      const arms = [
        [xl, yt, w, len], [xl, yt, len, w], [xr, yt, w, len], [xr + w - len, yt, len, w],
        [xl, yb + w - len, w, len], [xl, yb, len, w], [xr, yb + w - len, w, len], [xr + w - len, yb, len, w],
      ]
      out.push(
        `<g fill="${THEME.future}">${arms.map(([x, y, aw, ah]) => `<rect x="${x}" y="${y}" width="${aw}" height="${ah}"/>`).join('')}</g>`
      )
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${out.join('')}</svg>`
}
