#!/bin/sh
# Sets today's annum wallpaper as the Mac's desktop picture — the counterpart to
# the iOS Shortcut. Like the phone, the Mac resolves today's date itself, so the
# picture follows its timezone through DST and travel.
#
#   sh annum.sh install [URL]   # installs a LaunchAgent; prompts for the URL if omitted
#   sh annum.sh uninstall
#   sh annum.sh run URL         # what the LaunchAgent runs
#
# URL is your desktop folder: https://<user>.github.io/annum/w/<slug>/desktop
set -eu

LABEL=io.github.annum.desktop
DIR="$HOME/Library/Application Support/annum"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/annum.log"

# NSWorkspace rather than System Events: no Apple Events means no automation
# permission prompt, which a LaunchAgent has no window to show.
set_picture() {
  osascript -l JavaScript -e '
    ObjC.import("AppKit")
    function run(argv) {
      const url = $.NSURL.fileURLWithPath(argv[0])
      const screens = $.NSScreen.screens
      for (let i = 0; i < screens.count; i++) {
        const ok = $.NSWorkspace.sharedWorkspace.setDesktopImageURLForScreenOptionsError(
          url, screens.objectAtIndex(i), $.NSDictionary.dictionary, null)
        if (!ok) throw new Error("macOS refused the desktop picture")
      }
    }' "$1"
}

cmd_run() {
  base=${1:?usage: annum.sh run URL}
  today=$(date +%F)
  file="$DIR/$today.png"
  mkdir -p "$DIR"

  if [ ! -s "$file" ]; then
    # The retries cover waking from sleep before the network is back.
    if ! curl -fsS --retry 5 --retry-delay 30 --retry-all-errors -o "$file.part" "$base/$today.png"; then
      rm -f "$file.part"
      echo "$(date '+%F %T') could not fetch $today.png" >&2
      exit 1
    fi
    mv "$file.part" "$file"
    echo "$(date '+%F %T') fetched $today.png"
  fi

  # A new filename each day matters: macOS caches the picture by path and
  # won't redraw one whose path hasn't changed.
  set_picture "$file"

  # Keep a week. Spaces that weren't in front during a run still point at an
  # older file, and a deleted one turns into the default wallpaper on login.
  find "$DIR" -name '????-??-??.png' -mtime +7 -delete
}

cmd_install() {
  url=${1:-}
  if [ -z "$url" ]; then
    # Prompted rather than required on the command line, so the slug stays
    # out of shell history.
    printf 'Desktop wallpaper URL (https://<user>.github.io/annum/w/<slug>/desktop): '
    read -r url
  fi
  # Accept a pasted image URL too, and drop any trailing slash.
  case $url in *.png) url=${url%/*} ;; esac
  url=${url%/}
  # Also keeps the plist below well-formed without escaping anything.
  case $url in
    https://*[!A-Za-z0-9:/._~-]*) echo "unexpected characters in $url" >&2; exit 1 ;;
    https://?*) ;;
    *) echo "expected an https:// URL" >&2; exit 1 ;;
  esac

  # Fail here, with a reason, rather than quietly every hour.
  today=$(date +%F)
  if ! curl -fsSI -o /dev/null "$url/$today.png"; then
    echo "couldn't fetch $today.png from that URL." >&2
    echo "Check the slug, and that the workflow has deployed since desktop support was added." >&2
    exit 1
  fi

  mkdir -p "$DIR" "$(dirname "$PLIST")" "$(dirname "$LOG")"
  # Run from a copy, so the agent survives the download or clone being deleted.
  [ "$0" -ef "$DIR/annum.sh" ] || cp "$0" "$DIR/annum.sh"

  # On login, then hourly at :01. launchd runs a missed interval once on wake,
  # so a laptop that slept through midnight catches up when it's opened.
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>$DIR/annum.sh</string>
    <string>run</string>
    <string>$url</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>StartCalendarInterval</key>
  <dict><key>Minute</key><integer>1</integer></dict>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF

  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  echo "installed. Today's wallpaper should appear in a moment; the log is $LOG"
}

cmd_uninstall() {
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  rm -rf "$DIR"
  echo "uninstalled. Pick a new picture in System Settings → Wallpaper."
}

case ${1:-} in
  run) shift; cmd_run "$@" ;;
  install) shift; cmd_install "$@" ;;
  uninstall) cmd_uninstall ;;
  *) sed -n '2,10p' "$0" >&2; exit 1 ;;
esac
