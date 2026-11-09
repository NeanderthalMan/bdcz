-- Which window every iTerm session is in, and whose window that is (bc-4olsx.3).
--
-- One line per session: its tty, the id of the window holding it, and the value of its
-- `user.beadcauseWorkspace` variable (empty for a tab nobody here opened), separated by
-- tabs. lib/termbackend-iterm.js reads it back with `parseTabWindows`.
--
-- Its own script rather than a column added to scripts/iterm-ttys.applescript, because
-- that one's output is read as a bare Set of ttys by `hostedTtys` in lib/session.js and
-- is polled; this one is asked once per Consolidate press. lib/tabpark.js needs it for
-- the one thing no other probe answers — whether a tab is *already* in its workspace's
-- home window — and it reads the workspace variable for the reason
-- scripts/open-session.applescript does: a recorded window id is only the workspace's
-- while one of its tabs still carries the workspace, because iTerm reuses ids.
--
-- Two properties it shares with the ttys probe: it never launches iTerm (a closed iTerm
-- answers nothing), and it is a pure reading — no `select`, no `activate`, nothing moved.
--
-- The separator is set outside the `tell` block on purpose: inside it, `tab` is iTerm's
-- class, not the character.

on run
	if not (application id "com.googlecode.iterm2" is running) then return ""

	set sep to character id 9
	set found to {}
	tell application id "com.googlecode.iterm2"
		repeat with w in windows
			set wid to ""
			try
				set wid to (id of w) as text
			end try
			repeat with t in tabs of w
				repeat with s in sessions of t
					set owner to ""
					try
						tell s to set owner to (variable named "user.beadcauseWorkspace")
					end try
					if owner is missing value then set owner to ""
					try
						set end of found to ((tty of s) & sep & wid & sep & owner)
					end try
				end repeat
			end repeat
		end repeat
	end tell

	set text item delimiters to linefeed
	return found as text
end run
