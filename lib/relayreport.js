/**
 * Reading a relay subagent's task-output transcript back to find its final report — the
 * parsing half of `bin/b7e-report` (bc-dgx7.148). `bin/b7e-report` is the argv, the
 * polling and the write; this is what makes that testable without a real subprocess.
 *
 * ## The shape, found by inspecting real transcripts, not from any doc
 *
 * When the harness backgrounds an `Agent` (subagent) call, `<task-id>.output` fills with
 * the session's own JSONL transcript format — one event per line — rather than the plain
 * combined stdout+stderr a backgrounded `Bash` call gets. There is no bash-style
 * `[exited with code N]` / `[killed]` trailer here; the harness never appends one to a
 * subagent's transcript. Instead:
 *
 * - **Finished normally**: the last useful line is an `attachment` with
 *   `hookName: "SubagentStop"`.
 * - **Died on an API error** (a rate limit, most often): the last `assistant` event
 *   carries `isApiErrorMessage: true`, `apiErrorStatus: <code>` and `error: "<name>"`
 *   (e.g. `"rate_limit"`) at the top level, sitting *beside* `message`, not inside it.
 * - **Still running**: neither of the above has shown up yet, and the file may simply
 *   stop growing mid-poll.
 *
 * A normal assistant turn's `message.content` is an array of blocks; the report itself
 * is the `{ type: "text" }` block whose text starts with a markdown heading naming the
 * role — `# Editor's Continuity Report — ...`, `## Critic's Notes: ...`, `# Critic's
 * Re-check — ...` are the shapes seen in real reports, so the match is "some number of
 * `#`, then the role name, capitalised, as a word", not a fixed heading string or a fixed
 * `#` depth.
 *
 * ## Which roles
 *
 * Whichever the workspace's relays declare (lib/relay.js `rolesOf`) — beadcause ships
 * none, so the caller hands the roster in. `bin/b7e-report` reads it from the checkout's
 * `.beadcause/relays.yaml` and the config's `relays`; a role outside it is refused rather
 * than silently matching nothing, because a typo'd role would otherwise read as a report
 * that never came.
 *
 * ## Priority, and why
 *
 * A transient API hiccup mid-run that the subagent recovers from still leaves an
 * `isApiErrorMessage` line sitting in the transcript, so "found the matching report" is
 * checked *before* "saw an error line" — recovery beats an earlier stumble. Only when
 * nothing ever matched does an error line (or, failing that, a bare `SubagentStop` with
 * no matching text — the subagent finished but answered something else, or nothing) get
 * to explain why.
 */

const clean = (v) => String(v ?? '').trim().toLowerCase();

/**
 * The heading a role's report starts with — some `#`s, then the name, first letter
 * capitalised, as a whole word — or null for a string that is not a role name at all.
 */
export function roleHeading(role) {
  const name = clean(role);
  if (!/^[a-z][a-z0-9_-]*$/.test(name)) return null;
  const title = name[0].toUpperCase() + name.slice(1);
  return new RegExp(`^#{1,6}[ \\t]+${title.replace(/[-]/g, '\\-')}\\b`);
}

/**
 * A transcript's text into its JSONL events, silently dropping a line that does not
 * parse — the same tolerance `lib/ranmodel.js`'s `modelsInTranscript` gives the identical
 * "file still being appended to" shape: a half-written last line is the normal state of
 * a task that has not finished yet, not a corruption to report.
 */
export function parseEvents(text) {
  const out = [];
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      continue;
    }
  }
  return out;
}

/**
 * Reads a transcript's events for one role and answers exactly one of:
 *
 *   { status: 'found', text }                        the last matching report, verbatim
 *   { status: 'error', reason, apiErrorStatus }       ended in an API error before answering
 *   { status: 'no-answer' }                           finished, but nothing matched
 *   { status: 'running' }                             no terminal signal yet
 *
 * `reason` is the transcript's own `error` field (`"rate_limit"` and so on) when there is
 * one, else a fallback built from `apiErrorStatus`.
 */
export function reportIn(events, role, { roles = null } = {}) {
  const known = Array.isArray(roles) ? roles.map(clean).filter(Boolean) : null;
  const heading = known && !known.includes(clean(role)) ? null : roleHeading(role);
  if (!heading) {
    throw new Error(
      `relayreport: unknown role ${JSON.stringify(role)} — expected one of ${known?.length ? known.join(', ') : '(no relay declares any roles)'}`
    );
  }

  let found = null;
  let errorEvent = null;
  let stopped = false;

  for (const event of events) {
    if (event?.attachment?.hookName === 'SubagentStop') stopped = true;
    if (event?.isApiErrorMessage) errorEvent = event;
    if (event?.type !== 'assistant') continue;
    const content = event?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === 'text' && typeof block.text === 'string' && heading.test(block.text)) {
        found = block.text;
      }
    }
  }

  if (found !== null) return { status: 'found', text: found };
  if (errorEvent) {
    const reason = errorEvent.error ? String(errorEvent.error) : `HTTP ${errorEvent.apiErrorStatus ?? 'error'}`;
    return { status: 'error', reason, apiErrorStatus: errorEvent.apiErrorStatus };
  }
  if (stopped) return { status: 'no-answer' };
  return { status: 'running' };
}
