/**
 * A synthetic compliance subject, for the suites that used to read one compiled into lib/.
 *
 * Beadcause holds the compliance engines and no subject of its own: which system a SOC 2
 * report describes, for which user entities, with which gap assessment rows, is the
 * organisation's record and arrives through `compliance.subjects` (lib/boundary.js). So a
 * suite that wants to exercise the engines against something realistic needs a subject to
 * load, and this is it — **Acme**, an invented service organisation running an invented
 * platform for two invented user entities, Globex and Initech.
 *
 * The shape is deliberately the shape a first real subject has, because that is the shape
 * every pinned count in the suites was written against: beadcause and its agent roles
 * carved out with what each still bears on; nothing enumerated inside; six of seven
 * censuses partial and the user entities enumerated; no subservice organisations; one row
 * per elected criterion, all absent except CC8.1, which carries evidence and no control;
 * privacy declined and processing integrity deferred; two owed commitment categories. So
 * the counts the suites pin — 38 elected criteria, 0 met / 1 partial / 37 absent, 20
 * provisional, 7 boundary gaps — are properties of this fixture rather than of anybody's
 * real programme, and changing one here is the deliberate edit that moves them.
 *
 * Everything the words say is made up. Nothing here is, or is derived from, a real
 * organisation's data.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadSubjects } from '../../lib/boundary.js';

/** The census kinds, in lib/boundary.js's order — restated so this file loads nothing else. */
const CENSUS = ['repo', 'host', 'datastore', 'egress', 'role', 'subservice', 'user-entity'];

/**
 * Criterion, owning function, and the census kinds it is tested against — one per elected
 * criterion (CC 33, A 3, C 2). The populations are what make the provisional count 20.
 */
const ROWS = [
  ['CC1.1', 'executive sponsor', []],
  ['CC1.2', 'executive sponsor', []],
  ['CC1.3', 'executive sponsor', []],
  ['CC1.4', 'people lead', []],
  ['CC1.5', 'executive sponsor', []],
  ['CC2.1', 'security lead', []],
  ['CC2.2', 'people lead', []],
  ['CC2.3', 'executive sponsor', []],
  ['CC3.1', 'executive sponsor', []],
  ['CC3.2', 'security lead', []],
  ['CC3.3', 'executive sponsor', []],
  ['CC3.4', 'engineering lead', ['repo']],
  ['CC4.1', 'security lead', []],
  ['CC4.2', 'security lead', []],
  ['CC5.1', 'security lead', []],
  ['CC5.2', 'engineering lead', ['host', 'repo']],
  ['CC5.3', 'security lead', []],
  ['CC6.1', 'security lead', ['host', 'datastore', 'role']],
  ['CC6.2', 'security lead', ['role']],
  ['CC6.3', 'security lead', ['role', 'repo']],
  ['CC6.4', 'operations lead', ['host']],
  ['CC6.5', 'operations lead', ['datastore', 'host']],
  ['CC6.6', 'engineering lead', ['host', 'egress']],
  ['CC6.7', 'engineering lead', ['datastore', 'egress']],
  ['CC6.8', 'engineering lead', ['host', 'repo']],
  ['CC7.1', 'engineering lead', ['host', 'repo']],
  ['CC7.2', 'operations lead', ['host', 'datastore']],
  ['CC7.3', 'security lead', ['host']],
  ['CC7.4', 'security lead', []],
  ['CC7.5', 'operations lead', []],
  ['CC8.1', 'engineering lead', ['repo']],
  ['CC9.1', 'operations lead', []],
  ['CC9.2', 'security lead', ['egress', 'subservice']],
  ['A1.1', 'operations lead', ['host']],
  ['A1.2', 'operations lead', ['host', 'datastore']],
  ['A1.3', 'operations lead', ['host']],
  ['C1.1', 'security lead', ['datastore']],
  ['C1.2', 'security lead', ['datastore']],
];

const AGENTS = [
  ['console', 'the chat session'],
  ['dispatch', 'the comment answerer'],
  ['advocate', 'the repo advocate'],
  ['epic-advocate', 'the Epic Advocate'],
  ['worker', 'the work session'],
  ['merge-advocate', 'the merge queue'],
  ['review-advocate', 'the pull request reviewer'],
];

function row([local, owner, population]) {
  const id = `SOC2.${local}`;
  const change = local === 'CC8.1';
  return {
    id,
    owner,
    population,
    control: null,
    evidence: change
      ? 'Beadcause holds a per-change record for the repositories it drives, and lib/changesample.js hands an ' +
        'auditor a sample of them.'
      : null,
    why: change
      ? 'Evidence without a control: Acme has not described how a change reaches production in Widget Cloud, ' +
        'so there is a sampleable record of the authoring half and nothing to test it against.'
      : `Acme has described no control over Widget Cloud for ${local}, and nothing an auditor could sample exists yet.`,
    bears: change ? 'lib/boundary.js records beadcause as carved out with bearsOn naming this criterion.' : null,
    held: population.length
      ? `The Acme architecture notes — the ${population.join(' and ')} census is partial.`
      : 'Acme — an organisational control nothing in this repository can hold.',
  };
}

/** A fresh Acme subject, as a plain object a suite may mutate before writing it out. */
export function acmeSubject() {
  const carved = (kind, id, label, why, bearsOn) => ({ id, kind, label, disposition: 'carved-out', why, bearsOn });
  return {
    organisation: 'acme',
    boundary: {
      organisation: 'acme',
      system: 'Widget Cloud',
      serviceOrganisation: 'Acme',
      first: true,
      decidedBy: 'bc-0000',
      statement:
        'The Widget Cloud platform operated by Acme — the services its user entities reach, the data they submit ' +
        'and the reporting they receive. The tooling Acme builds it with is carved out below.',
      components: [
        carved(
          'repo',
          'beadcause',
          'the management system itself',
          'Development-side tooling no user entity reaches, holding none of their data.',
          'Change management. It opens the agent sessions that change the in-scope repositories, so CC8.1 wants its records.'
        ),
        carved(
          'host',
          'beadcause-host',
          'the Mac the beadcause daemon runs on',
          'A development workstation serving no user entity traffic and storing no user entity data.',
          'Logical access. It holds the identities every agent acts under.'
        ),
        ...AGENTS.map(([id, title]) =>
          carved(
            'role',
            `agent-${id}`,
            `beadcause agent, ${title}`,
            'A non-human identity inside the carved-out tooling, with no credential for the in-scope system.',
            'Change management and logical access — an actor in the path by which in-scope code changes.'
          )
        ),
      ],
      userEntities: [
        { id: 'globex', label: 'Globex', why: 'Submits widget orders to Widget Cloud and reads its reporting.', source: 'bc-0000' },
        { id: 'initech', label: 'Initech', why: 'Submits widget orders to Widget Cloud and reads its reporting.', source: 'bc-0000' },
      ],
      subservice: [],
      census: Object.fromEntries(
        CENSUS.map((k) => [
          k,
          k === 'user-entity'
            ? { state: 'enumerated', note: 'Globex and Initech.' }
            : { state: 'partial', held: 'the Acme architecture notes', note: `The ${k} list has not been surveyed.` },
        ])
      ),
    },
    assessment: {
      decidedBy: { categories: 'bc-0001' },
      notElected: [
        {
          category: 'PI',
          label: 'Processing Integrity',
          decision: 'bc-0001',
          disposition: 'deferred',
          why: 'Deferred to renewal — Widget Cloud computes figures a buyer may challenge, and that is left for later.',
        },
        {
          category: 'P',
          label: 'Privacy',
          decision: 'bc-0001',
          disposition: 'declined',
          why: 'Declined — the corpus has no framework token able to claim most of the privacy criteria.',
        },
      ],
      rows: ROWS.map(row),
    },
    commitments: [
      {
        id: 'availability',
        title: 'Availability commitment',
        aim: 'What uptime, capacity or recovery time Acme has promised its user entities, and what that imposes.',
        toUserEntities: ['globex', 'initech'],
        criteria: ['SOC2.A1.1', 'SOC2.A1.2', 'SOC2.A1.3'],
        ownerRole: 'operations lead',
        reviewMonths: 12,
        adoption: 'owed',
        owes: 'Nobody has read the Globex and Initech agreements for what they promise about uptime.',
      },
      {
        id: 'confidentiality',
        title: 'Confidentiality commitment',
        aim: 'What Acme has promised about how user entity information is protected, retained and disposed of.',
        toUserEntities: ['globex', 'initech'],
        criteria: ['SOC2.C1.1', 'SOC2.C1.2'],
        ownerRole: 'security lead',
        reviewMonths: 12,
        adoption: 'owed',
        owes: 'Nobody has read the Globex and Initech agreements for what they promise about confidentiality.',
      },
    ],
  };
}

/** Write a subject as JSON into `dir`, and return its absolute path. */
export function writeSubject(dir, subject = acmeSubject(), name = 'acme-subject.json') {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, `${JSON.stringify(subject, null, 2)}\n`);
  return file;
}

/**
 * Point a config directory's `compliance.subjects` at `{ org: file }`, keeping anything
 * else already in its config.json. For suites that spawn a command with
 * BEADCAUSE_CONFIG_DIR set, which reads the config the way an install does.
 */
export function configureSubjects(configDir, subjects) {
  fs.mkdirSync(configDir, { recursive: true });
  const file = path.join(configDir, 'config.json');
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    cfg = {};
  }
  cfg.compliance = { ...(cfg.compliance || {}), subjects };
  fs.writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`);
  return file;
}

/**
 * The whole arrangement a suite usually wants, in one call: a scratch directory holding the
 * Acme subject and a config directory naming it, with the subject loaded in this process.
 *
 * `env` is what to hand a spawned command so it reads the same subject. The scratch
 * directory is removed at exit.
 */
export function useAcme(subject = acmeSubject()) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-subject-'));
  const file = writeSubject(path.join(root, 'org'), subject);
  const configDir = path.join(root, 'config');
  configureSubjects(configDir, { acme: file });
  loadSubjects({ acme: file });
  process.on('exit', () => fs.rmSync(root, { recursive: true, force: true }));
  return { root, file, configDir, env: { ...process.env, BEADCAUSE_CONFIG_DIR: configDir } };
}
