-- Open a session as a new tab in its workspace's iTerm2 window, making the window if
-- there is none.
--
-- Everything arrives through `argv` rather than being interpolated into the script
-- text. That matters: the command carries a path and a bead id that originate in an
-- HTTP request, and AppleScript string escaping is its own separate minefield on top of
-- shell quoting. With argv there is only one layer to get right, and Node owns it.
--
-- Addressed by bundle id because the app is called "iTerm" on disk but "iTerm2"
-- everywhere else, and which name the scripting bridge answers to has changed
-- between versions.
--
-- argv, in order. Everything after the first two is optional, and an empty string means
-- "nothing known" — which is what every failure below degrades to:
--
--   1. the command the tab runs — `launchCommand` in lib/session.js
--   2. the tab name
--   3. the profile to open with, or "" for iTerm's default profile
--   4. the id of the workspace's window as the daemon last recorded it, or ""
--   5. "return-focus" to hand the keyboard back, anything else to take it
--   6. the workspace, which labels the window and proves a recorded id is still ours
--
-- Prints the new session's id and the id of the window it went into, separated by a
-- space. The daemon keeps the second as the workspace's window for next time.
--
-- ## One window per workspace, one tab per session (bc-2uj4.16.2)
--
-- Every session used to get a window of its own, dealt onto a grid of scattered cards
-- (bc-gi8u). A day of normal running left a desk of them with nothing grouping them.
-- Now each workspace has one window and each session is a tab in it.
--
-- **A recorded window id is re-checked before it is used, and existing is not enough.**
-- iTerm reuses window ids freely (see lib/iterm.js, `unreportedStuck`), so an id that
-- still answers may be a different window: one Adam opened himself after ours was
-- closed. Every tab this script opens carries the workspace in the session variable
-- `user.beadcauseWorkspace`, and a window counts as the workspace's only while one of its
-- tabs still carries it. A tab Adam opened in that window by hand does not carry it, and
-- does not disqualify the window either. A window that fails the check is left alone,
-- and a new one is made.
--
-- The same variable is what the window's title is made of. iTerm's `name` of a window is
-- read-only, but the Beadcause profile turns on a custom window title that reads the
-- variable, so the window is titled with the workspace whichever tab is in front and
-- whatever `claude` renames its own tab to. See `profileDocument` in lib/iterm.js.
--
-- ## Why the command is the tab's command, and never typed (bc-txh7w)
--
-- The tab is created *on* the command (`create tab … command`), so iTerm starts it as
-- the session's process. It used to be typed into a login shell with `write text`, and
-- a typed line is only more input on the tty, the same as anything else there. iTerm
-- takes the keyboard when it opens a window (see the focus notes below), so whatever
-- Adam typed in that moment landed ahead of or inside the launch line and broke it.
-- rc-file readers ate its front (bc-xl7n.113.1), and a tty's 1024-byte `MAX_CANON` cut a
-- long one off (bc-3lkv). As an argv none of those can touch it. Stray keystrokes wait
-- in the input queue until `claude` reads them.
--
-- A tab's command ending closes the tab, so the command keeps a shell behind `claude`
-- itself. `launchArgs` in lib/session.js is the whole argument. Do not reintroduce
-- `write text` here: test/strayinput.mjs checks that it stays out.
--
-- ## No geometry
--
-- There are no bounds to set any more. A new window opens where the Beadcause profile's
-- `Screen` says, at iTerm's own size, and after that it is Adam's to move: a window that
-- holds every session of a workspace is not a card to be dealt, and resizing it on each
-- new tab would undo whatever he did to it.
--
-- ## Why the focus dance
--
-- iTerm brings itself to the front and makes a new window key whether or not anybody
-- said `activate` — that was measured, not assumed: with iTerm not frontmost, `create
-- window` alone leaves it frontmost with the new window taking keystrokes. `create tab`
-- has the same shape one level down: the new tab becomes the current tab of its window.
-- There is no flag anywhere in the AppleScript or Python APIs for creating either in the
-- background. What *does* work is giving the keyboard back: `select` on the tab and the
-- window that had it before, after a beat long enough for iTerm to have finished taking
-- it.
--
-- The tab matters as much as the window. When Adam is typing in this workspace's own
-- window, re-selecting the window is not enough: `create tab` has already switched it to
-- the new tab, and the rest of his sentence would go into a fresh agent's prompt. So the
-- tab he was on is found again by its session id and selected as well.
--
-- So the honest description is that focus is borrowed rather than never taken. A
-- keystroke typed in the half-second while the tab is coming up still lands in it, as
-- input to the session, never as part of what it runs (see above).

on run argv
	set theCommand to item 1 of argv
	set theName to item 2 of argv
	set theProfile to ""
	set theHome to ""
	set returnFocus to false
	set theWorkspace to ""
	if (count of argv) > 2 then set theProfile to item 3 of argv
	if (count of argv) > 3 then set theHome to item 4 of argv
	if (count of argv) > 4 then set returnFocus to (item 5 of argv is "return-focus")
	if (count of argv) > 5 then set theWorkspace to item 6 of argv

	-- Coerced out here, before the tell block, for the reason the old bounds were parsed
	-- out here: inside `tell application` iTerm is the target of every bare statement, and
	-- a coercion error there reads as iTerm refusing something.
	set homeId to missing value
	if theHome is not "" then
		try
			set homeId to theHome as integer
		on error
			set homeId to missing value
		end try
	end if

	tell application id "com.googlecode.iterm2"
		-- Only when the tab is meant to end up in front. `activate` is not what steals
		-- focus — see above — but there is no reason to raise the whole app over whatever
		-- you are doing when the point is to leave you alone.
		if not returnFocus then activate

		-- Whoever had the keyboard, so it can be handed back: the window, and the session
		-- in its current tab. `missing value` when iTerm had no window at all, which is
		-- the ordinary first-session-of-the-day case.
		set priorWindowId to missing value
		set priorSessionId to missing value
		try
			set priorWindowId to id of current window
			set priorSessionId to (id of current session of current window) as text
		end try

		-- The workspace's window, if the recorded one is still there and still ours.
		set home to missing value
		if homeId is not missing value and theWorkspace is not "" then
			try
				if (count of (every window whose id is homeId)) > 0 then
					repeat with t in tabs of window id homeId
						set owner to ""
						try
							tell current session of t to set owner to (variable named "user.beadcauseWorkspace")
						end try
						if owner is theWorkspace then
							set home to window id homeId
							exit repeat
						end if
					end repeat
				end if
			end try
		end if

		set newTab to missing value
		if home is not missing value then
			if theProfile is not "" then
				try
					tell home to set newTab to (create tab with profile theProfile command theCommand)
				on error
					set newTab to missing value
				end try
			end if
			if newTab is missing value then
				try
					tell home to set newTab to (create tab with default profile command theCommand)
				on error
					-- The window went between the check and the tab: make a new one below.
					set home to missing value
				end try
			end if
		end if

		if home is missing value then
			set newWindow to missing value
			if theProfile is not "" then
				try
					set newWindow to (create window with profile theProfile command theCommand)
				on error
					-- The profile is written by the daemon a moment before this runs, and
					-- iTerm loads it from a directory it watches — so the very first session
					-- after an upgrade can arrive before iTerm has noticed the file. That is
					-- a window with the wrong scrollback for one launch, not a failure.
					set newWindow to missing value
				end try
			end if
			if newWindow is missing value then set newWindow to (create window with default profile command theCommand)
			set home to newWindow
			set newTab to current tab of newWindow
		end if

		tell current session of newTab
			-- The tab title. Claude renames its own session on the first turn;
			-- this is what labels the tab until it does.
			set name to theName
			-- What proves this window is the workspace's next time, and what its title
			-- reads. Wrapped: an iTerm too old for session variables still opens the tab,
			-- and costs only the reuse.
			if theWorkspace is not "" then
				try
					set variable named "user.beadcauseWorkspace" to theWorkspace
				end try
			end if
			-- The session's own id, kept for the caller.
			--
			-- It is the only durable handle on this tab: the tab name is gone the moment
			-- Claude renames itself, and the pid belongs to the shell rather than to
			-- iTerm. scripts/message-session.applescript takes this id back, which is what
			-- lets the daemon say something to a session it started — see
			-- `messageSession` in lib/session.js.
			set theId to id
		end tell
		set theHomeId to id of home

		if not returnFocus then
			try
				select home
			end try
		else if priorWindowId is not missing value then
			-- The beat is load-bearing. Without it `select` loses the race against
			-- iTerm's own activation and the new tab simply keeps the keyboard;
			-- measured at 0.4s, which is comfortably clear of it.
			delay 0.4
			try
				repeat with t in tabs of window id priorWindowId
					set hit to false
					repeat with s in sessions of t
						if ((id of s) as text) is priorSessionId then set hit to true
					end repeat
					if hit then
						select t
						exit repeat
					end if
				end repeat
			end try
			try
				select window id priorWindowId
			end try
		end if

		return (theId as text) & " " & (theHomeId as text)
	end tell
end run
