/**
 * Scrubbing a tree for publication — the engine behind `npm run scrub`.
 *
 * A public copy of this repo is a snapshot of a private one, and the private one names
 * things that are nobody else's business: an owner's address, their home directory, the
 * other projects on their machine, their employer's services. A snapshot sanitized by hand
 * is right on the day it is made and wrong eleven days later, so the scrub is rules, not
 * edits, and it ends in a gate: every name a rule was written to remove is searched for
 * again afterwards, and anything left over is a failure with a file and a line on it.
 *
 * **The rules are not in this repo.** They live in `scrub.json` beside the rest of the
 * config (`~/.config/beadcause/scrub.json`), because a deny-list of private names is itself
 * a list of private names. That is also what lets this file, its script and its suite ship
 * in the snapshot they produce. The rule file's shape:
 *
 *   {
 *     "replace": [
 *       { "from": "acme", "to": "northwind" },              // literal, case-preserving
 *       { "from": "ACME-(\\d+)", "to": "JIRA-$1", "regex": true }
 *     ],
 *     "keep":    ["America/Halifax"],   // protected from every rule and from the gate
 *     "deny":    ["/Users/[a-z]+",      // regexes the gate also fails on (case-insensitive)
 *                 { "from": "ACME\\.[A-Z]", "flags": "" }],  // ...or with flags as given
 *     "denyNamesFrom": [{ "dir": "~/work", "match": "-", "except": ["tools"] }],
 *     "exclude": ["CLAUDE.md", ".beads/**"],
 *     "add":     { "LICENSE": "~/licenses/MIT.txt" },
 *     "author":  "Beadcause <beadcause@example.com>"
 *   }
 *
 * A literal rule replaces `acme`, `Acme` and `ACME` with `northwind`, `Northwind` and
 * `NORTHWIND`, so an identifier and the prose around it stay in step and a suite asserting
 * one against the other still passes. Literals run longest first, in one pass, so a rule
 * for `jo@acme.com` is not pre-empted by the rule for `acme`. Regex rules run before the
 * literals, in the order written. Paths are scrubbed with the same rules as contents.
 *
 * `denyNamesFrom` is what keeps the gate honest over time: the entries of a directory
 * (the checkouts of an employer's services, say) are denied by name, so a service that did
 * not exist when the rules were written still fails the gate the day it is first mentioned,
 * instead of shipping because nobody thought to add a rule for it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const home = (p) => (p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p);

/** `acme` -> `ACME` / `Acme` / as written, following the case of what was matched. */
function caseLike(matched, to) {
  if (/[a-z]/i.test(matched) && matched === matched.toUpperCase() && matched !== matched.toLowerCase()) {
    return to.toUpperCase();
  }
  if (/^[A-Z]/.test(matched) && matched.slice(1) === matched.slice(1).toLowerCase()) {
    return to.charAt(0).toUpperCase() + to.slice(1);
  }
  return to;
}

/** Glob with `**` (any depth) and `*` (one segment), matched against a posix relative path. */
function globRe(glob) {
  const re = glob
    .split('**')
    .map((part) => part.split('*').map(escape).join('[^/]*'))
    .join('.*');
  return new RegExp(`^${re}$`);
}

/** Subdirectory names the gate should refuse, e.g. every `*-service` checkout. Files are not names. */
function namesFrom({ dir, match = '', except = [] }) {
  let entries;
  try {
    entries = fs.readdirSync(home(dir), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
  return entries.filter(
    (n) => !n.startsWith('.') && n.length >= 4 && n.includes(match) && /^[\w.-]+$/.test(n) && !except.includes(n)
  );
}

/**
 * One `deny` entry. A string is a case-insensitive regex; an object `{ from, flags }` uses
 * its flags as written (any `g` dropped — a gate test must not carry `lastIndex` between
 * lines), so a pattern whose capitals are the point can say so with `"flags": ""`.
 */
function denyEntry(d) {
  if (typeof d === 'string') return { why: `deny /${d}/`, re: new RegExp(d, 'i') };
  const flags = (d.flags ?? 'i').replaceAll('g', '');
  return { why: `deny /${d.from}/${flags}`, re: new RegExp(d.from, flags) };
}

export function loadRules(file) {
  const raw = JSON.parse(fs.readFileSync(home(file), 'utf8'));
  return compile(raw);
}

export function compile(raw) {
  // A literal with a dot in it also appears regex-escaped — `/jo@acme\.com/` in a test —
  // and has to be rewritten the same way, or the assertion and its subject part company.
  const plain = (raw.replace || []).filter((r) => !r.regex);
  const literals = [
    ...plain,
    ...plain
      .filter((r) => r.from.includes('.'))
      .map((r) => ({ from: r.from.replaceAll('.', '\\.'), to: r.to.replaceAll('.', '\\.') })),
  ];
  const regexes = (raw.replace || []).filter((r) => r.regex).map((r) => ({ ...r, re: new RegExp(r.from, r.flags || 'g') }));
  literals.sort((a, b) => b.from.length - a.from.length);
  const byLower = new Map(literals.map((r) => [r.from.toLowerCase(), r]));
  const literalRe = literals.length ? new RegExp(literals.map((r) => escape(r.from)).join('|'), 'gi') : null;

  const keep = [...(raw.keep || [])].sort((a, b) => b.length - a.length);
  const keepRe = keep.length ? new RegExp(keep.map(escape).join('|'), 'g') : null;

  // Word-ish boundaries for names: `acme` is denied in `acme-api` but not in `macmeal`.
  const nameRe = (n) => `(?<![A-Za-z0-9])${escape(n)}(?![A-Za-z0-9])`;
  const denied = [
    ...literals.map((r) => ({ why: `rule "${r.from}"`, re: new RegExp(nameRe(r.from), 'i') })),
    ...regexes.map((r) => ({ why: `rule /${r.from}/`, re: new RegExp(r.from, (r.flags || '').replace('g', '')) })),
    ...(raw.deny || []).map(denyEntry),
    ...(raw.denyNamesFrom || []).flatMap((src) =>
      namesFrom(src).map((n) => ({ why: `name from ${src.dir}`, re: new RegExp(nameRe(n), 'i') }))
    ),
  ];

  return {
    literals,
    regexes,
    byLower,
    literalRe,
    keepRe,
    denied,
    exclude: (raw.exclude || []).map(globRe),
    add: raw.add || {},
    author: raw.author || null,
  };
}

/** Swap `keep` strings out for placeholders that no rule can match, run `fn`, swap back. */
function withKept(text, rules, fn) {
  if (!rules.keepRe) return fn(text);
  const kept = [];
  const masked = text.replace(rules.keepRe, (m) => {
    kept.push(m);
    return `\u0000${kept.length - 1}\u0000`;
  });
  return fn(masked).replace(/\u0000(\d+)\u0000/g, (_, i) => kept[Number(i)]);
}

/** Scrub one string. `counts`, if given, is tallied per rule. */
export function scrubText(text, rules, counts) {
  const tally = (key) => counts && counts.set(key, (counts.get(key) || 0) + 1);
  return withKept(text, rules, (t) => {
    for (const r of rules.regexes) {
      t = t.replace(r.re, (...m) => {
        tally(r.from);
        return m[0].replace(new RegExp(r.re.source, r.re.flags.replace('g', '')), r.to);
      });
    }
    if (rules.literalRe) {
      t = t.replace(rules.literalRe, (m) => {
        const r = rules.byLower.get(m.toLowerCase());
        tally(r.from);
        return caseLike(m, r.to);
      });
    }
    return t;
  });
}

/** Every line of `text` a deny pattern still matches, after `keep` strings are set aside. */
export function residue(text, rules) {
  const hits = [];
  const lines = withKept(text, rules, (t) => t.replace(/\u0000\d+\u0000/g, ' ')).split('\n');
  lines.forEach((line, i) => {
    for (const d of rules.denied) {
      const m = line.match(d.re);
      if (m) hits.push({ line: i + 1, match: m[0], why: d.why });
    }
  });
  return hits;
}

/** Binary if a NUL appears in the first 8 KB — the same test git uses. */
export const isBinary = (buf) => buf.subarray(0, 8000).includes(0);

export const excluded = (rel, rules) => rules.exclude.some((re) => re.test(rel));

function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else if (e.isFile()) out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

/**
 * Scrub a tree in place: drop excluded paths, rename paths, rewrite text files, copy in
 * `add` files. Returns what was done, per file and per rule.
 */
export function scrubTree(root, rules) {
  const counts = new Map();
  const report = { dropped: [], renamed: [], rewritten: [], binary: [], added: [], counts };
  for (const rel of walk(root)) {
    const abs = path.join(root, rel);
    if (excluded(rel, rules)) {
      fs.rmSync(abs);
      report.dropped.push(rel);
      continue;
    }
    const buf = fs.readFileSync(abs);
    let target = abs;
    const renamed = scrubText(rel, rules, counts);
    if (renamed !== rel) {
      target = path.join(root, renamed);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(abs, target);
      report.renamed.push([rel, renamed]);
    }
    if (isBinary(buf)) {
      report.binary.push(renamed);
      continue;
    }
    const text = buf.toString('utf8');
    const out = scrubText(text, rules, counts);
    if (out !== text) {
      fs.writeFileSync(target, out);
      report.rewritten.push(renamed);
    }
  }
  pruneEmptyDirs(root);
  for (const [rel, src] of Object.entries(rules.add)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.copyFileSync(home(src), path.join(root, rel));
    report.added.push(rel);
  }
  return report;
}

function pruneEmptyDirs(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && e.name !== '.git') pruneEmptyDirs(path.join(dir, e.name));
  }
  if (!fs.readdirSync(dir).length) fs.rmdirSync(dir);
}

/**
 * The gate. Every path, every text file's lines, and every binary file's bytes (read as
 * latin1, which is where a PNG's text chunk or an APK's manifest string would show) is
 * searched for every denied pattern. Empty means publishable.
 */
export function gateTree(root, rules) {
  const findings = [];
  for (const rel of walk(root)) {
    for (const h of residue(rel, rules)) findings.push({ file: rel, line: 0, ...h });
    const buf = fs.readFileSync(path.join(root, rel));
    const text = isBinary(buf) ? buf.toString('latin1').replace(/\n/g, ' ') : buf.toString('utf8');
    for (const h of residue(text, rules)) findings.push({ file: rel, ...h });
  }
  return findings;
}

/**
 * A `to` that the source already contains merges two different things into one name —
 * not a leak, but the kind of thing that turns a suite red for no visible reason.
 */
export function collisions(root, rules) {
  const tos = rules.literals.map((r) => ({ to: r.to, re: new RegExp(`(?<![A-Za-z0-9])${escape(r.to)}(?![A-Za-z0-9])`, 'i') }));
  const seen = new Map();
  for (const rel of walk(root)) {
    const buf = fs.readFileSync(path.join(root, rel));
    if (isBinary(buf)) continue;
    const text = buf.toString('utf8');
    for (const t of tos) if (!seen.has(t.to) && t.re.test(text)) seen.set(t.to, rel);
  }
  return [...seen].map(([to, file]) => ({ to, file }));
}
