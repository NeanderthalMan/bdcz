#!/usr/bin/env node
//
// Session windows: a profile of their own, dealt onto one screen like cards.
//
//   npm test
//   node test/cards.mjs
//
// None of this can be exercised for real by a test. The layout only means anything on a
// Mac with particular monitors plugged into it, the profile only means anything to a
// running iTerm, and the focus dance can only be observed by a person watching the
// screen. So the arithmetic was pushed into pure functions in lib/iterm.js and this file
// pins the parts a reasonable refactor breaks silently:
//
// 1. **The coordinate flip.** AppKit measures from the bottom left of the primary
//    display with y growing up; iTerm's `bounds` measures from the top left with y
//    growing down. The fixture below is a real reading from a real three-display Mac,
//    paired with real window rectangles from the same moment, so the flip is checked
//    against measurement rather than against my arithmetic. Get this wrong by one screen
//    height and every window is dealt onto a monitor that isn't there.
// 2. **Cards never overlap.** The whole promise of the layout. Twenty windows dealt onto
//    a 4K screen, each one fed back in as an obstacle for the next, and no two of the
//    resulting rectangles may intersect — which holds because a card can only wander
//    inside its own cell, not because the jitter happens to be small.
// 3. **The jitter is a hash, not a die roll.** `Math.random` here would put the same
//    session somewhere new every time it reopened and would make this file impossible to
//    write. Same key, same table, same rectangle.
// 4. **The emptiest cell wins.** A table with room in it never stacks, and the tiebreak
//    between equally empty cells is the key's hash — so two sessions opened a second
//    apart do not both take the top left.
// 5. **The profile is written only when it changed.** iTerm reloads every profile on
//    each write to the directory it watches; a rewrite per session open would reload
//    them a dozen times an hour to no purpose.
// 6. **The AppleScript's contract.** Five arguments, a rectangle set as `bounds` and not
//    as `position`/`size` (those raise -10000 on 3.6.11), a fallback to the default
//    profile, `text item delimiters` set *outside* the tell block, and the delay before
//    the keyboard is handed back. Each of those is a thing that was got wrong once and
//    fails in a way no unit test could see.
//
// Nothing here writes into a real iTerm: `BEADCAUSE_ITERM_PROFILE_DIR` moves the profile
// into a temp directory before lib/iterm.js is imported.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-cards-'));
// Before anything under lib/ is imported: the profile directory is read through an env
// var that a test must own, or this suite edits the profile list of the iTerm you are
// reading its output in.
process.env.BEADCAUSE_ITERM_PROFILE_DIR = path.join(tmp, 'DynamicProfiles');

const iterm = await import(path.join(ROOT, 'lib', 'iterm.js'));
const {
  PROFILE_NAME,
  PROFILE_GUID,
  profileDocument,
  profilePath,
  ensureProfile,
  screenRects,
  pickScreen,
  boundsArg,
  sessionProfile,
  WORKSPACE_VARIABLE,
  NO_WORKSPACE,
  homeKey,
  homeWindowOf,
  recordHome,
  parseOpened,
  inTurn,
  restoreApp,
  ITERM_BUNDLE_ID,
  parseClosedWindows,
  closeEmptyWindows,
  unreportedStuck,
} = iterm;

let failures = 0;
let ran = 0;
const ok = (name) => {
  ran += 1;
  console.log(`  \x1b[32m✓\x1b[0m ${name}`);
};
const bad = (name, detail) => {
  ran += 1;
  failures += 1;
  console.log(`  \x1b[31m✗\x1b[0m ${name}`);
  if (detail) console.log(`      ${detail}`);
};
const check = (fn, name) => {
  try {
    fn();
    ok(name);
  } catch (err) {
    bad(name, err.message);
  }
};
const checkAsync = async (fn, name) => {
  try {
    await fn();
    ok(name);
  } catch (err) {
    bad(name, err.message);
  }
};

console.log('session windows');

/* ------------------------------------------------------------------ the profile */

check(() => {
  const p = profileDocument().Profiles[0];
  assert.equal(p.Name, PROFILE_NAME);
  assert.equal(p.Guid, PROFILE_GUID);
  // The parent is the whole reason this is eight keys and not fifty: session windows
  // must keep looking like the terminal whose font and colours you actually chose.
  assert.equal(p['Dynamic Profile Parent Name'], 'Default');
}, 'the profile inherits from Default and keeps one stable Guid');

check(() => {
  const p = profileDocument().Profiles[0];
  assert.equal(p['Unlimited Scrollback'], true, 'an hour of agent output must survive');
  assert.equal(p['Prompt Before Closing 2'], 0, 'a worker closes its own window with nobody in the room');
  assert.equal(p['Window Type'], 0, 'a full-screen Default profile must not defeat the layout');
}, 'and overrides exactly what a session needs and a shell does not');

check(() => {
  assert.equal(profileDocument().Profiles[0].Screen, -1, 'no display preference by default');
  assert.equal(profileDocument({ screen: 2 }).Profiles[0].Screen, 2);
}, 'the chosen display is named in the profile, so the window is born there rather than jumping');

check(() => {
  const first = ensureProfile({ screen: 2 });
  assert.equal(first.written, true);
  assert.equal(first.name, PROFILE_NAME);
  assert.equal(JSON.parse(fs.readFileSync(first.path, 'utf8')).Profiles[0].Screen, 2);
}, 'writing it creates the directory iTerm watches');

check(() => {
  assert.equal(ensureProfile({ screen: 2 }).written, false);
}, 'writing the same thing again writes nothing — iTerm reloads every profile on each write');

check(() => {
  assert.equal(ensureProfile({ screen: 1 }).written, true);
  assert.equal(JSON.parse(fs.readFileSync(profilePath(), 'utf8')).Profiles[0].Screen, 1);
}, 'a different screen does rewrite it');

check(() => {
  fs.writeFileSync(profilePath(), '{ half a file');
  assert.equal(ensureProfile({ screen: 1 }).written, true);
  assert.equal(JSON.parse(fs.readFileSync(profilePath(), 'utf8')).Profiles[0].Guid, PROFILE_GUID);
}, 'and so does a file somebody broke by hand');

check(() => {
  // A path whose parent is a file: mkdir cannot succeed, and the point is that it comes
  // back as a value. A throw here would cost you the session, and the session is what
  // the profile exists to dress up.
  const wall = path.join(tmp, 'not-a-dir');
  fs.writeFileSync(wall, 'x');
  const res = ensureProfile({}, path.join(wall, 'DynamicProfiles'));
  assert.equal(res.name, null);
  assert.ok(res.error, 'the reason comes back with it');
}, 'a profile that cannot be written is reported, never thrown');

/* ------------------------------------------------------------------ the displays */

// Measured on 2026-08-10 from a MacBook Pro with a portrait monitor and a 4K above it:
// `osascript -l JavaScript scripts/iterm-layout.jxa`. The window rectangles are from the
// same reading, straight out of iTerm's `bounds`, which is what makes this a check on
// the flip rather than a restatement of it.
const MEASURED = {
  primaryHeight: 1169,
  screens: [
    { index: 0, x: 0, y: 0, width: 1800, height: 1125 },
    { index: 1, x: 79, y: 1169, width: 1080, height: 1920 },
    { index: 2, x: 1159, y: 1169, width: 3840, height: 2160 },
  ],
  windows: [
    [3083, -2127, 3668, -1669],
    [301, -1634, 886, -411],
    [0, 44, 585, 502],
  ],
};

const rects = screenRects(MEASURED);

check(() => {
  assert.deepEqual(rects[0], { index: 0, left: 0, top: 44, width: 1800, height: 1125 });
}, 'the primary display starts below the menu bar, at y = 44');

check(() => {
  assert.deepEqual(rects[2], { index: 2, left: 1159, top: -2160, width: 3840, height: 2160 });
}, 'a display stacked above the primary one has a negative top — that is what iTerm means');

check(() => {
  // Each measured window must land inside the screen it was actually on. This is the
  // assertion that fails if the flip is off by a screen height in either direction.
  const inside = (w, s) =>
    w[0] >= s.left && w[2] <= s.left + s.width && w[1] >= s.top && w[3] <= s.top + s.height;
  assert.ok(inside(MEASURED.windows[0], rects[2]), 'the window on the 4K is on the 4K');
  assert.ok(inside(MEASURED.windows[1], rects[1]), 'the window on the portrait monitor is on it');
  assert.ok(inside(MEASURED.windows[2], rects[0]), 'the window on the laptop is on the laptop');
}, 'and real windows land inside the real screens they were read from');

check(() => {
  assert.equal(pickScreen(rects).index, 2, 'largest by area');
  assert.equal(pickScreen(rects, 'main').index, 0);
  assert.equal(pickScreen(rects, 1).index, 1);
  assert.equal(pickScreen(rects, '1').index, 1, 'a number that came through JSON as a string');
}, 'the table is laid on the largest screen unless told otherwise');

check(() => {
  assert.equal(pickScreen(rects, 9).index, 0, 'a monitor that was unplugged falls back');
  assert.equal(pickScreen([], 'largest'), null, 'and no screens at all is a null, not a throw');
}, 'a screen that is not there costs a placement, never a session');

/* --------------------------------------------------- one window per workspace */

check(() => {
  const p = profileDocument().Profiles[0];
  assert.equal(p['Use Custom Window Title'], true);
  // Measured on iTerm 3.7.1: a bare `\(user.beadcauseWorkspace)` renders empty in a
  // window title, because the title is evaluated in the window's scope. Through
  // `currentTab.currentSession` it renders the workspace.
  assert.equal(p['Custom Window Title'], `\\(currentTab.currentSession.${WORKSPACE_VARIABLE})`);
  assert.equal(WORKSPACE_VARIABLE, 'user.beadcauseWorkspace', 'iTerm only lets a script define user.* variables');
}, 'the window is titled with its workspace, read from the variable every tab carries');

await checkAsync(async () => {
  // A configured index needs no probe, so this touches nothing on the Mac running it.
  const got = await sessionProfile({ screen: 1 });
  assert.equal(got.profile, PROFILE_NAME);
  assert.equal(got.screen, 1);
  assert.equal(JSON.parse(fs.readFileSync(profilePath(), 'utf8')).Profiles[0].Screen, 1);
  assert.ok(!('bounds' in got), 'there is no rectangle any more — the window is Adam’s to place');
}, 'a session gets a profile naming the screen a new window is born on, and no bounds');

check(() => {
  assert.equal(homeKey('beadcause'), 'beadcause');
  assert.equal(homeKey('loremia'), 'loremia');
  assert.equal(homeKey(null), NO_WORKSPACE, 'a resumed conversation with no workspace still shares a window');
  assert.equal(homeKey('  '), NO_WORKSPACE);
}, 'a window is keyed by workspace, and a session with none shares one');

check(() => {
  const rec = { beadcause: 10782, loremia: 10797 };
  assert.equal(homeWindowOf(rec, 'beadcause'), '10782');
  assert.equal(homeWindowOf(rec, 'loremia'), '10797');
  assert.equal(homeWindowOf(rec, 'sorrel'), '', 'a workspace with no window yet gets one made');
  assert.equal(homeWindowOf({ beadcause: 'x' }, 'beadcause'), '', 'junk is no window, never a guess');
  assert.equal(homeWindowOf({ beadcause: -3 }, 'beadcause'), '');
  assert.equal(homeWindowOf(null, 'beadcause'), '');
}, 'the recorded window reaches the script as an id or as nothing');

check(() => {
  const rec = { beadcause: 1 };
  const next = recordHome(rec, 'loremia', 22);
  assert.deepEqual(next, { beadcause: 1, loremia: 22 });
  assert.deepEqual(rec, { beadcause: 1 }, 'the record passed in is not mutated');
  assert.deepEqual(recordHome(next, 'loremia', 23), { beadcause: 1, loremia: 23 }, 'a new window replaces a gone one');
  assert.equal(recordHome(rec, 'loremia', null), rec, 'no window id, nothing recorded');
  assert.deepEqual(recordHome('junk', 'beadcause', 5), { beadcause: 5 });
}, 'the window a tab went into is recorded for the next one');

check(() => {
  assert.deepEqual(parseOpened('45D86E37-64CD-4582-B6A0-A992C30009F1 10782\n'), {
    term: '45D86E37-64CD-4582-B6A0-A992C30009F1',
    window: 10782,
  });
  assert.deepEqual(parseOpened('stub-session'), { term: 'stub-session', window: null }, 'an older script printed only the session');
  assert.deepEqual(parseOpened(''), { term: null, window: null });
  assert.deepEqual(parseOpened('abc def'), { term: 'abc', window: null }, 'a window that is not an id is not recorded');
}, 'the script prints the session and the window, and either may be missing');

await checkAsync(async () => {
  const order = [];
  let release;
  const gate = new Promise((r) => (release = r));
  const first = inTurn('beadcause', async () => {
    order.push('first:start');
    await gate;
    order.push('first:end');
    return 1;
  });
  const second = inTurn('beadcause', async () => {
    order.push('second');
    return 2;
  });
  const other = inTurn('loremia', async () => {
    order.push('other');
    return 3;
  });
  assert.equal(await other, 3, 'another workspace does not wait');
  release();
  assert.deepEqual([await first, await second], [1, 2]);
  assert.deepEqual(order, ['first:start', 'other', 'first:end', 'second']);
}, 'two sessions for one workspace open one after the other, so the second finds the first’s window');

await checkAsync(async () => {
  const failed = inTurn('sorrel', async () => {
    throw new Error('iTerm said no');
  });
  const next = inTurn('sorrel', async () => 'opened');
  await assert.rejects(failed, /iTerm said no/, 'the failure goes to its own caller');
  assert.equal(await next, 'opened', 'and does not stop the queue behind it');
}, 'a launch that failed does not wedge its workspace');

check(() => {
  assert.equal(boundsArg({ left: 1, top: -2, right: 3, bottom: 4 }), '1,-2,3,4');
  assert.equal(boundsArg(null), '', 'no rectangle is an empty argument, which the script reads as "cascade"');
}, 'a rectangle reaches AppleScript as four integers it can coerce');

await checkAsync(async () => {
  assert.equal(await restoreApp(null), false);
  assert.equal(await restoreApp(ITERM_BUNDLE_ID), false, 'handing focus back to iTerm is the AppleScript’s job');
}, 'there is nothing to hand the keyboard back to when iTerm already had it');

/* ------------------------------------------------------- what AppleScript is told */

const script = fs.readFileSync(path.join(ROOT, 'scripts', 'open-session.applescript'), 'utf8');

check(() => {
  for (const n of ['item 3 of argv', 'item 4 of argv', 'item 5 of argv', 'item 6 of argv']) {
    assert.ok(script.includes(n), `the script never reads ${n}`);
  }
  assert.ok(/if \(count of argv\) > 2/.test(script), 'and it tolerates a caller that passes only two');
}, 'the profile, the recorded window, the focus choice and the workspace all arrive as argv');

check(() => {
  const code = script.replace(/--.*$/gm, '');
  assert.ok(!/set bounds of/.test(code), 'a tab in a shared window is not placed — the window is Adam’s');
  // position/size/origin/frame are all in iTerm's dictionary and every one of them
  // raises -10000 on 3.6.11. They have no business here either.
  assert.ok(!/set (position|size|origin|frame) of/.test(code));
}, 'no geometry is set on a workspace’s window');

check(() => {
  assert.ok(/create tab with profile theProfile/.test(script), 'a session is a tab in the workspace window');
  assert.ok(/create window with profile theProfile/.test(script), 'and a new window only when there is none');
  assert.ok(/create tab with default profile/.test(script), 'the fallback for an iTerm that has not loaded it yet');
  assert.ok(/create window with default profile/.test(script));
}, 'the profile is asked for, and a missing profile still opens a tab');

check(() => {
  const code = script.replace(/--.*$/gm, '');
  // iTerm reuses window ids, so an id that exists may be somebody else's window.
  assert.ok(/every window whose id is homeId/.test(code), 'the recorded window is re-checked before use');
  assert.ok(/variable named "user\.beadcauseWorkspace"/.test(code), 'and has to still carry this workspace');
  assert.ok(/set variable named "user\.beadcauseWorkspace" to theWorkspace/.test(code), 'every new tab carries it');
  const checkAt = code.indexOf('every window whose id is homeId');
  const tabAt = code.indexOf('create tab with profile');
  assert.ok(checkAt > 0 && checkAt < tabAt, 'checked before a tab is put in it');
}, 'a recorded window is used only while it still exists and is still the workspace’s');

check(() => {
  const tellAt = script.indexOf('tell application id');
  const coerceAt = script.indexOf('theHome as integer');
  assert.ok(coerceAt > 0 && coerceAt < tellAt, 'coerced inside the tell block, a bad id reads as iTerm refusing');
}, 'the recorded id is coerced before the tell block');

check(() => {
  const code = script.replace(/--.*$/gm, '');
  assert.ok(/set priorSessionId to/.test(code), 'the tab that had the keyboard is not remembered');
  assert.ok(/delay 0\.4[\s\S]{0,400}select t[\s\S]{0,200}select window id priorWindowId/.test(code),
    'without the beat, select loses the race; and the tab goes back as well as the window');
}, 'the keyboard goes back to the tab and window that had it, after a beat long enough to win');

check(() => {
  assert.ok(/return \(theId as text\) & " " & \(theHomeId as text\)/.test(script));
}, 'it prints the session and the window it went into');

/* ------------------------------------------------- the windows nothing is left in */

check(() => {
  assert.deepEqual(parseClosedWindows('0'), { closed: 0, ids: [], stuck: [] });
  assert.deepEqual(parseClosedWindows('2 42590 42729'), { closed: 2, ids: ['42590', '42729'], stuck: [] });
  // The real script prints a trailing newline, and osascript is entitled to pad it.
  assert.deepEqual(parseClosedWindows('  1 42590 \n'), { closed: 1, ids: ['42590'], stuck: [] });
}, 'the empty-window sweep reads back a count and the ids it closed');

check(() => {
  // bc-xl7n.110. The script used to count a window as closed the moment `close` did not
  // raise, and on one of these iTerm accepts the close and keeps the window — so the
  // daemon announced 2,330 closures it had never performed. The script verifies by
  // re-querying the id now, and the ones that stayed come back on their own line. This
  // is the shape that has to survive: a refused close is `0`, never `1`.
  assert.deepEqual(parseClosedWindows('0\nstuck 47768 47792'), {
    closed: 0,
    ids: [],
    stuck: ['47768', '47792'],
  });
  // Both halves at once — some went, some did not — which is the ordinary case once a
  // frame that will not close is sitting beside one that will.
  assert.deepEqual(parseClosedWindows('1 42590\nstuck 47768'), {
    closed: 1,
    ids: ['42590'],
    stuck: ['47768'],
  });
  // The line is absent when nothing refused, rather than present and empty.
  assert.deepEqual(parseClosedWindows('1 42590').stuck, []);
}, 'and reports separately the windows that took a close and stayed');

check(() => {
  // A window that will not close is in every sweep from now until it is dismissed by hand,
  // so the whole value of naming it is lost if it is named 2,330 times — which is the shape
  // of the bug this all comes from. Said once, and then not again while it is there.
  const seen = new Set();
  assert.deepEqual(unreportedStuck(seen, ['47768', '47792']), ['47768', '47792']);
  assert.deepEqual(unreportedStuck(seen, ['47768', '47792']), [], 'the same pile says nothing');
  // A newcomer beside them is its own report, and the old ones stay quiet.
  assert.deepEqual(unreportedStuck(seen, ['47768', '47792', '48037']), ['48037']);
  // Forgotten as soon as it stops coming back — and reported again if it returns, because
  // iTerm reuses window ids and a number that went quiet and came back is a fresh frame.
  // Holding ids for the life of the daemon would swallow that one silently.
  assert.deepEqual(unreportedStuck(seen, []), []);
  assert.deepEqual(unreportedStuck(seen, ['47768']), ['47768'], 'a returning id is a new window');
  // The ordinary case, every tick on a tidy Mac: nothing stuck, nothing said, nothing kept.
  assert.deepEqual(unreportedStuck(seen, []), []);
  assert.equal(seen.size, 0, 'and the memory is bounded by the desk, not by uptime');
  assert.deepEqual(unreportedStuck(new Set()), [], 'a sweep with no stuck list at all is quiet');
}, 'and says each stuck window once rather than once a tick');

check(() => {
  // Every one of these is "the script said something this does not understand", and the
  // answer to all of them is the same as finding nothing — never a throw, and never a
  // number invented from half a line.
  for (const bad of ['', null, undefined, 'missing', 'iTerm got an error: -1743', '-3 x']) {
    assert.deepEqual(parseClosedWindows(bad), { closed: 0, ids: [], stuck: [] }, `on ${JSON.stringify(bad)}`);
  }
  // A count that outruns its own list is read as far as the list goes rather than
  // padded with undefined, so the log cannot print a window id that was never there.
  assert.deepEqual(parseClosedWindows('3 42590'), { closed: 3, ids: ['42590'], stuck: [] });
  // A garbled first line voids the stuck list too. One rule rather than two: output this
  // could not read is a sweep whose result is unknown, and half an unknown result
  // reported as a finding is how the version this replaced got believed.
  assert.deepEqual(parseClosedWindows('iTerm got an error: -1743\nstuck 47768'), {
    closed: 0,
    ids: [],
    stuck: [],
  });
}, 'and reads anything it cannot understand as having closed nothing');

await checkAsync(async () => {
  // The belt behind the injection: this suite *is* a suite, so the real function must
  // refuse before it spawns anything. If this ever starts talking to iTerm, it closes
  // windows on the Mac running the tests — which is why the guard is the same one that
  // stops a suite opening them. See `mayLaunch` in lib/launchguard.js.
  const res = await closeEmptyWindows();
  assert.equal(res.refused, true, 'a suite may not close windows on this Mac');
  assert.equal(res.closed, 0);
  assert.equal(res.error, null, 'refusing is not failing');
}, 'and never touches iTerm from inside a test suite');

const emptyScript = fs.readFileSync(path.join(ROOT, 'scripts', 'close-empty-windows.applescript'), 'utf8');

check(() => {
  // The one line that is the whole safety argument. A window with any tab in it holds a
  // session, and a session is an agent with a transcript: if this test is ever failing
  // because the condition was widened, the widening is the bug.
  assert.match(emptyScript, /if \(count of tabs of w\) is 0 then set end of doomed to \(id of w\)/);
  assert.equal(/is 0 then/.test(emptyScript), true);
  assert.equal(/count of tabs/.test(emptyScript.replace(/^--.*$/gm, '')), true, 'and it is code, not a comment');
}, 'the empty-window script closes a window only when it has no tabs at all');

check(() => {
  // Collect, then close by id. Closing inside the enumeration renumbers `windows` under
  // the loop and iTerm answers -1719 partway through — after it has closed some of them.
  const collect = emptyScript.indexOf('repeat with w in windows');
  const close = emptyScript.indexOf('close (first window whose id is (item i of doomed))');
  assert.ok(collect > 0 && close > collect, 'the ids are collected before anything is closed');
  assert.match(emptyScript, /repeat with i from 1 to \(count of doomed\)/, 'and closed by id rather than by index');
}, 'and does it in two passes, because closing renumbers the collection it is walking');

check(() => {
  // bc-xl7n.110, and the reason this file is worth a static check at all: the close is
  // not its own evidence. iTerm accepts `close` on a tabless window without raising and
  // without removing it, so the `try` that used to be the whole test proved only that no
  // error came back. A window reaches `closedIds` after a re-query says it is gone, and
  // nowhere else — if this assertion is failing because the re-query was taken out, the
  // sweep is back to announcing closures it never performed.
  const close = emptyScript.indexOf('close (first window whose id is (item i of doomed))');
  const verify = emptyScript.indexOf('if (count of (every window whose id is wid)) is 0 then set stillThere to false');
  const record = emptyScript.indexOf('set end of closedIds to (wid as text)');
  assert.ok(verify > close, 'the windows are re-queried after the closes, not before');
  assert.ok(record > verify, 'and nothing is recorded as closed until that re-query has answered');
  // The other half: what stayed is named rather than dropped, so the daemon can say so
  // once instead of reporting the same frames as closed on every tick for four days.
  assert.match(emptyScript, /set end of stuckIds to \(\(item i of pending\) as text\)/);
  assert.match(emptyScript, /"stuck " & \(stuckIds as text\)/, 'and printed on a line of its own');
  // `stillThere` starts true, so a re-query that itself fails reports the window as stuck.
  // The conservative direction is the whole point: never claim a departure nothing saw.
  assert.match(emptyScript, /set stillThere to true\n\t+try/);
}, 'and counts a window as closed only after re-querying it, never because close did not raise');

check(() => {
  // The re-query is a poll rather than one settle, and that is load-bearing rather than
  // decorative. Measured on 2026-08-23 against iTerm 3.6.11: a window that really is going
  // still answers `1` when re-queried in the same tell block with no wait, and goes at
  // around 50ms. So a settle that is too short reports every real closure as stuck — this
  // bead's own bug with the sign reversed — and there is no constant that is safe on a Mac
  // running a full suite beside two worker windows. The loop leaves as soon as nothing is
  // pending, so the ordinary sweep pays one step and a slow one gets eight before it calls
  // anything stuck — and a Mac with frames permanently stuck on it pays all eight on every
  // tick, for ever. That steady state is measured in the script's own header; the check
  // below is what keeps it inside the caller's timeout without anybody remembering to look.
  const poll = emptyScript.indexOf('repeat 8 times');
  const settle = emptyScript.indexOf('tell current application to delay 0.15');
  const leave = emptyScript.indexOf('if (count of pending) is 0 then exit repeat');
  assert.ok(poll > 0, 'the re-query is bounded rather than open-ended');
  assert.ok(settle > poll, 'and waits inside the loop rather than once before it');
  assert.ok(leave > poll && leave < settle, 'and drops out before waiting when nothing is pending');
  // `delay` is not iTerm's term, so this has to be addressed to the current application —
  // a bare `delay` inside the tell block is a runtime error, not a compile one.
  assert.doesNotMatch(emptyScript, /^\t+delay /m, 'the settle is not a bare `delay` inside the tell block');
}, 'and polls for the departure rather than guessing a settle that is long enough');

check(() => {
  // bc-xl7n.131.2. Three numbers in two files decide whether the worst case fits: the poll
  // bound and the settle here, and the `timeout` `closeEmptyWindows` passes osascript over
  // in lib/iterm.js. Nothing tied them together — the comment above used to ask a *reader*
  // to check the product by hand, which is the kind of instruction that is followed once.
  //
  // The steady state is not the tidy case. A Mac with N frames permanently stuck pays every
  // one of the eight steps on every tick indefinitely, because `pending` never empties, so
  // `steps × settle` is what the sweep actually costs there rather than a ceiling it rarely
  // reaches. Measured 2026-08-24 against iTerm 3.6.11 with 22 windows on the desk: 1.44s at
  // N=1 and 1.63s at N=10, of which 1.2s is this product — the delay is ~75% of the call and
  // the per-window re-queries are ~15ms each, which is why the bound and the settle are the
  // only two numbers worth guarding.
  //
  // 40% leaves the rest of the call — osascript's own start-up, the collect pass, the close
  // pass and the per-window term — about as much room again as it was measured needing, on a
  // Mac slower than the one that measured it. Raise the bound to 30 steps or the settle to
  // half a second and this fails, which is the point: both are inside a 5s budget on their
  // own and neither is with the other.
  const steps = Number(emptyScript.match(/repeat (\d+) times/)?.[1]);
  const settle = Number(emptyScript.match(/tell current application to delay ([\d.]+)/)?.[1]);
  const itermSrc = fs.readFileSync(path.join(ROOT, 'lib', 'iterm.js'), 'utf8');
  const timeout = Number(itermSrc.match(/export function closeEmptyWindows\(\{ timeout = (\d+) \}/)?.[1]);
  assert.ok(Number.isFinite(steps) && steps > 0, 'the poll bound is readable');
  assert.ok(Number.isFinite(settle) && settle > 0, 'the settle is readable');
  assert.ok(Number.isFinite(timeout) && timeout > 0, 'the caller\'s timeout is readable');
  assert.ok(
    steps * settle * 1000 <= timeout * 0.4,
    `the all-stuck poll waits ${steps} × ${settle}s = ${steps * settle}s, which is not comfortably inside `
      + `the ${timeout / 1000}s osascript timeout in closeEmptyWindows`,
  );
}, 'and its worst case — every window stuck, every tick — stays well inside the caller\'s timeout');

check(() => {
  assert.match(emptyScript, /if not \(application id "com\.googlecode\.iterm2" is running\) then return "0"/);
}, 'and never starts iTerm in order to tidy it');

/* ------------------------------------------ a shared window is never closed whole */

const closeTab = fs.readFileSync(path.join(ROOT, 'scripts', 'close-tab.applescript'), 'utf8');
const focusScript = fs.readFileSync(path.join(ROOT, 'scripts', 'focus-session.applescript'), 'utf8');

check(() => {
  const code = closeTab.replace(/--.*$/gm, '');
  assert.ok(/close \(tab targetTab of window id targetWin\)/.test(code), 'the reap closes the session’s own tab');
  assert.ok(!/close \((first )?window/.test(code), 'closing the window would end every sibling session in it');
  assert.ok(!/terminate/.test(code), 'terminate leaves an empty frame behind (bc-30ve)');
  assert.ok(!fs.existsSync(path.join(ROOT, 'scripts', 'close-window.applescript')), 'the window closer is gone');
  const reap = fs.readFileSync(path.join(ROOT, 'lib', 'reap.js'), 'utf8');
  assert.ok(/'close-tab\.applescript'/.test(reap), 'lib/reap.js still points at a window closer');
}, 'reaping one session closes only its tab, so the rest of its workspace keeps running');

check(() => {
  const code = focusScript.replace(/--.*$/gm, '');
  const tabAt = code.indexOf('select tab targetTab of window id targetId');
  const winAt = code.indexOf('select window id targetId');
  assert.ok(tabAt > 0, 'the focus button raises the window on whichever tab was last in front');
  assert.ok(winAt > tabAt, 'the tab is selected before its window is raised');
}, 'the focus button lands on the session’s tab, not only its window');

/* --------------------------------------------------------- what the caller passes */

const session = fs.readFileSync(path.join(ROOT, 'lib', 'session.js'), 'utf8');

check(() => {
  assert.ok(/\[SCRIPT, command, tabTitle, profile, home, takeFocus \? 'take-focus' : 'return-focus', key\]/.test(session),
    'the script is called with all six');
  assert.ok(/inTurn\(key,/.test(session), 'one open at a time per workspace');
  assert.ok(/homeWindowOf\(loadState\(\)\.itermWindows, key\)/.test(session), 'the recorded window is read');
  assert.ok(/saveState\(\{ itermWindows: recordHome\(/.test(session), 'and the window the tab went into is written back');
}, 'the launcher hands the script the workspace and its recorded window');

check(() => {
  assert.ok(/takeFocus \? 'take-focus' : 'return-focus'/.test(session));
  assert.ok(/if \(prior\) restoreApp\(prior\)/.test(session), 'the cross-app half of handing focus back');
}, 'and says whether the window may keep the keyboard');

const config = fs.readFileSync(path.join(ROOT, 'lib', 'config.js'), 'utf8');

check(() => {
  assert.ok(/cfg\.sessionWindows = \{ \.\.\.defaults\(\)\.sessionWindows/.test(config));
  // The card table is retired, not kept as dead config (bc-2uj4.16.2).
  const block = config.slice(config.indexOf('    sessionWindows: {'), config.indexOf('stealFocus: false,'));
  assert.ok(!/\b(layout|card|jitter):/.test(block), 'the scatter layout left a setting behind');
}, 'a config written before any of this existed still gets every default under sessionWindows');

fs.rmSync(tmp, { recursive: true, force: true });

console.log(failures ? `\n\x1b[31m${failures} of ${ran} failed\x1b[0m\n` : `\n${ran} passed\n`);
process.exit(failures ? 1 : 0);
