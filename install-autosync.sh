#!/bin/bash
# One-time installer for automated publishing on macOS.
#
# Registers auto-sync.mjs as a launchd user agent that runs every day at a
# fixed hour (default 18:00). If the Mac is asleep at that time, launchd runs
# the job when it next wakes. Re-running this script replaces the job, so use
# it to change the hour too.
#
#   ./install-autosync.sh        # publish daily at 18:00
#   ./install-autosync.sh 7      # publish daily at 07:00
#
# Prerequisite (once): put the API key in the macOS Keychain so the job can
# read it without any shell profile:
#
#   security add-generic-password -U -a "$USER" -s ANTHROPIC_API_KEY -w 'sk-ant-...'
#
# To uninstall:
#   launchctl unload ~/Library/LaunchAgents/com.courses-site.autosync.plist
#   rm ~/Library/LaunchAgents/com.courses-site.autosync.plist

set -euo pipefail

HOUR="${1:-18}"
REPO="$(cd "$(dirname "$0")" && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.courses-site.autosync.plist"
LOG="$HOME/Library/Logs/courses-autosync.log"

NODE="$(PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" command -v node)" || {
  echo "node not found — install Node 22+ first" >&2
  exit 1
}

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.courses-site.autosync</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$REPO/auto-sync.mjs</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>$HOUR</integer>
    <key>Minute</key><integer>0</integer>
  </dict>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo "Installed: the site publishes itself daily at $(printf '%02d' "$HOUR"):00."
echo "  Log:        $LOG"
echo "  Test now:   launchctl start com.courses-site.autosync"
echo "  Uninstall:  launchctl unload $PLIST && rm $PLIST"

if ! security find-generic-password -a "$USER" -s ANTHROPIC_API_KEY -w >/dev/null 2>&1; then
  echo ""
  echo "⚠ No ANTHROPIC_API_KEY in the Keychain yet. Add it once with:"
  echo "  security add-generic-password -U -a \"\$USER\" -s ANTHROPIC_API_KEY -w 'sk-ant-...'"
fi
