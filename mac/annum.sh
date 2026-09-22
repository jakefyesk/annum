#!/bin/sh
# Sets today's annum wallpaper as the Mac's desktop picture — the counterpart to
# the iOS Shortcut. Like the phone, the Mac resolves today's date itself, so the
# picture follows its timezone through DST and travel.
#
#   sh annum.sh install [URL]   # installs a LaunchAgent; prompts for the URL if omitted
#   sh annum.sh uninstall
#   sh annum.sh run URL         # what the LaunchAgent runs
#
# URL is your wallpaper folder, https://<user>.github.io/annum/w/<slug>, or any
# image in it — the phone's or the desktop's. The desktop folder is found from it.
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
    # The retries cover waking from sleep before the network is back. -L
    # because Pages redirects github.io to a custom domain when the account has
    # one; without it curl saves the redirect page and exits 0.
    if ! curl -fsSL --proto-redir =https --retry 5 --retry-delay 30 --retry-all-errors \
      -o "$file.part" "$base/$today.png"; then
      rm -f "$file.part"
      echo "$(date '+%F %T') could not fetch $today.png" >&2
      exit 1
    fi
    # Anything that isn't a PNG would become the default wallpaper and stay
    # that way all day, since the file exists and is never fetched again.
    if [ "$(dd if="$file.part" bs=1 skip=1 count=3 2>/dev/null)" != PNG ]; then
      rm -f "$file.part"
      echo "$(date '+%F %T') $today.png is not a PNG" >&2
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
  # The trailing * catches a .part left by a download killed at logout.
  find "$DIR" -name '????-??-??.png*' -mtime +7 -delete
}

cmd_install() {
  url=${1:-}
  if [ -z "$url" ]; then
    # Prompted rather than required on the command line, so the slug stays
    # out of shell history.
    printf 'Wallpaper URL (https://<user>.github.io/annum/w/<slug>): '
    # EOF, or a piped URL with no newline, falls through to the checks below.
    read -r url || :
  fi
  # Accept the phone's URL, which is the one to hand, or the desktop's, with or
  # without a date; the build always puts the desktop in desktop/ beside it.
  case $url in *.png) url=${url%/*} ;; esac
  url=${url%/}
  case $url in */desktop) ;; *) url=$url/desktop ;; esac
  # Also keeps the plist below well-formed without escaping anything.
  case $url in
    https://*[!A-Za-z0-9:/._~-]*) echo "unexpected characters in $url" >&2; exit 1 ;;
    https://?*) ;;
    *) echo "expected an https:// URL" >&2; exit 1 ;;
  esac

  # Fail here, with a reason, rather than quietly every hour.
  today=$(date +%F)
  if ! curl -fsSIL --proto-redir =https -o /dev/null "$url/$today.png"; then
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

  # bootout can return before a running job has unloaded, and bootstrapping
  # over it fails with a bare "Bootstrap failed: 5", so wait for it to go.
  uid=$(id -u)
  launchctl bootout "gui/$uid/$LABEL" 2>/dev/null || true
  n=0
  while launchctl print "gui/$uid/$LABEL" >/dev/null 2>&1 && [ $n -lt 20 ]; do
    sleep 0.5
    n=$((n + 1))
  done
  launchctl bootstrap "gui/$uid" "$PLIST"
  echo "installed for $url"
  echo "Today's wallpaper should appear in a moment; the log is $LOG"
}

cmd_uninstall() {
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST" "$LOG"
  rm -rf "$DIR"
  echo "uninstalled. Pick a new picture in System Settings → Wallpaper."
}

case ${1:-} in
  run) shift; cmd_run "$@" ;;
  install) shift; cmd_install "$@" ;;
  uninstall) cmd_uninstall ;;
  *) sed -n '2,11p' "$0" >&2; exit 1 ;;
esac
