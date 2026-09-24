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

# `screens DESKTOP ULTRAWIDE` gives each screen the picture of its shape: the
# MacBook is 1.54:1 and 16:9 is 1.78:1; the XG43VQ is 3.2:1, so anything past
# 2.2:1 counts as ultrawide. A screen already showing the right file is left
# alone. Unplugging a display can hand its picture to the one that's left, and
# comparing first means a run a minute catches that without resetting every
# screen each time. It prints "fetch" if an ultrawide screen is waiting on an
# image that isn't downloaded yet (that screen gets the MacBook one
# meanwhile), and "changed" if it set anything.
# NSWorkspace rather than System Events: no Apple Events means no automation
# prompt, which a LaunchAgent has no window to show.
screens() {
  osascript -l JavaScript -e '
    ObjC.import("AppKit")
    const wide = (s) => s.frame.size.width / s.frame.size.height > 2.2
    function run(argv) {
      const ws = $.NSWorkspace.sharedWorkspace
      const has = (p) => $.NSFileManager.defaultManager.fileExistsAtPath(p)
      const norm = (u) => ObjC.unwrap(u.URLByStandardizingPath.path) || ""
      const screens = $.NSScreen.screens
      let waiting = false, changed = false
      for (let i = 0; i < screens.count; i++) {
        const s = screens.objectAtIndex(i)
        if (wide(s) && !has(argv[1])) waiting = true
        const path = wide(s) && has(argv[1]) ? argv[1] : argv[0]
        let shown = ""
        try { shown = norm(ws.desktopImageURLForScreen(s)) } catch (e) {}
        if (shown === norm($.NSURL.fileURLWithPath(path))) continue
        const ok = ws.setDesktopImageURLForScreenOptionsError(
          $.NSURL.fileURLWithPath(path), s, $.NSDictionary.dictionary, null)
        if (!ok) throw new Error("macOS refused the desktop picture")
        changed = true
      }
      return [waiting ? "fetch" : "", changed ? "changed" : ""].join(" ").trim()
    }' "$@"
}

# fetch URL FILE: downloads an image unless it's already there. No retries
# within a run, since the next run is a minute away, but after a failure it
# waits 15 minutes before trying again and logs only the first, so a missing
# image can't keep the agent busy or fill the log.
fetch() {
  [ -s "$2" ] && return 0
  [ -n "$(find "$2.failed" -mmin -15 2>/dev/null)" ] && return 1
  # -L because Pages redirects github.io to a custom domain when the account
  # has one; without it curl saves the redirect page and exits 0. Anything
  # that isn't a PNG would become the default wallpaper and stay that way.
  if ! curl -fsSL --proto-redir =https --connect-timeout 20 -o "$2.part" "$1" ||
    [ "$(dd if="$2.part" bs=1 skip=1 count=3 2>/dev/null)" != PNG ]; then
    rm -f "$2.part"
    [ -e "$2.failed" ] || echo "$(date '+%F %T') could not fetch ${2#"$DIR"/}" >&2
    touch "$2.failed"
    return 1
  fi
  mv "$2.part" "$2"
  rm -f "$2.failed"
  echo "$(date '+%F %T') fetched ${2#"$DIR"/}"
}

cmd_run() {
  base=${1:?usage: annum.sh run URL}
  today=$(date +%F)
  # A new filename each day matters: macOS caches the picture by path and
  # won't redraw one whose path hasn't changed.
  desk="$DIR/desktop/$today.png"
  wide="$DIR/ultrawide/$today.png"
  mkdir -p "$DIR/desktop" "$DIR/ultrawide"
  fetch "$base/$today.png" "$desk" || exit 1

  # The ultrawide render is fetched only once such a screen is connected. If
  # it can't be — not deployed yet, or "ultrawide": false — that screen keeps
  # the MacBook picture.
  result=$(screens "$desk" "$wide")
  case $result in *fetch*)
    fetch "${base%/desktop}/ultrawide/$today.png" "$wide" &&
      result="$result $(screens "$desk" "$wide")" ;;
  esac
  # macOS's wallpaper agent has been seen applying a stale cached picture
  # just after a new one is set, and a display that has just been plugged in
  # can still be settling, so look again shortly after changing anything.
  case $result in *changed*)
    sleep 5
    screens "$desk" "$wide" >/dev/null ;;
  esac

  # Keep a week. Spaces that weren't in front during a run still point at an
  # older file, and a deleted one turns into the default wallpaper on login.
  # The trailing * catches a .part or .failed left behind.
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

  # Fail here, with a reason, rather than quietly every minute.
  today=$(date +%F)
  if ! curl -fsSIL --proto-redir =https -o /dev/null "$url/$today.png"; then
    echo "couldn't fetch $today.png from that URL." >&2
    echo "Check the slug, and that the workflow has deployed since desktop support was added." >&2
    exit 1
  fi

  mkdir -p "$DIR" "$(dirname "$PLIST")" "$(dirname "$LOG")"
  # Run from a copy, so the agent survives the download or clone being deleted.
  [ "$0" -ef "$DIR/annum.sh" ] || cp "$0" "$DIR/annum.sh"

  # On login, whenever macOS rewrites its display arrangement (as it does
  # when a display is plugged in or unplugged), and every minute, since Apple
  # calls watching a path race-prone. Intervals missed while asleep aren't
  # made up, but the next comes within a minute of waking, so a laptop that
  # slept through midnight catches up when it's opened. A run with nothing to
  # do is one osascript that changes nothing, at background priority.
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
  <key>StartInterval</key><integer>60</integer>
  <key>WatchPaths</key>
  <array><string>/Library/Preferences/com.apple.windowserver.displays.plist</string></array>
  <key>ProcessType</key><string>Background</string>
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
