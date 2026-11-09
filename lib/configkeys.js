/**
 * Every key of `~/.config/beadcause/config.json`, as the All settings page sees it —
 * bc-qzng7.5.
 *
 * ## The list is the document, read at request time
 *
 * There are about two hundred keys and docs/config.md is where each one is explained. A
 * second list of them here would be a list that drifts: the day somebody documents a new
 * key, the page would not show it, and nothing would say so. So the page's catalogue *is*
 * the documented table — `parseDocKeys` reads the rows of the main table under "Config —
 * `~/.config/beadcause/config.json`", plus the one other table whose header row names a
 * key (`jira.<workspace>.enabled`) — and what this file adds to each row is only what the
 * prose cannot say in a machine-readable way: its type, its clamps, whether it is a
 * secret, whether the browser may write it, and whether the running daemon needs a
 * restart to see it.
 *
 * The type comes from `configDefaults()` in lib/config.js wherever there is a default,
 * because that is the value `loadConfig` would fill in and the type every reader already
 * expects. `SPECS` below is for what a default cannot say — an enum, a clamp, a key with
 * no default at all. A documented key whose type nothing can tell is `unknown`, and
 * `unshowable` names it: test/configkeys.mjs fails on any, which is the acceptance
 * criterion "a test fails when docs/config.md documents a key the page cannot show".
 *
 * ## Secrets never leave this file
 *
 * `token` and `ntfy.topic` are capabilities — whoever holds one can act as you, or read
 * every notification — and the page shows them as set or not set and nothing else. The
 * same goes for any field *inside* an object value whose name says it is a credential
 * (`apiToken`, `clientSecret`, `password` …): it is replaced before the object is sent,
 * and an object that had one redacted is drawn read-only, because a JSON editor holding a
 * placeholder would write the placeholder back. `publicEntry` is the only function whose
 * output reaches a browser, and test/configkeys.mjs plants a value in every secret slot
 * and asserts it is nowhere in the payload.
 *
 * ## What a browser may not write
 *
 * Sign-in (`auth.*`), where credentials are read from (`*TokenFile`, `*SecretFile`), the
 * programs this Mac runs on a merge (`bdBin`, `deploys`, `promoteDrivers`), what an agent
 * may do unattended (the permission modes, `agents`), and the two switches whose whole
 * point is to limit a paired device (`terminal`, `openSessions`) are shown, with their
 * value and why, and are not editable here. Each would let a phone grant itself something
 * the file on the Mac said it could not have. `FILE_ONLY` says which and why.
 *
 * ## A write is the file edit, made surgically
 *
 * `planWrite` changes one path of the *stored* JSON and nothing else — the same thing a
 * person with an editor would do, and the reason the acceptance criterion "changing a key
 * in the UI and in the file give the same result" holds: the bytes are the bytes a hand
 * edit would leave, and `loadConfig` reads them the same way. It never calls
 * `saveConfig(cfg)`, which would dump every merged default into a hand-kept file (see
 * `moveSquashDefault` in lib/config.js for that argument at length).
 *
 * Every write is a line in `config-changes.jsonl` beside the config — who, when, the old
 * and the new — and a line can be reverted from the page, which is one more write.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { writeJsonAtomic } from './atomic.js';
import { PER_WORKSPACE, workspaceAnswer } from './spaces.js';

/* ------------------------------------------------------------------ the document */

/** The heading the main table sits under, matched by its start. */
const MAIN_HEADING = /^## Config — /;

/** `"`port`, `host`"` → `['port', 'host']`. */
const keysIn = (cell) => [...String(cell).matchAll(/`([^`]+)`/g)].map((m) => m[1]);

/** A cell's text without its trailing pipe. */
const trimCell = (s) => String(s).replace(/\s*\|\s*$/, '').trim();

/**
 * Every key docs/config.md documents, in the order it documents them.
 *
 * Returns `[{ key, description, line }]`. One row naming two keys (`port`, `host`) is two
 * entries with one description, which is how the document means it.
 */
export function parseDocKeys(md) {
  const lines = String(md).split('\n');
  const out = [];
  const seen = new Set();
  const add = (key, description, line) => {
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ key, description, line });
  };

  // The main table: from the heading to the first line after it that is not a table row.
  const start = lines.findIndex((l) => MAIN_HEADING.test(l));
  if (start >= 0) {
    let inTable = false;
    for (let i = start + 1; i < lines.length; i += 1) {
      const l = lines[i];
      if (l.startsWith('|')) {
        inTable = true;
        if (!l.startsWith('| `')) continue; // the header and the |---| rule
        const cut = l.indexOf(' | ', 2);
        if (cut < 0) continue;
        const description = trimCell(l.slice(cut + 3));
        for (const key of keysIn(l.slice(1, cut))) add(key, description, i + 1);
      } else if (inTable) break;
    }
  }

  // Elsewhere: a table whose *header* is a dotted key — `| `jira.<workspace>.enabled` | JIRA is |`.
  // Its rows are the values it takes, so they are the description.
  let heading = '';
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i];
    if (l.startsWith('#')) heading = l.replace(/^#+\s*/, '');
    const m = /^\| `([a-zA-Z]+\.[^`]+)` \|[^|]*\|/.exec(l);
    if (!m || !/^\|[-| ]+\|$/.test(lines[i + 1] || '')) continue;
    const rows = [];
    for (let j = i + 2; j < lines.length && lines[j].startsWith('|'); j += 1) {
      const cells = lines[j].split('|').slice(1, -1).map((c) => c.trim());
      rows.push(`${cells[0]}: ${cells[1]}`);
    }
    add(m[1], `${rows.join('; ')}. See “${heading}”`, i + 1);
  }
  return out;
}

/* --------------------------------------------------------------------- the groups */

/**
 * Which group each key is drawn under. The document's table is ordered so that related
 * keys sit together — `advocates.*` in one run, `pr.*` in another, the terminal's five
 * in a row — and these are those runs, named. First match wins; groups appear on the
 * page in the order their first key appears in the document.
 */
const GROUPS = [
  ['This machine', /^(owner|actor|me|port|host|baseUrl|bdBin|healthTimeoutMs|drainMs|token)$/],
  ['Sign-in and HTTPS', /^(tls|auth)\./],
  ['Workspaces and repos', /^(workspaceRoots|workspaces|workspaceDirs|repos|edits\..*|requirements\..*)$/],
  ['Sessions on the Mac', /^(openSessions|sessionDirs|projectRoot|fallbackWorkspace|sessionPermissionMode|sessionWindows\..*|resumeAfterReboot|claudeSessions|claudeSessionsDir|claudeProjectsDir)$/],
  ['Chat session', /^(beadConsole|consoleModel|consoleTimeoutMs)$/],
  ['Terminal', /^terminal/],
  ['Reply agents', /^(autoDispatch|autoDispatchExclude|autoDispatchTimeoutMs|agents|defaultAgent|agents\[\]\..*|agentToolsAcknowledged)$/],
  ['Per-workspace policy', /^(autoEndorse|\w+PerWorkspace)$/],
  ['Pull requests', /^pr\./],
  ['Deploys and release', /^(deploys|promoteDrivers|release\..*)$/],
  ['Incidents', /^incidents\./],
  ['Advocates', /^advocates\./],
  ['Spaces and accounts', /^(spaces|accounts)$/],
  ['Relays and approval', /^(relays|approval)$/],
  ['JIRA and Confluence', /^(jira|jira\..*|jiraSeconds|confluence\..*)$/],
  ['Clocks and sweeps', /^(checkoutRefreshMinutes|pollSeconds|mergeQueue\..*|staleClaimHours|detectSeconds|agentLogRetentionMonths|strayHours|slowRequestMs|assetRoots)$/],
  ['Sync and Dolt', /^(sync\..*|sharedServer|doltServer|mirrorStateToBeads)$/],
  ['Compliance and monitor', /^(compliance\..*|publication\..*|monitor\..*)$/],
  ['ntfy', /^(ntfy|questions)\./],
  ['Slack', /^slack\./],
];

export const OTHER_GROUP = 'Other';

export function groupOf(key) {
  for (const [name, re] of GROUPS) if (re.test(key)) return name;
  return OTHER_GROUP;
}

/* ---------------------------------------------------------------------- the specs */

/** Top-level keys that are capabilities. Shown as set or not set, never as a value. */
const SECRET_KEYS = new Set(['token', 'ntfy.topic']);

/**
 * A field name that holds a credential, wherever it sits in an object. Anchored at the
 * end, so `tokenFile`, `tokenKey` and `tokenPath` — a path and the name of a YAML key —
 * are not caught, and `apiToken`, `clientSecret` and `password` are.
 */
const SECRET_FIELD = /(token|secret|password|passwd|apikey|credential|credentials|privatekey)$/i;

/** Why a key is not writable from a browser, by rule. First match wins. */
const FILE_ONLY = [
  [/^token$/, 'The pairing token is a secret; regenerate it by deleting it from the file.'],
  [/^ntfy\.topic$/, 'The topic is a secret — anyone who has it reads your notifications. Change it in the file.'],
  [/^auth\./, 'Sign-in decides who reaches this page at all, so it is changed in the file on the Mac.'],
  [/(Secret|Token)File$/, 'Where a credential is read from. Changed on the Mac, never from a browser.'],
  [/^(bdBin|deploys|promoteDrivers)$/, 'Names a program this Mac runs. Changed in the file on the Mac.'],
  [/^(sessionPermissionMode|terminalPermissionMode|agents|agents\[\]\..*|agentToolsAcknowledged)$/, 'Widens what an agent may do unattended. Changed in the file on the Mac.'],
  [/^(terminal|openSessions)$/, 'An off switch for what a paired device may do — a paired device must not be able to switch it back on.'],
  [/^workspaces$/, 'Rediscovered on every start. Add a root to workspaceRoots, or name one in workspaceDirs.'],
  [/[<[]/, null], // a per-workspace or per-item field: edited inside its parent — see `placeholderParent`
];

/**
 * Keys the running daemon reads once, at startup or when a timer is armed. A write to one
 * is in the file and in the daemon's config object at once, but the part of the daemon
 * that acts on it will not see it until a restart — so the page says so and offers one.
 * A prefix ending in `.` covers the block.
 */
const RESTART = [
  'port', 'host', 'baseUrl', 'tls.', 'bdBin', 'healthTimeoutMs', 'drainMs',
  'workspaceRoots', 'workspaceDirs', 'repos', 'spaces', 'accounts',
  'pollSeconds', 'detectSeconds', 'jiraSeconds', 'checkoutRefreshMinutes',
  'sync.', 'publication.', 'monitor.', 'sharedServer', 'doltServer',
  'release.seconds', 'release.armedSeconds',
  'slack.enabled', 'slack.apiBase', 'slack.botTokenFile', 'slack.appTokenFile',
  'ntfy.enabled', 'ntfy.server',
  'advocates.enabled', 'advocates.workspaces', 'advocates.maintenanceAt',
  'claudeSessionsDir', 'claudeProjectsDir', 'terminalMax', 'assetRoots',
];

export const needsRestart = (key) => RESTART.some((r) => (r.endsWith('.') ? key.startsWith(r) : key === r));

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * What a default cannot say. `type` is one of boolean, number, enum, string, json;
 * `min`/`max` are the documented clamps (inclusive), and `minKey`/`maxKey` a clamp that is
 * another setting's value. `nullable` lets `null` through. `check` is any extra rule, and
 * returns the value to store or throws the sentence to show.
 */
export const SPECS = {
  me: { type: 'json', nullable: true, check: (v) => {
    if (v === null || typeof v === 'string' || (Array.isArray(v) && v.every((x) => typeof x === 'string'))) return v;
    throw new Error('me is a handle, a list of handles, or null');
  } },
  port: { type: 'number', min: 1, max: 65535 },
  'release.seconds': { type: 'number', min: 60 },
  'release.armedSeconds': { type: 'number', min: 1 },
  'release.settleSeconds': { type: 'number', min: 0 },
  'release.settleMaxSeconds': { type: 'number', minKey: 'release.settleSeconds' },
  'incidents.sev1': { type: 'json', check: commitment },
  'incidents.sev2': { type: 'json', check: commitment },
  'incidents.sev3': { type: 'json', check: commitment },
  'incidents.sev4': { type: 'json', check: commitment },
  'incidents.escalateAt': { type: 'number', min: 1 },
  'incidents.reviewFrom': { type: 'enum', options: ['sev1', 'sev2', 'sev3', 'sev4'] },
  'sessionWindows.screen': { type: 'string', check: (v) => {
    if (v === 'largest' || v === 'main') return v;
    if (/^\d+$/.test(String(v))) return Number(v);
    throw new Error('largest, main, or a 0-based display number');
  } },
  'pr.mergeMethod': { type: 'enum', options: ['merge', 'squash', 'rebase'] },
  'advocates.maxWorkersLimit': { type: 'number', min: 1, max: 9 },
  'advocates.maxWorkers': { type: 'number', min: 1, maxKey: 'advocates.maxWorkersLimit' },
  'advocates.globalMaxWorkers': { type: 'number', min: 1, max: 36 },
  'advocates.maxResolvers': { type: 'number', min: 1, max: 6 },
  'advocates.maxEpicAdvocates': { type: 'number', min: 1, max: 9 },
  'advocates.minPriority': { type: 'number', min: 0, max: 4 },
  'advocates.maxProposals': { type: 'number', min: 0, max: 20 },
  'advocates.sessionAuditMax': { type: 'number', min: 3, max: 40 },
  'advocates.sessionAuditMaxAgeMinutes': { type: 'number', min: 60, max: 10080 },
  'advocates.sessionAuditSweepMinutes': { type: 'number', min: 5, max: 1440 },
  'advocates.memoryCuratorDays': { type: 'number', min: 1, max: 90 },
  'advocates.parkHandIdleMinutes': { type: 'number', minKey: 'advocates.parkIdleMinutes' },
  'advocates.parkWorkerIdleMinutes': { type: 'number', minKey: 'advocates.parkIdleMinutes' },
  'advocates.agentRepo': { type: 'enum', options: ['alternate', 'blind', 'index', 'off'] },
  'advocates.maintenanceAt': { type: 'string', check: (v) => {
    if (HHMM.test(String(v))) return String(v);
    throw new Error('a wall-clock time, HH:MM');
  } },
  'compliance.subjects': { type: 'json', shape: 'object' },
  // Three with no default in lib/config.js, so nothing there can say what they are.
  agentToolsAcknowledged: { type: 'json', shape: 'array' },
  claudeSessionsDir: { type: 'string', nullable: true },
  claudeProjectsDir: { type: 'json', nullable: true, check: (v) => {
    if (v === null || typeof v === 'string' || (Array.isArray(v) && v.every((x) => typeof x === 'string'))) return v;
    throw new Error('claudeProjectsDir is a directory, a list of them, or null');
  } },
  jiraSeconds: { type: 'number', min: 15 },
  checkoutRefreshMinutes: { type: 'number', min: 1 },
  pollSeconds: { type: 'number', min: 1 },
  detectSeconds: { type: 'number', min: 1 },
  agentLogRetentionMonths: { type: 'number', min: 24 },
  strayHours: { type: 'number', min: 0, integer: false, check: (v) => {
    if (v !== 0 && v < 1) throw new Error('0 switches the sweep off; anything else is at least an hour');
    return v;
  } },
  'sync.seconds': { type: 'number', min: 30 },
  'publication.seconds': { type: 'number', min: 60 },
  doltServer: { type: 'enum', options: ['advocated', 'all', 'off'] },
  'ntfy.detail': { type: 'enum', options: ['full', 'minimal'] },
  'questions.settleMinutes': { type: 'number', min: 0, max: 120 },
  'slack.detail': { type: 'enum', options: ['full', 'minimal'] },
  'slack.maxButtons': { type: 'number', min: 1, max: 25 },
  'auth.google.sessionDays': { type: 'number', min: 1 },
};

/** `{acknowledge, resolve}` in minutes, neither below one — lib/incident.js's rule. */
function commitment(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('an object: { "acknowledge": minutes, "resolve": minutes }');
  const unknown = Object.keys(v).filter((k) => k !== 'acknowledge' && k !== 'resolve');
  if (unknown.length) throw new Error(`unknown field ${unknown[0]} — only acknowledge and resolve`);
  for (const k of ['acknowledge', 'resolve']) {
    if (v[k] === undefined) continue;
    if (!Number.isFinite(v[k]) || v[k] < 1) throw new Error(`${k} is a number of minutes, at least 1`);
  }
  return v;
}

/* ------------------------------------------------------------------ path handling */

const segs = (key) => String(key).split('.');

/** The value at a dotted path, or `undefined`. */
export function getPath(obj, key) {
  let cur = obj;
  for (const s of segs(key)) {
    if (cur === null || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, s)) return undefined;
    cur = cur[s];
  }
  return cur;
}

export const hasPath = (obj, key) => getPath(obj, key) !== undefined;

/** A copy of `obj` with one path set, every object on the way created if missing. */
function withPath(obj, key, value) {
  const [head, ...rest] = segs(key);
  const base = obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  if (!rest.length) return { ...base, [head]: value };
  return { ...base, [head]: withPath(base[head], rest.join('.'), value) };
}

/** A copy of `obj` with one path removed; an object left empty on the way stays. */
function withoutPath(obj, key) {
  const [head, ...rest] = segs(key);
  if (!obj || typeof obj !== 'object' || !(head in obj)) return obj;
  if (!rest.length) {
    const { [head]: _gone, ...left } = obj;
    return left;
  }
  return { ...obj, [head]: withoutPath(obj[head], rest.join('.')) };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** `jira.<workspace>.ingest` → `{ parent: 'jira', rest: 'ingest', kind: 'map' }`. */
export function placeholderParent(key) {
  const m = /^(.*?)(?:\.<[^>]+>|\[\])\.?(.*)$/.exec(key);
  if (!m) return null;
  return { parent: m[1], rest: m[2], kind: key.includes('[]') ? 'list' : 'map' };
}

/* ----------------------------------------------------------------------- secrets */

/**
 * A copy with every credential-named field replaced, and whether there was one. The only
 * shape a structured value is ever sent to a browser in.
 */
export function redact(value) {
  let hidden = false;
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== 'object') return v;
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (SECRET_FIELD.test(k) && x !== null && x !== '' && typeof x !== 'object') {
        hidden = true;
        out[k] = '(set — hidden)';
      } else out[k] = walk(x);
    }
    return out;
  };
  return { value: walk(value), hidden };
}

/** Does this value carry a credential-named field anywhere in it? */
export const carriesSecret = (value) => redact(value).hidden;

export const isSecret = (key) => SECRET_KEYS.has(key) || SECRET_FIELD.test(segs(key).at(-1));

function fileOnlyWhy(key) {
  for (const [re, why] of FILE_ONLY) {
    if (!re.test(key)) continue;
    if (why) return why;
    const p = placeholderParent(key);
    return p ? `One field of every entry in ${p.parent} — edit it inside ${p.parent}.` : 'Changed in the file.';
  }
  return null;
}

/* ----------------------------------------------------------------- one key, typed */

/** `(default `x`)` or `(default 30` out of the prose, for a key with no default in code. */
function docDefault(description) {
  const m = /\(default `([^`]*)`|\(default (-?\d+(?:\.\d+)?)\b/.exec(description || '');
  if (!m) return undefined;
  if (m[2] !== undefined) return Number(m[2]);
  try {
    return JSON.parse(m[1]);
  } catch {
    return m[1];
  }
}

const typeOfValue = (v) =>
  v === null || v === undefined ? null : Array.isArray(v) || typeof v === 'object' ? 'json' : typeof v === 'boolean' ? 'boolean' : typeof v === 'number' ? 'number' : typeof v === 'string' ? 'string' : null;

/**
 * Everything the page and the write path need to know about one key, before any value.
 * `type: 'unknown'` is the one answer the acceptance test refuses.
 */
export function specFor(docKey, { defaults = {}, cfg = {} } = {}) {
  const key = docKey.key;
  const own = SPECS[key] || {};
  const placeholder = placeholderParent(key);
  const def = placeholder ? undefined : getPath(defaults, key);
  const fromDoc = def === undefined ? docDefault(docKey.description) : undefined;
  const hasDefault = def !== undefined || fromDoc !== undefined;
  const dflt = def !== undefined ? def : fromDoc;
  let type = own.type || typeOfValue(dflt) || typeOfValue(placeholder ? null : getPath(cfg, key));
  if (!type && placeholder) type = 'json';
  if (!type && hasDefault && dflt === null) type = 'string';
  const secret = isSecret(key);
  const why = fileOnlyWhy(key);
  return {
    key,
    type: type || 'unknown',
    default: secret ? undefined : dflt,
    hasDefault,
    nullable: own.nullable ?? (dflt === null),
    integer: type === 'number' && (own.integer ?? (dflt === undefined || Number.isInteger(dflt))),
    min: own.min ?? (type === 'number' ? 0 : undefined),
    max: own.max,
    minKey: own.minKey,
    maxKey: own.maxKey,
    options: own.options,
    shape: own.shape || (Array.isArray(dflt) ? 'array' : dflt && typeof dflt === 'object' ? 'object' : undefined),
    check: own.check,
    secret,
    placeholder,
    editable: !secret && !why,
    why,
    restart: needsRestart(key),
  };
}

/**
 * The value to store for `raw`, or a throw with the sentence the page shows under the
 * editor. The same rules for a write from the page and for a revert from the log.
 */
export function validate(spec, raw, cfg = {}) {
  const key = spec.key;
  if (!spec.editable) throw new Error(`${key} is not changed from here — ${spec.why || 'it is a secret'}`);
  if (raw === null) {
    if (spec.nullable) return null;
    throw new Error(`${key} cannot be null — use Reset to go back to the default`);
  }
  let v = raw;
  switch (spec.type) {
    case 'boolean':
      if (typeof v !== 'boolean') throw new Error(`${key} is true or false`);
      break;
    case 'number': {
      if (typeof v === 'string' && v.trim() !== '') v = Number(v);
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${key} is a number`);
      if (spec.integer && !Number.isInteger(v)) throw new Error(`${key} is a whole number`);
      const lo = spec.minKey ? getPath(cfg, spec.minKey) : spec.min;
      const hi = spec.maxKey ? getPath(cfg, spec.maxKey) : spec.max;
      if (Number.isFinite(lo) && v < lo) throw new Error(`${key} is at least ${lo}${spec.minKey ? ` (${spec.minKey})` : ''}`);
      if (Number.isFinite(hi) && v > hi) throw new Error(`${key} is at most ${hi}${spec.maxKey ? ` (${spec.maxKey})` : ''}`);
      break;
    }
    case 'enum':
      if (!spec.options.includes(v)) throw new Error(`${key} is one of ${spec.options.join(', ')}`);
      break;
    case 'string':
      if (typeof v !== 'string' && !(spec.check && typeof v === 'number')) throw new Error(`${key} is text`);
      break;
    case 'json':
      if (spec.shape === 'array' && !Array.isArray(v)) throw new Error(`${key} is a JSON array`);
      if (spec.shape === 'object' && (!v || typeof v !== 'object' || Array.isArray(v))) throw new Error(`${key} is a JSON object`);
      // The rule lib/config.js makes for `clientSecret`, made for every object: a secret
      // in this file is a secret in the common repo's history. See `absorbClientSecret`.
      if (carriesSecret(v)) throw new Error(`${key} would put a credential into config.json, which is committed — keep it in its key file`);
      break;
    default:
      throw new Error(`${key} has no editor`);
  }
  return spec.check ? spec.check(v) : v;
}

/* ------------------------------------------------------------- the catalogue */

/** Keys a space can answer for, and the field it answers in. See SETTINGS in lib/spaces.js. */
const SPACE_FIELD = {
  autoEndorse: 'autoEndorse',
  autoDispatch: 'autoDispatch',
  'pr.autoMerge': 'autoMerge',
  'pr.requireApproval': 'requireApproval',
  'pr.reviewRequired': 'reviewRequired',
  'pr.trustChecksAcrossDownmerge': 'trustChecksAcrossDownmerge',
  'release.autoShip': 'autoShip',
  'ntfy.detail': 'ntfyDetail',
  'slack.channel': 'slackChannel',
  'slack.detail': 'slackDetail',
};

/** The per-workspace map key for a global key, where one exists. */
const WORKSPACE_MAP = {
  autoEndorse: PER_WORKSPACE.autoEndorse,
  'pr.autoMerge': PER_WORKSPACE.autoMerge,
  'pr.requireApproval': PER_WORKSPACE.requireApproval,
  'pr.reviewRequired': PER_WORKSPACE.reviewRequired,
  'pr.trustChecksAcrossDownmerge': PER_WORKSPACE.trustChecksAcrossDownmerge,
  'release.autoShip': PER_WORKSPACE.autoShip,
};

/** `autoMergePerWorkspace` → `autoMerge`. */
const FIELD_OF_MAP = Object.fromEntries(Object.entries(PER_WORKSPACE).map(([field, mapKey]) => [mapKey, field]));

/**
 * Where else this key is answered: the spaces and repos that outrank the global for it.
 * Empty for every key no space or repo can override.
 */
function overridesOf(cfg, key) {
  const out = [];
  const field = SPACE_FIELD[key];
  if (field) {
    for (const s of cfg.spaces || []) {
      if (s && s[field] !== undefined && s[field] !== null) out.push({ scope: 'space', name: s.name, value: s[field] });
    }
  }
  const mapKey = WORKSPACE_MAP[key];
  if (mapKey) {
    for (const [ws, v] of Object.entries(cfg[mapKey] || {})) {
      if (typeof v === 'boolean') out.push({ scope: 'workspace', name: ws, value: v });
    }
  }
  return out;
}

/** For a `…PerWorkspace` map: what every workspace resolves to, and from where. */
function perWorkspaceRows(cfg, key) {
  const field = FIELD_OF_MAP[key];
  if (!field) return undefined;
  return (cfg.workspaces || []).map((w) => {
    const own = cfg[key]?.[w.name];
    const space = (cfg.spaces || []).find((s) => (s.workspaces || []).includes(w.name));
    const from = typeof own === 'boolean' ? 'workspace' : typeof space?.[field] === 'boolean' ? 'space' : 'global';
    return { workspace: w.name, value: workspaceAnswer(cfg, w.name, field), from, space: space?.name || null };
  });
}

/** A placeholder key's values, gathered from its parent: `{northwind: false, …}`. */
function gathered(cfg, p) {
  const parent = getPath(cfg, p.parent);
  const out = {};
  if (Array.isArray(parent)) {
    parent.forEach((item, i) => {
      const v = p.rest ? getPath(item, p.rest) : item;
      if (v !== undefined) out[item?.id ?? String(i)] = v;
    });
  } else if (parent && typeof parent === 'object') {
    for (const [k, item] of Object.entries(parent)) {
      const v = p.rest ? getPath(item, p.rest) : item;
      if (v !== undefined) out[k] = v;
    }
  }
  return out;
}

/**
 * One key as a browser may see it. **The only function whose output leaves the daemon**,
 * and the place the secret rule is kept: a secret key carries `isSet` and nothing else,
 * and every structured value goes through `redact`.
 *
 * `raw` is the stored file and `cfg` the running daemon's config object; they differ for
 * a key hand-edited since the last start, and `fileValue` says so when they do.
 */
export function publicEntry(docKey, spec, { cfg = {}, raw = {} } = {}) {
  const key = spec.key;
  const base = {
    key,
    group: groupOf(key),
    description: docKey.description,
    type: spec.secret ? 'secret' : spec.type,
    editable: spec.editable,
    why: spec.why || undefined,
    restart: spec.restart,
    inFile: spec.placeholder ? undefined : hasPath(raw, key),
  };
  if (spec.secret) {
    const v = getPath(cfg, key);
    return { ...base, isSet: v !== undefined && v !== null && v !== '' };
  }
  const live = spec.placeholder ? gathered(cfg, spec.placeholder) : getPath(cfg, key);
  const shown = redact(live);
  const stored = getPath(raw, key);
  const entry = {
    ...base,
    value: shown.value,
    default: spec.hasDefault ? redact(spec.default).value : undefined,
    hasDefault: spec.hasDefault,
    isDefault: spec.hasDefault && same(live, spec.default),
    nullable: spec.nullable || undefined,
    integer: spec.integer || undefined,
    min: spec.minKey ? getPath(cfg, spec.minKey) : spec.min,
    max: spec.maxKey ? getPath(cfg, spec.maxKey) : spec.max,
    options: spec.options,
    shape: spec.shape,
  };
  // An object with a credential in it is drawn and not edited: the editor would be holding
  // the placeholder, and Save would write the placeholder over the real value.
  if (shown.hidden) {
    entry.editable = false;
    entry.why = 'Holds a credential, which is hidden here — edit it in the file.';
  }
  if (!spec.placeholder && stored !== undefined && !same(stored, live)) entry.fileValue = redact(stored).value;
  const overrides = overridesOf(cfg, key);
  if (overrides.length) entry.overrides = overrides;
  const rows = perWorkspaceRows(cfg, key);
  if (rows) entry.perWorkspace = rows;
  return entry;
}

/** Every documented key's spec, keyed by name — what the write path validates against. */
export function specsFor(docKeys, ctx) {
  return new Map(docKeys.map((d) => [d.key, specFor(d, ctx)]));
}

/**
 * The page's whole payload: the groups, in the document's order, each with its keys.
 */
export function catalogue(docKeys, { cfg = {}, raw = {}, defaults = {} } = {}) {
  const groups = new Map();
  for (const d of docKeys) {
    const spec = specFor(d, { defaults, cfg });
    const entry = publicEntry(d, spec, { cfg, raw });
    if (!groups.has(entry.group)) groups.set(entry.group, []);
    groups.get(entry.group).push(entry);
  }
  return [...groups].map(([name, keys]) => ({ name, keys }));
}

/** Every documented key the page could not draw an editor or a value for. Must be empty. */
export function unshowable(docKeys, ctx) {
  return docKeys.filter((d) => specFor(d, ctx).type === 'unknown').map((d) => d.key);
}

/* ------------------------------------------------------------------- the write */

/**
 * What the stored JSON becomes. Pure: `{ next, old, now }`, where `old` and `now` are
 * `{ set, value }` — `set: false` meaning the key is absent from the file and the default
 * applies. `value === undefined` (or `reset`) removes the key.
 */
export function planWrite(raw, key, value, { reset = false } = {}) {
  const before = getPath(raw, key);
  const next = reset ? withoutPath(raw, key) : withPath(raw, key, value);
  return {
    next,
    old: before === undefined ? { set: false } : { set: true, value: clone(before) },
    now: reset ? { set: false } : { set: true, value: clone(value) },
  };
}

/** Put one key into the running config object the way `loadConfig` would have read it. */
export function applyLive(cfg, key, now, defaults) {
  const value = now.set ? clone(now.value) : clone(getPath(defaults, key));
  const parts = segs(key);
  let cur = cfg;
  for (const s of parts.slice(0, -1)) {
    if (!cur[s] || typeof cur[s] !== 'object' || Array.isArray(cur[s])) cur[s] = {};
    cur = cur[s];
  }
  if (value === undefined) delete cur[parts.at(-1)];
  else cur[parts.at(-1)] = value;
}

/* --------------------------------------------------------------------- the log */

export const LOG_NAME = 'config-changes.jsonl';

/** The last `n` writes, newest first. A line that does not parse is skipped, not fatal. */
export function readLog(file, n = 50) {
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split('\n').reverse()) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* a torn last line from a crash — the rest is still the log */
    }
    if (out.length >= n) break;
  }
  return out;
}

/**
 * The log as a browser may see it. A write from the page can never carry a secret — the
 * secret keys are not writable and a value holding a credential is refused — but a log
 * line is a file on disk that anything could have appended to, so it is redacted on the
 * way out regardless, and the secret keys' values are dropped outright.
 */
export function publicLog(entries) {
  const side = (key, s) => {
    if (!s?.set) return { set: false };
    return isSecret(key) ? { set: true } : { set: true, value: redact(s.value).value };
  };
  return entries.map((e) => ({ ...e, old: side(e.key, e.old), new: side(e.key, e.new) }));
}

export function findLogEntry(file, id) {
  return readLog(file, Infinity).find((e) => e.id === id) || null;
}

/**
 * Change one key: validate, write the file surgically, change the running config, log it.
 *
 * `op` is `{ key, value }`, `{ key, reset: true }` or `{ revert: <log id> }`. Returns
 * `{ entry, restart, changed }`; throws `{ status, message }`-shaped errors the route
 * turns into a 400 or 404. `onWritten` is called after the file is replaced — the daemon
 * passes the common repo's snapshot.
 */
export function writeKey(op, { docKeys, cfg, view = cfg, defaults, configPath, logPath, who, onWritten, now = new Date() }) {
  const fail = (status, message) => Object.assign(new Error(message), { status });
  let key = op.key;
  let reset = Boolean(op.reset);
  let value = op.value;
  let revertOf;
  if (op.revert) {
    const was = findLogEntry(logPath, String(op.revert));
    if (!was) throw fail(404, `no change ${op.revert} in the log`);
    key = was.key;
    reset = !was.old.set;
    value = was.old.value;
    revertOf = was.id;
  }
  const doc = docKeys.find((d) => d.key === key);
  if (!doc) throw fail(404, `${key || '(no key)'} is not a documented key`);
  const spec = specFor(doc, { defaults, cfg: view });
  if (spec.placeholder || !spec.editable) throw fail(400, `${key} is not changed from here — ${spec.why || 'it is a secret'}`);
  if (value === undefined && !reset) throw fail(400, `no value for ${key}`);
  let stored;
  try {
    stored = reset ? undefined : validate(spec, value, view);
  } catch (err) {
    throw fail(400, err.message);
  }

  const raw = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
  // The page drew it read-only (`publicEntry`), and this is the same rule for a caller
  // that is not the page: replacing an object that holds a credential would either drop
  // the credential or put it in the log.
  if (carriesSecret(getPath(raw, key)) || carriesSecret(getPath(cfg, key))) {
    throw fail(400, `${key} holds a credential, which is hidden here — edit it in the file`);
  }
  const plan = planWrite(raw, key, stored, { reset });
  if (same(plan.old, plan.now)) return { entry: null, restart: spec.restart, changed: false };

  writeJsonAtomic(configPath, plan.next);
  onWritten?.();
  applyLive(cfg, key, plan.now, defaults);

  const entry = {
    id: crypto.randomBytes(6).toString('hex'),
    at: now.toISOString(),
    who: who || 'a paired device',
    key,
    old: plan.old,
    new: plan.now,
    ...(revertOf ? { revertOf } : {}),
    restart: spec.restart,
  };
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  return { entry, restart: spec.restart, changed: true };
}
