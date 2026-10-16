#!/usr/bin/env node
//
// lib/relayreport.js — reading a relay subagent's transcript back to find its final
// report. Fixtures are hand-built JSONL, in the shapes actually observed in real
// `<task-id>.output` files for a backgrounded Agent call (bc-dgx7.148): no bash-style
// `[exited with code N]` trailer, a `SubagentStop` attachment on a normal finish, and
// `isApiErrorMessage`/`apiErrorStatus`/`error` at the top level (beside `message`, not
// inside it) on a died-mid-run case.
//
//   npm test
//   node test/relayreport.mjs
import assert from 'node:assert/strict';
import { parseEvents, reportIn, roleHeading } from '../lib/relayreport.js';

// The roster a relay would declare. beadcause ships none — the caller (bin/b7e-report)
// reads it off the checkout and the config — so this suite declares its own, invented.
const ROLES = ['editor', 'critic'];

let failures = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${String(err.message).split('\n').slice(0, 8).join('\n       ')}`);
  }
};

console.log('\nrelayreport\n');

const line = (obj) => JSON.stringify(obj);
const assistantText = (text, extra = {}) => line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] }, ...extra });
const subagentStop = () => line({ attachment: { hookName: 'SubagentStop' } });
const apiError = (error, apiErrorStatus) =>
  line({ type: 'assistant', isApiErrorMessage: true, apiErrorStatus, error, message: { role: 'assistant', content: [] } });
const jsonl = (...lines) => lines.join('\n') + '\n';

/* --------------------------------------------------------------------------- parseEvents */

check('parses one JSON object per line', () => {
  const events = parseEvents(jsonl(line({ a: 1 }), line({ a: 2 })));
  assert.deepEqual(events.map((e) => e.a), [1, 2]);
});

check('a half-written last line is dropped, not thrown', () => {
  const events = parseEvents(jsonl(line({ a: 1 })) + '{"a": incompl');
  assert.deepEqual(events.map((e) => e.a), [1]);
});

check('blank lines are skipped', () => {
  const events = parseEvents(`\n${line({ a: 1 })}\n\n`);
  assert.equal(events.length, 1);
});

check('empty text parses to no events', () => {
  assert.deepEqual(parseEvents(''), []);
  assert.deepEqual(parseEvents(undefined), []);
});

/* ------------------------------------------------------------------------------ reportIn */

console.log('\nreportIn — the three-way read\n');

check('an unknown role throws rather than silently matching nothing', () => {
  assert.throws(() => reportIn([], 'nassim', { roles: ROLES }), /unknown role/);
  assert.throws(() => reportIn([], 'nassim', { roles: ROLES }), /editor, critic/);
  // No roster at all is no roles, and says so rather than naming a list that is not there.
  assert.throws(() => reportIn([], 'editor', { roles: [] }), /no relay declares any roles/);
  // And a string that cannot be a role name at all throws with or without one.
  assert.throws(() => reportIn([], '# not a role'), /unknown role/);
});

check('every declared role gets a heading, and no role is built in', () => {
  for (const role of ROLES) assert.ok(roleHeading(role), role);
  assert.equal(roleHeading(''), null);
  assert.equal(reportIn([], 'critic', { roles: ROLES }).status, 'running');
});

check('finds a "# Editor" heading at depth 1', () => {
  const events = parseEvents(jsonl(assistantText("# Editor's Continuity Report — Ch. 22\n\nBody."), subagentStop()));
  const result = reportIn(events, 'editor');
  assert.equal(result.status, 'found');
  assert.match(result.text, /^# Editor/);
});

check('finds a "## Critic" heading at depth 2, same as depth 1', () => {
  const events = parseEvents(jsonl(assistantText("## Critic's Critique: Ch. 5"), subagentStop()));
  assert.equal(reportIn(events, 'critic').status, 'found');
});

check("editor's heading does not match critic's role and vice versa", () => {
  const events = parseEvents(jsonl(assistantText("# Editor's Continuity Report"), subagentStop()));
  assert.equal(reportIn(events, 'critic').status, 'no-answer');
});

check('a tool-call content block is not mistaken for the report', () => {
  const toolCall = line({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Read', input: { file_path: '# Editor pretend' } }] },
  });
  const events = parseEvents(jsonl(toolCall, subagentStop()));
  assert.equal(reportIn(events, 'editor').status, 'no-answer');
});

check('the LAST matching assistant message wins, not the first', () => {
  const events = parseEvents(
    jsonl(assistantText('# Editor draft one — ignore me, superseded'), assistantText('# Editor final answer'), subagentStop())
  );
  const result = reportIn(events, 'editor');
  assert.equal(result.status, 'found');
  assert.match(result.text, /final answer/);
});

check('finished (SubagentStop) with no matching text is "no-answer"', () => {
  const events = parseEvents(jsonl(assistantText('Something that is not a report'), subagentStop()));
  assert.equal(reportIn(events, 'editor').status, 'no-answer');
});

check('an API error before any SubagentStop is "error", naming the reason', () => {
  const events = parseEvents(jsonl(assistantText('working on it...'), apiError('rate_limit', 429)));
  const result = reportIn(events, 'editor');
  assert.equal(result.status, 'error');
  assert.equal(result.reason, 'rate_limit');
  assert.equal(result.apiErrorStatus, 429);
});

check('an API error with no `error` field falls back to the HTTP status', () => {
  const events = parseEvents(jsonl(apiError(undefined, 503)));
  const result = reportIn(events, 'editor');
  assert.equal(result.status, 'error');
  assert.match(result.reason, /503/);
});

check('a transient API error the run recovers from does not shadow the eventual report', () => {
  const events = parseEvents(jsonl(apiError('overloaded', 529), assistantText('# Editor recovered and answered'), subagentStop()));
  assert.equal(reportIn(events, 'editor').status, 'found');
});

check('neither SubagentStop nor an error yet is "running"', () => {
  const events = parseEvents(jsonl(assistantText('still going')));
  assert.equal(reportIn(events, 'editor').status, 'running');
});

check('an empty transcript is "running"', () => {
  assert.equal(reportIn([], 'editor').status, 'running');
});

check('roleHeading matches the role as a whole word, not a prefix of a longer word', () => {
  assert.equal(roleHeading('editor').test('# Editorship is not the role'), false);
  assert.equal(roleHeading('editor').test('# Editor, agent of continuity'), true);
});

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} check(s) FAILED`}\n`);
process.exit(failures ? 1 : 0);
