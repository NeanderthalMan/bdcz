/**
 * The `b7e-*` half of the read-only surface, read from the tools themselves.
 *
 * `lib/toolbelt.js` holds what a person wrote down by hand — the `bd` verbs, the four
 * shapes of looking something up, the one write. This file reads `bin/` and appends the
 * `b7e-*` tools that declare themselves granted, and `DEFAULT_TOOL_LIST` is the two
 * together. It is the one home of that list: `lib/foundation.js` records it as the
 * dispatch agent's baseline and `lib/agents.js` re-exports it, exactly as they did when
 * it was a literal.
 *
 * ## Why it is derived — bc-wbrhi
 *
 * Adding one `b7e-*` tool used to mean a line in `lib/grants.js`, seven in
 * `lib/toolbelt.js`, one in `package.json` and one more in `package-lock.json`, on top of
 * the three files that were actually new. Every one of those lines went in at the same
 * place in its file, so every branch in flight was appending at the same anchor: on
 * 2026-08-26, **ten of the fourteen open pull requests touching `lib/grants.js` were
 * inserting at line 333**, which means one of them landing conflicted the other nine, by
 * construction rather than by luck. bc-8479e made those conflicts merge themselves with
 * `merge=union`; this makes them not happen.
 *
 * A tool now says what it is in its own header, once:
 *
 *     * @grant read                      it is on the list, and lib/grants.js classifies it a read
 *     * @grant write: <why, >=20 chars>  it is on the list, granted to dispatch alone, and
 *                                        lib/grants.js classifies it a write for the reason given
 *     * @grant excluded                  it is deliberately NOT on the list
 *
 * and nothing else has to be edited. The pattern is built from the filename rather than
 * written out, because `Bash(b7e-window:*)` typed by hand is one more thing that can be
 * typed wrong, and a grant that does not match the command it is for is a grant for
 * nothing.
 *
 * ## `excluded` is a decision, not an absence
 *
 * Twenty-nine of these tools are deliberately off the list, each with a paragraph saying
 * what it writes or spawns, and `bin/b7e-enroll` has always treated that decision as
 * exactly as real as being on the list — a tool is unpaid only when **neither** is true.
 * It used to establish that by looking for the tool's name anywhere in the array's
 * comments, which is why naming a tool in passing could read as a decision about it (the
 * `b7e-hunks` paragraph, in bin/b7e-hunks's own header since bc-fmk4v, says so in as many
 * words). `@grant excluded` is that same decision written down where it cannot be made by
 * accident.
 *
 * Two tools have no declaration at all — `b7e-packet` and `b7e-say` — because nobody has
 * decided about them. `b7e-enroll` reported both as unpaid before this change and reports
 * both as unpaid after it. Nothing here decides on their behalf.
 *
 * ## Why this is a module of its own and not part of `lib/toolbelt.js`
 *
 * Because `lib/toolbelt.js` is tagged `@manifest`, and `manifestProblems` in
 * `lib/affected.js` refuses that tag to any file that imports something or declares a
 * function. Reading `bin/` needs both. The tag is not decoration: bc-xlz32.7 measured
 * that adding a b7e tool used to select **205 suites**, 196 of them only because
 * `toolbelt.js` sits underneath nearly everything, and the tag is what took a narrowed
 * gate from a median 30% of the suite to 2%. Doing the scan there would have bought
 * bc-wbrhi by handing back bc-xlz32.7.
 *
 * ## The blind spot this has, said out loud
 *
 * `lib/affected.js` reads imports. This reads the filesystem, and no static analysis can
 * see that edge — so editing a `@grant` line inside an existing `bin/b7e-*` file changes
 * what this module produces and narrows to that tool's own suite rather than to
 * `test/tooldecl.mjs`. Adding or removing a tool is fine, because the file itself is new
 * or gone; it is the *edit in place* that is invisible. The full gate covers it, and
 * `test/tooldecl.mjs` names this file so anything touching **this** file still selects it.
 *
 * ## Failing soft, in the safe direction
 *
 * A `bin/` that cannot be read, or a declaration that makes no sense, produces **fewer**
 * grants rather than more — the list shrinks toward the hand-written base, so an agent
 * loses a capability instead of gaining one. That is the right way round, and it is still
 * not good enough on its own, because a silently shorter allowlist is a mystery at the far
 * end. So every problem is collected in `DECLARATION_PROBLEMS` and `test/tooldecl.mjs`
 * fails the repo when it is not empty.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BASE_TOOL_LIST } from './toolbelt.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The three things a declaration can say. Anything else is a problem, not a default. */
export const KINDS = Object.freeze(['read', 'write', 'excluded']);

/**
 * The declaration line, anywhere in a file: ` * @grant read` or ` * @grant write: <why>`.
 *
 * Anchored to the start of a line and allowed only comment furniture before it, so a
 * `@grant` written mid-sentence in prose is not mistaken for one. Deliberately not
 * restricted to the header docblock — `declarationsIn` counts every match and refuses a
 * file with two, which is the failure that restriction would have been guarding against
 * and it catches the loose one as well.
 *
 * The kind is the first token; a literal `:` immediately after it, with nothing before
 * the `:` but the token itself, opens a reason that runs to the end of the line — the
 * colon is required rather than optional whitespace so an ordinary sentence *about* the
 * mechanism cannot be mistaken for one declaring it. `bin/b7e-register` already has a
 * comment reading `// @grant line just written and would report...`, which a
 * whitespace-only separator would have parsed as a second, bogus declaration in that
 * file; requiring `:` leaves it alone, because plain prose here never happens to put a
 * colon right after the word "line". `read` and `excluded` need no reason and take none.
 */
const GRANT_RE = /^[ \t]*(?:\*|\/\/)?[ \t]*@grant[ \t]+([^\s:]+)(?::[ \t]*(.+?))?[ \t]*$/gm;

/** The command name a file in `bin/` is invoked as — `b7e-owes.js` is run as `b7e-owes`. */
export const commandName = (file) => file.replace(/\.js$/, '');

/** Every `@grant` in one file's text, as `{ kind, why }` — `why` is `''` when nothing follows the kind. */
function matchGrants(text) {
  return [...String(text ?? '').matchAll(GRANT_RE)].map((m) => ({ kind: m[1], why: (m[2] || '').trim() }));
}

/**
 * Every `@grant` in one file's text, as written — the kind alone, discarding any reason.
 *
 * Returns the raw strings rather than validating, so the caller can say *which* file
 * carries a declaration it does not understand instead of quietly dropping it.
 */
export function declarationsIn(text) {
  return matchGrants(text).map((g) => g.kind);
}

/**
 * Read `bin/`, and answer with both halves: what was declared, and what could not be read.
 *
 * `dir` is a parameter so the suite can drive it over a made-up directory — the same
 * arrangement `grantProblems` has in lib/grants.js, and for the same reason: a check that
 * can only be run against the real repo can only ever be shown passing.
 */
export function readDeclarations(dir) {
  const declared = [];
  const problems = [];
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => /^b7e-/.test(f)).sort();
  } catch (err) {
    return { declared, problems: [`bin/ could not be read (${err.code || err.message}), so no tool is granted`] };
  }
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(path.join(dir, file), 'utf8');
    } catch (err) {
      problems.push(`bin/${file} could not be read (${err.code || err.message})`);
      continue;
    }
    const found = matchGrants(text);
    if (!found.length) continue; // undeclared is a state b7e-enroll reports, not a problem here
    if (found.length > 1) {
      problems.push(
        `bin/${file} declares @grant ${found.length} times (${found.map((g) => g.kind).join(', ')}) — a tool has one answer`
      );
      continue;
    }
    const [{ kind, why }] = found;
    if (!KINDS.includes(kind)) {
      problems.push(`bin/${file} declares @grant ${kind}, which is not one of ${KINDS.join(', ')}`);
      continue;
    }
    if (kind === 'write' && why.length < 20) {
      problems.push(
        `bin/${file} declares @grant write with no reason worth reading — say what it can change after ` +
          "a colon on the same line (>=20 characters), e.g. `@grant write: it can rewrite the queue file`"
      );
      continue;
    }
    declared.push(kind === 'write' ? { name: commandName(file), file, kind, why } : { name: commandName(file), file, kind });
  }
  const seen = new Set();
  for (const d of declared) {
    if (seen.has(d.name)) problems.push(`${d.name} is declared by more than one file in bin/`);
    seen.add(d.name);
  }
  return { declared, problems };
}

const read = readDeclarations(path.join(HERE, '..', 'bin'));

/** Every `b7e-*` tool that declared itself, whichever way it declared. */
export const DECLARATIONS = Object.freeze(read.declared.map((d) => Object.freeze(d)));

/** Everything wrong with the declarations. `test/tooldecl.mjs` asserts this is empty. */
export const DECLARATION_PROBLEMS = Object.freeze(read.problems);

/**
 * The tools that are on the list, as `lib/grants.js` classifies them.
 *
 * A `write` entry carries the two things `grantProblems` requires of any write grant —
 * `why` (the declaration's own trailing reason) and `granted` — filled in here rather than
 * in the header, because `granted` has exactly one possible value: `B7E_GRANTS` only ever
 * reaches an agent through `DEFAULT_TOOL_LIST`, and `lib/foundation.js` gives that list to
 * `dispatch` alone. Naming a wider `granted` in the header would be a promise this module
 * cannot keep — nothing else ever holds one of these patterns.
 */
export function grantEntryFor(d) {
  return d.kind === 'write' ? { kind: 'write', why: d.why, granted: ['dispatch'] } : { kind: d.kind };
}

export const B7E_GRANTS = Object.freeze(
  Object.fromEntries(
    DECLARATIONS.filter((d) => d.kind !== 'excluded').map((d) => [`Bash(${d.name}:*)`, Object.freeze(grantEntryFor(d))])
  )
);

/** The tools a declaration deliberately keeps off the list, by name. */
export const EXCLUDED = Object.freeze(DECLARATIONS.filter((d) => d.kind === 'excluded').map((d) => d.name));

/**
 * The read-only surface every reply agent gets: what was written by hand, then what the
 * tools declared.
 *
 * The hand-written half keeps the order its arguments were made in; the derived half is
 * in filename order, because that is the only order `bin/` has and inventing another
 * would be one more thing to keep in step. Nothing depends on either — the list is a set
 * that happens to be written as an array, and `DEFAULT_TOOLS` joins it for a command line.
 */
export const DEFAULT_TOOL_LIST = Object.freeze([...BASE_TOOL_LIST, ...Object.keys(B7E_GRANTS)]);

/**
 * The same list as one space-separated string, which is the shape `--allowedTools`
 * wants. Derived rather than written twice — and the array is the source, because
 * several entries contain a space (`Bash(bd show:*)`), so the string cannot be split
 * back apart on whitespace. lib/foundation.js records this as the dispatch agent's
 * baseline and needs the array form.
 */
export const DEFAULT_TOOLS = DEFAULT_TOOL_LIST.join(' ');

/* ===================================================================================
   Where the argument went — bc-fmk4v.

   Until bc-fmk4v this file ended in the argument itself: a paragraph per tool saying why
   it is on the list or why it is deliberately not, moved here whole from
   lib/toolbelt.js by bc-wbrhi, and grown at the bottom by `bin/b7e-register` every time a
   tool was added. That last part is why it had to go. Appending at end-of-file is one
   shared anchor, so every pair of tool branches in flight collided there — on 2026-09-19
   seven open pull requests conflicted in this file and in nothing else they touched,
   each over a paragraph nobody else had an opinion about. bc-wbrhi had already taken the
   *declaration* out of the shared registries; this takes the *reason* out of the shared
   file too, which is the half it left behind.

   Each paragraph now sits in its own tool's header, verbatim, directly above the
   `@grant` line it argues for — seventy tools, sixty-nine paragraphs (b7e-sandbox and
   b7e-fixture were argued together and both carry it). bc-wbrhi's objection to exactly
   this was real: the run argues by cross-reference, "just above" and "the four above",
   and cutting it up loses the order those words point at. So nothing was rewritten to
   paper over it. Every moved paragraph opens with a sentence saying its positional
   words name *this file's* old order, and `git show 7c47d7d77:lib/tooldecl.js` reads the
   whole run as it stood, in that order, for anyone following an "above" back to its
   referent. The reasoning is still one command away; it just no longer costs every tool
   branch a conflict to add to it.

   **Nothing per-tool goes below this comment.** `bin/b7e-register` writes a new tool's
   reason into that tool's own header and nowhere else, and `test/pertoolfiles.mjs` fails
   the repo if a paragraph naming a `bin/b7e-*` tool is appended here again — the guard
   that keeps the shared anchor from regrowing one convenient paragraph at a time.
   =================================================================================== */
