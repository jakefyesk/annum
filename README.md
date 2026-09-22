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

The repo is public and the wallpapers are served unauthenticated. Both of those
leak, and they leak differently:

- **The config** would expose exact dates and labels. It never enters the repo.
  Your real settings live in the `ANNUM_CONFIG` repository secret as base64 JSON;
  `config.json` is gitignored, and only `config.example.json` is tracked.
- **The image itself** is the subtler one. The next milestone's label is drawn as
  literal text, and range dots reveal which weeks you're away — no label needed.
  Marking a milestone `"private": true` keeps its marker and countdown but drops
  the words. `"redactLabels": true` does that globally.
- **The URL** is the only thing protecting the image. Set `ANNUM_SLUG` to a random
  string and the wallpapers publish under an unguessable path. This is
  share-link security, not authentication — anyone holding the URL can read it,
  so treat it like a "anyone with the link" document.

Three checks enforce this rather than relying on care:

| Check | Where | Catches |
|---|---|---|
| `scripts/guard.mjs` | pre-commit hook | personal data staged for commit |
| `scripts/guard.mjs` | CI, before build | the same, if the hook was bypassed |
| `scripts/verify-dist.mjs` | CI, before deploy | anything unexpected in the payload |

Enable the hook once per clone:

```bash
git config core.hooksPath .githooks
```

## Setup

1. **Build your config.** Open the Pages site, add milestones and ranges, and
   watch the preview. The page is static and sends nothing anywhere.
2. **Store it.** Copy the base64 blob into `Settings → Secrets and variables →
   Actions → New repository secret`, named `ANNUM_CONFIG`. Add `ANNUM_SLUG` with a
   random string if you want an unguessable URL.
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
  "layout": { "top": 1180, "shape": "circle" },
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
laid out differently.

Emoji are vendored as Fluent Emoji 3D PNGs in `emoji/`, named by codepoint, because CI has
no colour emoji font. Add one with `node scripts/add-emoji.mjs 🎿`. A
milestone whose emoji has no sprite falls back to an accent ring.

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
