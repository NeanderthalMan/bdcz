/**
 * Which files are the specification — `README.md` plus `docs/*.md`.
 *
 * bc-28jtc: the README was 40,211 lines and 618 headings, and every tool that wanted to
 * read the spec hard-coded `README.md` because there was nothing else to read. Splitting
 * it into a summary plus seventeen documents would have left each of those tools quietly
 * correct about a file that no longer holds the thing they were looking for — `b7e-readme`
 * reporting "no section mentions this" about prose that had simply moved, `test/anchors.mjs`
 * passing because it could no longer see the links it was meant to check. So the set is
 * named once, here, and the tools ask.
 *
 * **Discovered, not listed.** `docs/*.md` is a glob rather than a register because a
 * register is a second place to forget: a document added to `docs/` and left out of a list
 * here would be unchecked in exactly the way this file exists to prevent, and nothing
 * would say so. The cost is that an unrelated `.md` dropped in `docs/` joins the spec by
 * accident, which is the failure that shows up immediately (its anchors get checked) rather
 * than the one that hides.
 *
 * **Top level, plus `docs/b7e/`.** `docs/sw-cache/` is a run of per-version release notes,
 * not spec — eighty-odd files that say what changed in one service-worker bump. They are
 * documents, they are just not this document set, and walking into them would put their
 * headings in the same slug namespace as the specification's. `docs/b7e/` is the opposite
 * case and is named here for it: since bc-fmk4v every `b7e-*` tool's `### ` section is a
 * file of its own in there, because appending them all to one chapter gave every pair of
 * tool branches in flight the same conflict at the same end-of-file anchor (thirteen open
 * pull requests on 2026-09-19). They are the specification — `b7e-readme` has to find
 * them, `b7e-enroll` has to check them and `test/anchors.mjs` has to follow their links —
 * so the set walks that one directory and no other.
 *
 * **Named rather than discovered, and only one level deep.** A second subdirectory would
 * join the specification by being created, which is how `docs/sw-cache/` would have got in.
 * `SUBDIRS` is the list of directories somebody decided are chapters; everything else under
 * `docs/` is a directory of something else.
 *
 * **`README.md` is first and stays first.** It is the summary and the index, so document
 * order across the set starts there, and a tool that reports "the first place this is
 * mentioned" should say the summary before it says the chapter.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.join(HERE, '..');

/** The summary, and the directory the rest of the specification lives in. */
export const SUMMARY = 'README.md';
export const DOCS_DIR = 'docs';

/**
 * Directories under `docs/` that are part of the specification, repo-relative.
 *
 * One entry today: `docs/b7e/`, one file per `b7e-*` tool (bc-fmk4v). A directory here is
 * a decision that everything `.md` inside it is spec and somebody owns it —
 * `lib/documents.js`'s register covers the whole directory for the same reason.
 */
export const SUBDIRS = Object.freeze([`${DOCS_DIR}/b7e`]);

/** The `.md` files directly in one directory, repo-relative and sorted. Missing is empty. */
function markdownIn(root, rel) {
  try {
    return fs
      .readdirSync(path.join(root, rel), { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => `${rel}/${e.name}`)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Every file in the specification, repo-relative, `README.md` first and the rest in
 * filename order. Missing `docs/` is not an error — a checkout mid-rebase can be without
 * it for a moment, and a tool that throws there is worse than one that reports the
 * summary alone. Missing `docs/b7e/` is not an error either, and for a second reason: a
 * fixture repo the suite builds is usually a `README.md` and nothing else.
 *
 * Sorted as one list, so `docs/b7e-tools.md` still comes immediately before the
 * `docs/b7e/` files it used to hold — the order a reader would want them in, and the order
 * `b7e-readme` reports "the first place this is mentioned" by.
 */
export function docFiles(root = REPO_ROOT) {
  const rest = [...markdownIn(root, DOCS_DIR), ...SUBDIRS.flatMap((d) => markdownIn(root, d))].sort();
  return [SUMMARY, ...rest];
}

/**
 * Documents in `docs/` that are not the specification, and so carry no owner and no review
 * date in `lib/documents.js`.
 *
 * None of them says how the system works: one is a review somebody did on a day, the other
 * two are spikes that asked whether an approach would work (the second, bc-x0mhc, whether
 * Temporal would run the merge queue better).
 * A record of a moment cannot go stale the way a specification can — it was true of that
 * moment and still is — so putting a review date on one would be asking somebody to
 * re-approve a diary entry. Their links are still checked, because a broken link is
 * broken whatever the document is for.
 *
 * Named here rather than inferred: a document is out of scope because somebody said so.
 */
export const NOT_SPECIFICATION = Object.freeze([
  'docs/ux-review.md',
  'docs/ide-websocket-spike.md',
  'docs/temporal-merge-queue-spike.md',
]);

/** The controlled specification — `docFiles` less the notes that are not it. */
export function specFiles(root = REPO_ROOT) {
  return docFiles(root).filter((f) => !NOT_SPECIFICATION.includes(f));
}

/** `[{ file, text }]` for the whole set, in `docFiles` order. */
export function readDocs(root = REPO_ROOT) {
  return docFiles(root).map((file) => ({
    file,
    text: fs.readFileSync(path.join(root, file), 'utf8'),
  }));
}

/**
 * The whole specification as one string, for a check that only asks "is this named
 * anywhere in the documentation" and does not care which document said it.
 *
 * Tolerant on purpose: a fixture repo built by the suite is usually a `README.md` and
 * nothing else, and one that has no `docs/` is not broken — it is a small repo. An
 * unreadable file contributes nothing rather than throwing, so a check that was asking a
 * question about prose cannot fail for a reason about the filesystem.
 */
export function specText(root = REPO_ROOT) {
  return specFiles(root)
    .map((file) => {
      try {
        return fs.readFileSync(path.join(root, file), 'utf8');
      } catch {
        return '';
      }
    })
    .join('\n');
}

/**
 * How one document refers to another: a link from `docs/a.md` to `docs/b.md` is `b.md`,
 * and one from `docs/a.md` to the summary is `../README.md`. Plain `path.relative`, named
 * here so the rewriting and the checking cannot disagree about it.
 */
export function linkFrom(fromFile, toFile) {
  return path.relative(path.dirname(fromFile), toFile);
}
