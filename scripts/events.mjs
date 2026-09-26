// Read/write the ANNUM_CONFIG variable so events can be edited in conversation
// without anyone hand-rolling base64.
//
//   node scripts/events.mjs list
//   node scripts/events.mjs add 2026-11-01 "NYC Marathon" 🗽 [--private]
//   node scripts/events.mjs rm "NYC Marathon"
//   node scripts/events.mjs range 2026-12-20 2026-12-31 [#3D7EFF]
//   node scripts/events.mjs birthday 1990-05-12 [80]
//   node scripts/events.mjs birthday off
//   node scripts/events.mjs pull          # variable -> local config.json
//   node scripts/events.mjs push          # local config.json -> variable
//   node scripts/events.mjs deploy        # push, then trigger the workflow
//
// The variable is not masked in Actions logs, so nothing here ever prints it
// base64-encoded or echoes it into a command line — writes go via stdin.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LOCAL = join(ROOT, 'config.json')
const VAR = 'ANNUM_CONFIG'

const gh = (args, input) =>
  execFileSync('gh', args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'inherit'] })

const repo = () => gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']).trim()

function read() {
  try {
    const raw = gh(['api', `repos/${repo()}/actions/variables/${VAR}`, '--jq', '.value']).trim()
    return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'))
  } catch {
    console.error(`no ${VAR} set yet — starting from the example`)
    return JSON.parse(readFileSync(join(ROOT, 'config.example.json'), 'utf8'))
  }
}

// Two stores, written together and never separately:
//   secret   — what CI reads, because the runner masks secrets in the env block
//              it prints, and this repo's logs are public
//   variable — the readable mirror, because secrets are write-only and there is
//              otherwise no way to answer "what's on the calendar right now?"
// Splitting them is the price of a public repo; writing both here is what keeps
// them honest.
function write(config) {
  delete config._example
  delete config._readme
  const b64 = Buffer.from(JSON.stringify(config)).toString('base64')
  // gh reads the value from stdin when --body is omitted, which keeps it off
  // the process list and out of shell history.
  gh(['variable', 'set', VAR], b64)
  gh(['secret', 'set', VAR], b64)
  writeFileSync(LOCAL, JSON.stringify(config, null, 2) + '\n')
}

const fmt = (config) => {
  const ms = (config.milestones ?? []).slice().sort((a, b) => a.date.localeCompare(b.date))
  const lines = ms.map(
    (m, i) =>
      `  ${String(i).padStart(2)}  ${m.date}  ${(m.emoji ?? ' ').padEnd(2)}  ` +
      `${m.label ?? ''}${m.private ? '   [private]' : ''}`
  )
  const rs = (config.ranges ?? []).map(
    (r, i) => `  ${String(i).padStart(2)}  ${r.start} → ${r.end}  ${r.color ?? ''} ${r.label ?? ''}`
  )
  const life = config.birthday ? `${config.birthday}, life expectancy ${config.lifeExpectancy ?? 75}` : '(none)'
  return [
    `years: ${(config.years ?? []).join(', ')}`,
    `birthday: ${life}`,
    '',
    `milestones (${ms.length}):`,
    ...(lines.length ? lines : ['  (none)']),
    '',
    `ranges (${rs.length}):`,
    ...(rs.length ? rs : ['  (none)']),
  ].join('\n')
}

const [cmd, ...rest] = process.argv.slice(2)
const flags = rest.filter((a) => a.startsWith('--'))
const args = rest.filter((a) => !a.startsWith('--'))

switch (cmd) {
  case 'list': {
    console.log(fmt(read()))
    break
  }

  case 'add': {
    const [date, label, emoji] = args
    if (!date || !label) {
      console.error('usage: events.mjs add <YYYY-MM-DD> <label> [emoji] [--private]')
      process.exit(1)
    }
    const config = read()
    config.milestones ??= []
    const entry = { date, label, ...(emoji ? { emoji } : {}) }
    if (flags.includes('--private')) {
      entry.private = true
      entry.publicLabel = 'Countdown'
    }
    const at = config.milestones.findIndex((m) => m.date === date && m.label === label)
    if (at >= 0) config.milestones[at] = entry
    else config.milestones.push(entry)
    write(config)
    console.log(`${at >= 0 ? 'updated' : 'added'}: ${date} ${label}\n`)
    console.log(fmt(config))
    break
  }

  case 'rm': {
    const [needle] = args
    const config = read()
    const before = (config.milestones ?? []).length
    config.milestones = (config.milestones ?? []).filter(
      (m) => m.label !== needle && m.date !== needle
    )
    if (config.milestones.length === before) {
      console.error(`nothing matched "${needle}"`)
      process.exit(1)
    }
    write(config)
    console.log(`removed ${before - config.milestones.length}\n`)
    console.log(fmt(config))
    break
  }

  case 'range': {
    const [start, end, color] = args
    if (!start || !end) {
      console.error('usage: events.mjs range <start> <end> [#RRGGBB]')
      process.exit(1)
    }
    const config = read()
    config.ranges ??= []
    config.ranges.push({ start, end, color: color ?? '#3D7EFF' })
    write(config)
    console.log(fmt(config))
    break
  }

  case 'birthday': {
    const [date, years] = args
    const off = date === 'off'
    // Refused here rather than published as a bar that never draws: the
    // renderer skips a date it can't read and one still to come. Date.parse
    // takes 30 February as 2 March, so only a round trip proves a date.
    const t = Date.parse(`${date}T00:00:00Z`)
    const real = /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') && Number.isFinite(t) && new Date(t).toISOString().startsWith(date)
    const n = Number(years ?? 75)
    if (!off && (!real || Date.parse(`${date}T00:00:00`) > Date.now() || !Number.isInteger(n) || n < 1 || n > 150)) {
      console.error('usage: events.mjs birthday <YYYY-MM-DD> [years]   (a real date, not in the future; 1-150 years)')
      console.error('       events.mjs birthday off')
      process.exit(1)
    }
    const config = read()
    if (off) {
      delete config.birthday
      delete config.lifeExpectancy
    } else {
      config.birthday = date
      // 75 is the renderer's default, so it isn't written down.
      if (years !== undefined && n === 75) delete config.lifeExpectancy
      else if (years !== undefined) config.lifeExpectancy = n
    }
    write(config)
    console.log(`${off ? 'birthday removed' : `birthday: ${date}`}\n`)
    console.log(fmt(config))
    break
  }

  case 'pull': {
    const config = read()
    writeFileSync(LOCAL, JSON.stringify(config, null, 2) + '\n')
    console.log(`wrote config.json\n`)
    console.log(fmt(config))
    break
  }

  case 'push': {
    write(JSON.parse(readFileSync(LOCAL, 'utf8')))
    console.log(`pushed config.json to ${VAR}`)
    break
  }

  case 'deploy': {
    gh(['workflow', 'run', 'deploy.yml'])
    console.log('workflow triggered')
    break
  }

  default:
    console.error(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(0, 15).join('\n'))
    process.exit(1)
}
