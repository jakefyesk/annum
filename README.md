# annum

A year, one dot at a time.

A lock screen wallpaper — with matching desktops for a MacBook Pro 14″ and an
ultrawide monitor — that renders the current year as a horizontal dot grid: seven
rows tall, read left to right, so it scans like a progress bar rather than a
calendar. Significant dates become
emoji markers, date ranges tint their dots, and the footer counts down to whatever
comes next.

Everything runs on GitHub: Actions renders the images, Pages serves them, an iOS
Shortcut sets one as your phone's wallpaper each morning, and a LaunchAgent does
the same on the Mac. No server, no cron, no third-party account.

---

## How it works

Every day of the year is rendered ahead of time. Your phone resolves today's date
locally and fetches that file, and so does your Mac:

```
https://<user>.github.io/annum/w/<slug>/2026-09-22.png             iPhone, 1290×2796
https://<user>.github.io/annum/w/<slug>/desktop/2026-09-22.png     MacBook Pro 14″, 3024×1964
https://<user>.github.io/annum/w/<slug>/ultrawide/2026-09-22.png   32:10 ultrawide, 3840×1200
```

This is why there is no scheduled workflow. Nothing needs to keep a "current"
image up to date, so there is no cron to drift, no job to be dropped under load,
and no 60-day inactivity timer to work around. It also means the date is always
correct — the phone knows its own timezone, including DST and travel, which a
server rendering on a fixed schedule does not.

Two years are rendered at a time (~45 MB for all three screens, against a 1 GB
Pages limit), so the year rollover needs no attention either.

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
2. **Store it.** Save the downloaded JSON as `config.json` and run
   `node scripts/events.mjs push`, which writes the `ANNUM_CONFIG` secret that
   CI reads and the variable that mirrors it (see Privacy). By hand, paste the
   base64 blob into `Settings → Secrets and variables → Actions` as both.
   Then add `ANNUM_SLUG` as a *secret* (`openssl rand -hex 16`) to move the
   wallpapers off a guessable URL.
3. **Deploy.** `Settings → Pages → Source: GitHub Actions`, then run the workflow.
4. **Automate the phone.** Shortcuts → Automation → Time of Day, 6:00 AM, Daily,
   Run Immediately → Create New Shortcut:

   - **Get Contents of URL** — paste your wallpaper URL, then insert the
     `Current Date` variable where the date goes and set its format to
     `yyyy-MM-dd`.
   - **Set Wallpaper Photo** — Lock Screen. Tap the arrow and disable both
     *Crop to Subject* and *Show Preview*, or iOS will crop the image and ask for
     confirmation every morning.
5. **Automate the Mac.** Download [`mac/annum.sh`](mac/annum.sh) and run
   `sh annum.sh install`. When it asks, paste the phone's wallpaper URL — with
   or without a date — and it finds the desktop images beside it:

   ```
   https://<user>.github.io/annum/w/<slug>
   ```

   It checks today's image exists, then installs a LaunchAgent that sets the
   desktop picture on login and every hour after. A Mac asleep at midnight
   catches up when it wakes. Each display gets the render of its shape: an
   ultrawide screen (wider than 2.2:1, like the ASUS XG43VQ) gets the 3840×1200
   one, and every other screen the MacBook's. A display plugged in between runs
   picks up its picture at the next one. It sets the picture through NSWorkspace rather than
   System Events, so there is no permission prompt — only the usual *Background
   Items Added* notice. macOS only changes the Space in front of each display,
   so other Spaces update when they're in front for a run. The log is
   `~/Library/Logs/annum.log`, and `sh annum.sh uninstall` removes everything.

## Config

```jsonc
{
  "years": [2026, 2027],
  "redactLabels": false,
  "layout": { "top": 1180, "shape": "circle", "markerScale": 1.2 },
  "footer": { "showYear": true, "maxMilestones": 12 },
  "desktop": {
    "layout": { "top": "auto", "balance": 1.25, "corners": 2 },
    "footer": { "columns": 3, "safeBottom": 260 }
  },
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

`desktop` and `ultrawide` take the same `layout` and `footer` keys for the Mac
wallpapers, each in its own pixels. Only the look carries over from the top
level — `shape`, `markerScale`, `dotRatio`, `showYear`, `maxMilestones` — because
a phone's `top` of 1180 is most of the way down a laptop screen. The defaults put
the grid below the menu bar, the notch and the lock screen clock, and stop the
milestone list, split into columns, above the Dock. Set `"desktop": false` or
`"ultrawide": false` to skip rendering one.

Both desktops centre themselves the way a picture framer cuts a mat. With
`"top": "auto"`, the space below the block is `balance` (1.25) times the space
above it, so its centre sits just above the middle, where it reads as centred
rather than sagging. It never starts higher than `safeTop`, the lock screen
clock's limit, and never so low that the list loses a row. On the MacBook the
width is chosen so that a full list comes out with top and side margins about
equal, as a mat's are; the ultrawide is too short for that, so a full list
there sits at `safeTop`. A number instead puts the grid's top row at that
pixel. `corners` draws faint corner marks one dot-pitch outside the block, that
many pixels wide; `0` turns them off.

A config made on the site or from the example before centring arrived pins
`desktop.layout.top` to 620 (and `ultrawide.layout.top` to 333), which turns
it off. `node scripts/events.mjs pull`, delete those keys from `config.json`,
then `push`.

Below the grid the year countdown comes first and carries the most weight, so a
milestone number can never be misread as days left in the year. Beneath it every
milestone is listed in calendar order — not by proximity — with past dates
counting backwards (`-93`). The list trims itself to `footer.maxMilestones` and
to whatever fits above `footer.safeBottom`, which keeps it clear of the lock
screen controls. When it trims, the oldest past dates go first, so every
upcoming milestone stays listed as long as there's room.

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
what you see while configuring is what lands on your screens. Each device is an
entry in its `DEVICES` table: a canvas size, safe areas, and a `scale` for type
that was drawn for the phone.

Two performance notes worth keeping:

- The renderer is constructed per image, and passing fonts as `fontBuffers`
  re-parses them every time — 355 ms per render versus 50 ms with `fontDirs`. Use
  `fontDirs` anywhere there's a filesystem.
- Use `renderAsync`, not `new Resvg(svg).render()`. The synchronous render never
  frees its pixmap: two years of phone wallpapers alone peaked at 10.7 GB. Adding the
  desktop would have exhausted a runner. The async path peaks near 1.2 GB for
  both devices.

## Credits

Inspired by [thelifecalendar.com](https://thelifecalendar.com) by
[@luismbat](https://x.com/luismbat) and [@joao_batalha](https://x.com/joao_batalha),
rebuilt from scratch with a different layout and feature set. Emoji artwork from
[Fluent Emoji](https://github.com/microsoft/fluentui-emoji) by Microsoft, MIT licensed.
