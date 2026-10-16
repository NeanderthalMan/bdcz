/**
 * Where the harness writes a backgrounded task's output file, and how to find it from
 * the caller's task id — factored out of `bin/b7e-await` (bc-dgx7.99) when
 * `bin/b7e-report` (bc-dgx7.148) needed the identical resolution rather than a second
 * copy of it.
 *
 * The file lives at
 *
 *   /private/tmp/claude-<uid>/<cwd, every non-alnum char turned into `-`>/<session id>/tasks/<task-id>.output
 *
 * `<uid>` and `<session id>` are `os.userInfo().uid` and `$CLAUDE_CODE_SESSION_ID`, both
 * already ours. `<cwd>` is trickier: it is the caller's cwd **at the moment the
 * background call was made**, which is not necessarily this process's cwd right now — a
 * session that calls `EnterWorktree` between backgrounding a task and reading it back has
 * a different cwd than when the task started. So `candidateTaskDirs` tries this process's
 * own cwd first and, if that slug has no matching file, falls back across every sibling
 * slug under the same uid that has this exact session id under it — cheap (a few dozen
 * directory entries, stat'd once) and does not need the caller to remember or pass its
 * old cwd.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Every non-alphanumeric character in a cwd turned into `-`, the harness's own scheme. */
export const sanitizeCwd = (p) => String(p).replace(/[^A-Za-z0-9]/g, '-');

/**
 * The directory every session's task dirs live under, for this uid.
 *
 * Overridable via `B7E_TASKS_TEST_BASE` only so a test can drive the real
 * discovery/fallback logic against a throwaway fixture tree instead of writing into the
 * real `/private/tmp/claude-<uid>` — never read anywhere a real caller would see it.
 */
export function tasksBase(env = process.env) {
  return env.B7E_TASKS_TEST_BASE || `/private/tmp/claude-${os.userInfo().uid}`;
}

/**
 * Every directory worth checking for `<taskId>.output`, cheapest (this process's own
 * cwd) first, then every sibling cwd-slug under the same uid that has this exact session
 * id under it. `null` when there is no session id to search with at all.
 */
export function candidateTaskDirs({ cwd = process.cwd(), sessionId = process.env.CLAUDE_CODE_SESSION_ID, base = tasksBase() } = {}) {
  if (!sessionId) return null;
  const dirs = [path.join(base, sanitizeCwd(cwd), sessionId, 'tasks')];
  let entries = [];
  try {
    entries = fs.readdirSync(base);
  } catch {
    // base not there yet (no background task has ever run under this uid) — the
    // primary candidate above is all there is to try.
  }
  for (const entry of entries) {
    const d = path.join(base, entry, sessionId, 'tasks');
    if (!dirs.includes(d)) dirs.push(d);
  }
  return dirs;
}

/**
 * `{ file }` (`file` is `null` if nothing matches yet) or `{ noSession: true }` when
 * there is no session id to search with at all. `opts.dir` skips the whole search and
 * looks for `<taskId>.output` directly under it — the escape hatch for a caller that
 * already has the path, and how tests drive this without a real backgrounded task.
 */
export function resolveTaskFile(taskId, opts = {}) {
  if (opts.dir) {
    const f = path.join(opts.dir, `${taskId}.output`);
    return { file: fs.existsSync(f) ? f : null };
  }
  const dirs = candidateTaskDirs(opts);
  if (dirs === null) return { noSession: true };
  for (const dir of dirs) {
    const f = path.join(dir, `${taskId}.output`);
    if (fs.existsSync(f)) return { file: f };
  }
  return { file: null };
}
