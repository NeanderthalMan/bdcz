/**
 * When was this artefact produced, and what that governs it changed afterwards.
 *
 * `bc-xl7n.153`, filed from loremia's `lm-2uu.23`: a session audit found three loremia
 * sessions asking one question — is this generated file older than the document that
 * governs it — and each dating the file off a different source. `lm-2uu.15` ran an
 * mtime histogram over 87 character PNGs and a `git log` over their directory, then
 * failed all 87 because every one predated the first `identity.txt` (2026-08-10) and
 * Entry 086's style relock (2026-07-22). `lm-5eu.10` took two `sed -n` range reads of
 * `CHANGE_LOG.md` to learn Entry 107 landed after `artist-vision.json` last changed.
 * `lm-2uu.12` dated a plate off an `rclone lsf` line from the vault instead. Three
 * sources of truth for one date, three hand derivations.
 *
 * ## Which date is "produced-at"
 *
 * Every source here is an **observation** that the file existed by some moment: a
 * commit records it at commit time, an mtime at the last write to this copy (a fresh
 * checkout stamps checkout time), a vault listing at upload time. None of them can be
 * earlier than the moment the file was made — so production is at or before the
 * **earliest** of them, and that is the date this reports. A sidecar's own
 * `generated_at`-style field is the one source that claims the moment directly, so it
 * wins when present. When the sources disagree by a day or more the report prints all
 * of them, because in `lm-2uu.15` they did, and a verdict built on one silently is
 * how a checkout's mtime passes for a generation date.
 *
 * ## What "changed afterwards" means
 *
 * An `--against` path counts by its **last commit** — the governing text as it stands
 * is the version the artefact would have to satisfy, so a document written or revised
 * after production is a document the artefact was never aimed at. An untracked
 * governing file falls back to its mtime and says so.
 *
 * `CHANGE_LOG.md` entries (`## Entry NNN — YYYY-MM-DD`, parsed by `lib/changelog.js`'s
 * `entryHeadings` — the same read delmar's `d5a-changelog` and `d5a-entry` use, so the
 * template headings and suffixed renumbers like `078b` behave identically) carry a day
 * and no time. An entry dated **after** the artefact's production day is reported as
 * later; one dated the **same** day cannot be ordered either way and is reported as such
 * rather than dropped — loremia's pose plates and Entry 086 share 2026-07-22, and a
 * day comparison that quietly called that "current" would pass files the relock was
 * written to fail.
 *
 * ## The vault
 *
 * This never lists a remote itself: the vault is a network call, credentials and a
 * remote name this module has no business owning. `--vault <file>` takes a listing
 * someone already saved (`rclone lsl remote:path > listing.txt`, or the `size date time
 * name` shape `lm-2uu.12` pasted), matched to artefacts by path suffix then basename.
 * rclone prints local time, so the listing is read as local time.
 *
 * Reads only. Never writes to the tree, the index or any ref.
 */
import fs from 'node:fs';
import path from 'node:path';
import { git } from './gitref.js';
import { entryHeadings, fieldOf } from './changelog.js';

const GLOB_CHARS = /[*?[\]{}]/;

/**
 * Every file a list of paths and globs names, relative to `root`, sorted and
 * de-duplicated — plus the patterns that matched nothing, so a typo is reported rather
 * than read as "no artefacts, nothing stale". A plain directory stands for every file
 * under it. Globs are the filesystem's (`fs.globSync`), not `git ls-files`: a generated
 * PNG is as likely to be ignored as tracked, and it is still an artefact.
 */
export function expandPaths(root, patterns) {
  const files = new Set();
  const unmatched = [];
  for (const raw of patterns) {
    const pattern = raw.replace(/\\/g, '/');
    const before = files.size;
    const add = (rel) => {
      const abs = path.join(root, rel);
      let st;
      try {
        st = fs.statSync(abs);
      } catch {
        return;
      }
      if (st.isFile()) files.add(rel.split(path.sep).join('/'));
      else if (st.isDirectory()) {
        for (const f of fs.readdirSync(abs, { recursive: true })) {
          const sub = path.join(rel, String(f));
          if (fs.statSync(path.join(root, sub)).isFile()) files.add(sub.split(path.sep).join('/'));
        }
      }
    };
    if (GLOB_CHARS.test(pattern)) {
      for (const hit of fs.globSync(pattern, { cwd: root })) add(hit);
    } else {
      add(pattern);
    }
    // A pattern that only re-found files an earlier one already had still matched.
    if (files.size === before && !matchedAny(root, pattern)) unmatched.push(raw);
  }
  return { files: [...files].sort(), unmatched };
}

function matchedAny(root, pattern) {
  if (GLOB_CHARS.test(pattern)) return fs.globSync(pattern, { cwd: root }).length > 0;
  return fs.existsSync(path.join(root, pattern));
}

/** The last commit that touched `rel`, or null when git has never seen it. */
export async function lastCommit(root, rel) {
  let out;
  try {
    out = await git(root, ['log', '-1', '--format=%H%x1f%cI%x1f%s', '--', rel]);
  } catch {
    return null;
  }
  const line = out.trim();
  if (!line) return null;
  const [sha, date, subject] = line.split('\x1f');
  return { sha, date: new Date(date).toISOString(), subject };
}

/** Keys a sidecar may carry its production moment under, in the order they are tried. */
export const SIDECAR_KEYS = ['produced_at', 'producedAt', 'generated_at', 'generatedAt', 'created_at', 'createdAt', 'timestamp', 'date'];

/**
 * The production moment a JSON sidecar beside the artefact claims — `<file>.json`,
 * `<file>.meta.json`, `<stem>.json` or `<stem>.meta.json` — or null. A sidecar is only
 * a sidecar if it is a different file from the artefact and one of `SIDECAR_KEYS`
 * parses as a date; anything else beside it is just a neighbour.
 */
export function sidecarDate(root, rel) {
  const ext = path.posix.extname(rel);
  const stem = ext ? rel.slice(0, -ext.length) : rel;
  const candidates = [...new Set([`${rel}.json`, `${rel}.meta.json`, `${stem}.json`, `${stem}.meta.json`])];
  for (const cand of candidates) {
    if (cand === rel) continue;
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(path.join(root, cand), 'utf8'));
    } catch {
      continue;
    }
    if (!doc || typeof doc !== 'object') continue;
    for (const key of SIDECAR_KEYS) {
      const v = doc[key];
      if (v === undefined || v === null || v === '') continue;
      const d = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(String(v));
      if (!Number.isNaN(d.getTime())) return { date: d.toISOString(), file: cand, key };
    }
  }
  return null;
}

const VAULT_LINE = /^\s*(\d+)\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})(?:\.\d+)?\s+(.+?)\s*$/;

/** A saved vault listing (`rclone lsl`'s `size date time name`), as `[{ name, date }]`. */
export function parseVaultListing(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const m = VAULT_LINE.exec(line);
    if (!m) continue;
    const d = new Date(`${m[2]}T${m[3]}`);
    if (!Number.isNaN(d.getTime())) out.push({ name: m[4], date: d.toISOString() });
  }
  return out;
}

/**
 * The listing row that is this artefact: the row whose name is a path suffix of `rel`
 * (the longest such), else the one row sharing its basename — and none when two rows
 * share a basename and neither is a suffix, because picking one would be a guess.
 */
export function vaultDate(listing, rel) {
  const suffix = listing.filter((r) => rel === r.name || rel.endsWith(`/${r.name}`));
  if (suffix.length) return suffix.sort((a, b) => b.name.length - a.name.length)[0];
  const base = path.posix.basename(rel);
  const same = listing.filter((r) => path.posix.basename(r.name) === base);
  return same.length === 1 ? same[0] : null;
}

/** `YYYY-MM-DD` in local time — the only calendar a CHANGE_LOG heading can mean. */
export function localDay(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Every source's reading for one artefact, and the produced-at they add up to — see
 * the module doc's "Which date is produced-at". `disagree` is true when the readings
 * span more than one calendar day.
 */
export async function observe(root, rel, { vault = null } = {}) {
  const readings = [];
  const commit = await lastCommit(root, rel);
  if (commit) readings.push({ source: 'git', date: commit.date, detail: `${commit.sha.slice(0, 8)} ${commit.subject}` });
  try {
    readings.push({ source: 'mtime', date: fs.statSync(path.join(root, rel)).mtime.toISOString(), detail: 'this copy on disk' });
  } catch {
    /* expandPaths only hands us files that existed a moment ago; a race is not a reading */
  }
  const side = sidecarDate(root, rel);
  if (side) readings.push({ source: 'sidecar', date: side.date, detail: `${side.file} ${side.key}` });
  const row = vault ? vaultDate(vault, rel) : null;
  if (row) readings.push({ source: 'vault', date: row.date, detail: row.name });

  const chosen = side ? readings.find((r) => r.source === 'sidecar') : readings.reduce((a, b) => (b.date < a.date ? b : a), readings[0]);
  const days = new Set(readings.map((r) => localDay(r.date)));
  return { producedAt: chosen?.date ?? null, source: chosen?.source ?? null, readings, disagree: days.size > 1 };
}

/**
 * Every `## Entry NNN — YYYY-MM-DD` in a CHANGE_LOG body that carries a parseable day,
 * with its `Type:` line as the one-line summary a report can print (the heading itself
 * is only a number and a date).
 */
export function ledgerEntries(text) {
  const out = [];
  for (const h of entryHeadings(text)) {
    const m = /—\s*(\d{4}-\d{2}-\d{2})/.exec(h.heading);
    if (!m) continue;
    out.push({ entry: `${h.digits}${h.suffix}`, day: m[1], summary: fieldOf(h.body, 'Type') || null });
  }
  return out;
}

/**
 * The whole answer for one `bin/b7e-asof` run. `artefacts` and `against` are paths or
 * globs relative to `root`; `changelog` is a path relative to `root` (default
 * `CHANGE_LOG.md` when it exists there), or `false` to skip the ledger; `vault` is a
 * saved listing's text. Per artefact, `verdict` is `predates` when anything governing
 * is later, `same-day` when the only candidates share its production day, else
 * `current`.
 */
export async function asofReport(root, { artefacts = [], against = [], changelog, vault = null } = {}) {
  const art = expandPaths(root, artefacts);
  const gov = against.length ? expandPaths(root, against) : { files: [], unmatched: [] };

  let ledger = null;
  const ledgerFile = changelog === false ? null : changelog || 'CHANGE_LOG.md';
  if (ledgerFile) {
    const abs = path.join(root, ledgerFile);
    if (fs.existsSync(abs)) ledger = { file: ledgerFile, entries: ledgerEntries(fs.readFileSync(abs, 'utf8')) };
    else if (changelog) throw new Error(`no ${ledgerFile} under ${root}`);
  }

  const listing = vault ? parseVaultListing(vault) : null;

  const governing = [];
  for (const rel of gov.files) {
    const c = await lastCommit(root, rel);
    if (c) governing.push({ path: rel, source: 'git', ...c });
    else governing.push({ path: rel, source: 'mtime', sha: null, subject: null, date: fs.statSync(path.join(root, rel)).mtime.toISOString() });
  }

  const rows = [];
  for (const rel of art.files) {
    const obs = await observe(root, rel, { vault: listing });
    const produced = obs.producedAt;
    const day = produced ? localDay(produced) : null;
    const newer = produced ? governing.filter((g) => g.path !== rel && g.date > produced) : [];
    const laterEntries = ledger && day ? ledger.entries.filter((e) => e.day > day) : [];
    const sameDayEntries = ledger && day ? ledger.entries.filter((e) => e.day === day) : [];
    const verdict = newer.length || laterEntries.length ? 'predates' : sameDayEntries.length ? 'same-day' : 'current';
    rows.push({ path: rel, ...obs, newer, laterEntries, sameDayEntries, verdict });
  }

  return {
    root,
    changelog: ledger ? { file: ledger.file, entries: ledger.entries.length } : null,
    against: governing,
    artefacts: rows,
    unmatched: [...art.unmatched, ...gov.unmatched],
  };
}
