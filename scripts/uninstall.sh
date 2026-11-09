#!/usr/bin/env bash
#
# Remove the beadcause background service.
#
#   npm run uninstall-service
#
# Deliberately leaves ~/.config/beadcause alone: it holds your token, and deleting
# it would silently un-pair every phone you have set up. Remove it by hand if you
# actually want a clean slate.
#
set -euo pipefail

LABEL="n12n.beadcause"
LEGACY_LABELS=("com.neo.beadcause" "com.beadcause" "n8l.beadcause" "m4m.beadcause")

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# The Claude Code allow rules install.sh merged in for bd (bc-eg9tj) — only the ones it
# added, from its ledger in ~/.config/beadcause; rules you had already are kept. First,
# because the systemd branch below exits early. Never fatal.
( cd "$ROOT" && node scripts/claude-permissions.mjs --uninstall ) || \
  echo " warn could not remove the Claude Code allow rules for bd — carrying on." >&2

# Linux: a systemd user unit (bc-obucr.3), chosen the way install.sh chooses it.
SERVICE_MANAGER="${BEADCAUSE_SERVICE_MANAGER:-}"
if [ -z "$SERVICE_MANAGER" ]; then
  case "$(uname -s)" in Linux) SERVICE_MANAGER=systemd ;; *) SERVICE_MANAGER=launchd ;; esac
fi
if [ "$SERVICE_MANAGER" = systemd ]; then
  unit="beadcause.service"
  unit_file="$HOME/.config/systemd/user/$unit"
  echo "==> stopping $unit"
  systemctl --user disable --now "$unit" 2>/dev/null || true
  [ -f "$unit_file" ] && { echo "==> removing $unit_file"; rm -f "$unit_file"; }
  systemctl --user daemon-reload 2>/dev/null || true
  # Lingering is left on: it is a per-user setting other services may rely on, and
  # install.sh may not have been what turned it on. `loginctl disable-linger` undoes it.
  echo "==> done. Config and token kept at ~/.config/beadcause (delete it by hand to fully reset)."
  echo "    lingering was left as it is; 'loginctl disable-linger' turns it off."
  exit 0
fi

# The monitor agent goes first: it is a child of this install, and leaving it loaded
# would open a window at every login for a daemon that is no longer there. The same
# holds for each legacy label's monitor.
AGENTS=("$LABEL.monitor" "$LABEL")
for legacy in "${LEGACY_LABELS[@]}"; do AGENTS+=("$legacy.monitor" "$legacy"); done
for label in "${AGENTS[@]}"; do
  plist="$HOME/Library/LaunchAgents/$label.plist"
  # Here-string, not a pipe — see the same note in install.sh. Under `set -o pipefail` a
  # `… | grep -q` that *matches* can report 141 via SIGPIPE, and a false "not loaded"
  # here skips the bootout while the plist is deleted anyway: the daemon then runs on
  # until logout with nothing left on disk to explain it.
  if grep -qF -- "$label" <<<"$(launchctl list 2>/dev/null)"; then
    echo "==> stopping $label"
    launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  fi
  [ -f "$plist" ] && { echo "==> removing $plist"; rm -f "$plist"; }
done

echo "==> done. Config and token kept at ~/.config/beadcause (delete it by hand to fully reset)."
