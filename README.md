# annum

A year, one dot at a time.

A lock screen wallpaper that renders the current year as a horizontal dot grid —
seven rows tall, read left to right, so it scans like a progress bar rather than a
calendar. Significant dates become emoji markers, date ranges tint their dots, and
the footer counts down to whatever comes next.

Everything runs on GitHub: Actions renders the images, Pages serves them, and an
iOS Shortcut sets one as your wallpaper each morning. No server, no cron, no
third-party account.

---

## How it works

Every day of the year is rendered ahead of time. Your phone resolves today's date
locally and fetches that file:

```
https://<user>.github.io/annum/w/<slug>/2026-09-22.png
```

This is why there is no scheduled workflow. Nothing needs to keep a "current"
image up to date, so there is no cron to drift, no job to be dropped under load,
and no 60-day inactivity timer to work around. It also means the date is always
correct — the phone knows its own timezone, including DST and travel, which a
server rendering on a fixed schedule does not.

Two years are rendered at a time (~15 MB, against a 1 GB Pages limit), so the
year rollover needs no attention either.

## Privacy

Worth being precise about, because the obvious framing is wrong. **Almost
everything in the config is already visible in the wallpaper** — dates, emoji,
visible labels, which weeks are tinted. The PNG is served unauthenticated. The
only things the config holds that the image doesn't are the true labels of
`private: true` milestones and range labels, which are never drawn.

So the thing worth protecting isn't the *content*, it's **discoverability**:

- A committed `config.json` lands in public, listed, search-indexed git history,
  permanently, and can't be retracted.
- The wallpaper lives at an unlisted URL that nobody can guess.

The slug is doing the real work. Which is why the two settings are stored
differently:

| | Store | Why |
|---|---|---|
| `ANNUM_SLUG` | secret | The only thing keeping wallpapers off a guessable URL |
| `ANNUM_CONFIG` | secret **and** variable | The secret is what CI reads; the variable is the readable mirror |

The config is deliberately in both stores, because neither alone works on a
public repo:

- **The runner prints every step's `env:` block into the log**, and only secrets
  are masked there. A variable would publish your calendar in clear base64 on
  every single build. This is not hypothetical — it happened once here, and the
  run had to be deleted.
- **Secrets are write-only.** There is no way to read one back, so a secret
  alone makes "what's on the calendar right now?" unanswerable, and
  conversational editing impossible.

`scripts/events.mjs` writes both in one step. Always edit through it, or the two
will drift and CI will quietly render something other than what you can read.

The base64 is not encryption and never was — it only means a stray trace prints
a blob instead of prose. Don't rely on it.

For label-level control, `"private": true` on a milestone keeps its marker and
countdown but drops the words from the image; `"redactLabels": true` does that
globally.

Three checks keep the config out of git history, where no slug would help:

| Check | Where | Catches |
|---|---|---|
| `scripts/guard.mjs` | pre-commit hook | personal data staged for commit |
| `scripts/guard.mjs` | CI, before build | the same, if the hook was bypassed |
| `scripts/verify-dist.mjs` | CI, before deploy | anything unexpected in the payload |

Enable the hook once per clone:

```bash
git config core.hooksPath .githooks
```

## Editing events

```bash
node scripts/events.mjs list
node scripts/events.mjs add 2026-11-01 "NYC Marathon" 🗽
node scripts/events.mjs add 2026-07-04 "Something" --private
node scripts/events.mjs rm "NYC Marathon"
node scripts/events.mjs range 2026-12-20 2026-12-31
node scripts/events.mjs deploy
```

Each command reads the current variable, edits it, writes it back, and mirrors
the result into a gitignored local `config.json`. `pull` and `push` move between
the two by hand. Because the variable reads back, this is all editable in
conversation — "add the marathon on 1 November" is enough.

## Setup

1. **Build your config.** Open the Pages site, add milestones and ranges, and
   watch the preview. The page is static and sends nothing anywhere.
2. **Store it.** Copy the base64 blob into `Settings → Secrets and variables →
   Actions → Variables`, named `ANNUM_CONFIG` — a variable, not a secret, so it
   can be read back and edited later. Then add `ANNUM_SLUG` as a *secret*
   (`openssl rand -hex 16`) to move the wallpapers off a guessable URL.
3. **Deploy.** `Settings → Pages → Source: GitHub Actions`, then run the workflow.
4. **Automate the phone.** Shortcuts → Automation → Time of Day, 6:00 AM, Daily,
   Run Immediately → Create New Shortcut:

   - **Get Contents of URL** — paste your wallpaper URL, then insert the
     `Current Date` variable where the date goes and set its format to
     `yyyy-MM-dd`.
   - **Set Wallpaper Photo** — Lock Screen. Tap the arrow and disable both
     *Crop to Subject* and *Show Preview*, or iOS will crop the image and ask for
     confirmation every morning.

## Config

```jsonc
{
  "years": [2026, 2027],
  "redactLabels": false,
  "layout": { "top": 1180, "shape": "circle", "markerScale": 1.2 },
  "footer": { "showYear": true, "maxMilestones": 12 },
  "milestones": [
    { "date": "2026-11-01", "label": "Marathon", "emoji": "🏃" },
    { "date": "2026-07-04", "private": true, "publicLabel": "Countdown" }
  ],
  "ranges": [
    { "start": "2026-12-20", "end": "2026-12-31", "color": "#3D7EFF" }
  ]
}
```

`layout.top` is the vertical offset of the grid in pixels. The default of 1180
clears the widget stack on an iPhone 14 Pro Max; shift it if your lock screen is
laid out differently. `markerScale` sizes milestone markers relative to the dot
pitch.

Below the grid the year countdown comes first and carries the most weight, so a
milestone number can never be misread as days left in the year. Beneath it every
milestone is listed in calendar order — not by proximity — with past dates
counting backwards (`-93`). The list trims itself to whatever fits above
`footer.safeBottom`, which keeps it clear of the lock screen controls.

Emoji are Fluent Emoji 3D PNGs, because CI has no colour emoji font. Any of the
~1,600 emoji in `emoji/fluent-index.json` just works: if your config references
one that isn't vendored in `emoji/`, the build fetches it. An emoji that isn't in
Fluent at all fails the build rather than quietly publishing a blank marker.

Vendoring is only an optimisation — `node scripts/add-emoji.mjs 🗽` commits a
sprite so the build doesn't fetch it each time. Re-run `build-emoji-index.mjs`
if Fluent adds emoji newer than the committed index.

## Development

```bash
npm install
npm run build     # renders into dist/ using config.json, or the example
npm run guard     # the pre-commit check, run by hand
```

`src/calendar.mjs` emits an SVG string and touches nothing else — no filesystem,
no network. The browser preview and the CI renderer import the same module, so
what you see while configuring is what lands on your phone.

One performance note worth keeping: the renderer is constructed per image, and
passing fonts as `fontBuffers` re-parses them every time — 355 ms per render
versus 50 ms with `fontDirs`. Use `fontDirs` anywhere there's a filesystem.

## Credits

Inspired by [thelifecalendar.com](https://thelifecalendar.com) by
[@luismbat](https://x.com/luismbat) and [@joao_batalha](https://x.com/joao_batalha),
rebuilt from scratch with a different layout and feature set. Emoji artwork from
[Fluent Emoji](https://github.com/microsoft/fluentui-emoji) by Microsoft, MIT licensed.
