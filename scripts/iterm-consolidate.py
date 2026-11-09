#!/usr/bin/env python3
"""Move iTerm2 tabs into one window, for real — Consolidate on the advocates view (bc-4olsx.3).

    iterm-consolidate.py <home-tty> <workspace> <tty> [<tty> ...]

iTerm's AppleScript cannot move a tab between windows; its Python API can:
`Window.async_set_tabs(tabs)` accepts tabs that currently live in other windows and moves
them in, process, scrollback and all. So nothing is interrupted — a busy session moves as
safely as an idle one — which is why lib/tabpark.js prefers this over parking and
resuming.

- `<home-tty>` names the home window by a tty of a session already in it. A tty rather
  than a window id because the AppleScript window id (what beadcause records in
  `itermWindows`) and the Python API's `window_id` are different namespaces; a tty is the
  one key both sides share.
- `<workspace>` is written to `user.beadcauseWorkspace` on every session in the home
  window, so scripts/open-session.applescript recognises the window as the workspace's
  next time — the same variable it sets on every tab it opens.
- each `<tty>` is a session to bring into the home window (its whole tab moves).

Prints one JSON object: `{"moved": [tty...], "missing": [tty...], "home": true}`.
Exits 3 when the `iterm2` package is not importable, 4 when the home tty is not in any
window, 5 when the API refused (connection / auth) — lib/termbackend-iterm.js reads the
exit code and falls back. Authentication is the caller's: ITERM2_COOKIE and ITERM2_KEY
in the environment (`request cookie and key for app named "beadcause"`).
"""
import json
import sys

try:
    import iterm2  # type: ignore
except Exception:  # noqa: BLE001 — any import failure means "no API here"
    print(json.dumps({"error": "the iterm2 Python package is not installed"}))
    sys.exit(3)

WORKSPACE_VARIABLE = "user.beadcauseWorkspace"


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "usage: iterm-consolidate.py <home-tty> <workspace> <tty>..."}))
        sys.exit(2)
    home_tty, workspace, wanted = sys.argv[1], sys.argv[2], set(sys.argv[3:])
    result = {}

    async def run(connection):
        app = await iterm2.async_get_app(connection)
        home = None
        tab_of_tty = {}
        for window in app.terminal_windows:
            for tab in window.tabs:
                for session in tab.sessions:
                    tty = await session.async_get_variable("tty")
                    if not tty:
                        continue
                    tab_of_tty[tty] = (window, tab)
                    if tty == home_tty:
                        home = window
        if home is None:
            result.update({"error": f"no window holds {home_tty}"})
            return
        moving = []
        missing = []
        for tty in sorted(wanted):
            hit = tab_of_tty.get(tty)
            if hit is None:
                missing.append(tty)
                continue
            window, tab = hit
            if window.window_id != home.window_id and all(t.tab_id != tab.tab_id for t in moving):
                moving.append(tab)
        moved = sorted(t for t in wanted if t in tab_of_tty)
        if moving:
            await home.async_set_tabs(list(home.tabs) + moving)
        # Mark the window as the workspace's, so the open script reuses it.
        if workspace:
            for tab in home.tabs:
                for session in tab.sessions:
                    try:
                        await session.async_set_variable(WORKSPACE_VARIABLE, workspace)
                    except Exception:  # noqa: BLE001 — a label is a courtesy
                        pass
        result.update({"moved": moved, "missing": missing, "home": True})

    try:
        iterm2.run_until_complete(run, retry=False)
    except Exception as err:  # noqa: BLE001
        print(json.dumps({"error": f"the iTerm2 Python API refused: {err}"}))
        sys.exit(5)
    print(json.dumps(result))
    sys.exit(4 if "error" in result else 0)


main()
