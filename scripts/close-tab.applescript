-- Close the iTerm2 tab holding a session, addressed by its id or its tty.
--
-- lib/reap.js's closer for a tab that opened and never ran its command
-- (bc-xl7n.113.3). `close-empty-windows.applescript` closes a window whose last tab has
-- already gone; this is its sibling for the tab that never had a session tear itself
-- down in the first place, so the handle it is given still names a live session, not
-- an empty frame.
--
-- Closes the TAB, not the window around it, and not the session inside it. Two reasons,
-- one on each side:
--
--   - **Not the window**, because since bc-2uj4.16.2 a window is a workspace's, with one
--     tab per session in it. This used to be close-window.applescript, back when every
--     session had a window of its own; closing the window now would end every sibling
--     session in it, which is the one thing the reap must never do.
--   - **Not the session**, because `terminate` on a session leaves an empty frame behind
--     exactly as it did for the two windows caught in bc-30ve. `close` of a tab takes its
--     sessions with it, and `close` of a window's last tab closes the window too
--     (measured, iTerm 3.6.11 — see close-empty-windows.applescript), so a tab that was
--     the only one left does not become the empty frame that script exists to sweep.
--
-- **Does no verification of its own.** Everything that decides whether it is safe to call
-- this — the tab still names the bead, no `claude` process on its tty — happens in Node,
-- against describe-session.applescript, before this ever runs. Closing is the one
-- irreversible act in the whole feature, so it is kept to the smallest thing that does
-- only that, with nothing here for a mistake in the decision to hide behind.
--
-- The tab is found by its window's id and its position, and closed through `tab i of
-- window id w` rather than the loop's own reference: `repeat with t in tabs of w` hands
-- back a position in a list, and resolving one after the loop has moved on is how
-- focus-session.applescript learned to address windows by id.
--
-- Prints `closed`, or `missing` when no session carries the handle any more.
--
-- Never launches iTerm: with iTerm not running there is no tab to close.

on run argv
	set wantedId to item 1 of argv
	if not (application id "com.googlecode.iterm2" is running) then return "missing"

	tell application id "com.googlecode.iterm2"
		set targetWin to missing value
		set targetTab to 0
		repeat with w in windows
			set n to count of tabs of w
			repeat with i from 1 to n
				repeat with s in sessions of (tab i of w)
					if ((id of s) as text) is equal to wantedId or (tty of s) is equal to wantedId then
						set targetWin to id of w
						set targetTab to i
						exit repeat
					end if
				end repeat
				if targetWin is not missing value then exit repeat
			end repeat
			if targetWin is not missing value then exit repeat
		end repeat
		if targetWin is missing value then return "missing"
		try
			close (tab targetTab of window id targetWin)
		on error
			return "missing"
		end try
	end tell
	return "closed"
end run
