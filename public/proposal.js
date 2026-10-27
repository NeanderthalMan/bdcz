/*
  One proposal card, rendered wherever a proposal is met (ux-review §4.3/§6.5).

  Written first as bc-iaju1.7 (#95), which sat two months unmerged while main moved
  under it; redone on current main as bc-yjekg.5 rather than rebased. Same design, same
  seam — #95 was the spec.

  ## What this replaced, and why three renderers could not stay

  An advocate asking to create beads arrived on three screens and looked like three
  different questions. `public/app.js` had the card the work went into: a row per bead
  with ✓/✎/✕, the duplicate warning, the fold for a long row, the adjust editor, and two
  bulk controls that each name the exact number the next tap files. `public/monitor.js`
  had a second one — its own `picksFor`, its own `proposalHtml`, Create/Decline per row,
  All/None, and a primary that stayed disabled until every row had been answered.
  `public/mirror.js` had a third, which drew the beads and then told you to go somewhere
  else: *"Per-bead buttons live on the Advocates tab."*

  Three renderers is three answers to the same question, and the UX review's objection is
  the one that matters: the *same* decision asked in three different grammars is a
  decision you learn three times and trust none of. The monitor's card could not decline
  two of three without declining by omission; the mirror's could not answer at all
  without typing `CREATE: 1,3` into a box. Neither could adjust a title, which is the
  common case — the bead is worth filing and the sentence is wrong.

  So: one module, one card, three mounts. The rows, the fold, the editor, the duplicate
  flag and the two bulk controls are written once here and drawn identically from all
  three, and the pick state is **shared across mounts on purpose** — index.html carries
  app.js and mirror.js at the same time, and a ✓ that meant one thing in the inbox and
  nothing in the mirror would be the same bug in a smaller room.

  ## What is deliberately NOT in here

  **The chat sheet on /console is not a proposal card and was not folded in.** Its
  `proposalHtml` is a one-line footer under a reply ("🧾 proposed 3 beads — review") and
  its sheet is a full *editor* over `chat.draft.beads` — remove a bead, retype any field,
  no ✓/✕ at all, because a draft you are still talking to an agent about is not a thing
  you approve row by row. It shares a word with this file and nothing else. Folding it in
  would have meant giving the sheet buttons that mean "file it" while the conversation
  that produced it is still open, which is the opposite of what that screen is for.

  ## The seam: state here, host there

  This file owns what a proposal *is* and what you have said about it. It owns no
  network call, no `render()`, no toast and no arm timer, because those are three
  different apps' business and the whole point was to stop this code knowing which
  screen it is on. A mount calls `bind()` with a handful of small functions and gets
  back the card plus the click handler for it; everything else it already had.

  The markup is buttons and spans only — no link inside any of them — for the rule
  bc-yjekg set across the app: an <a> nested in a <button> is two targets under one
  thumb. The duplicate warning names the other bead as a pill, not a link, for that
  reason.
*/
(() => {
  const esc = (s) =>
    String(s ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );

  /* ------------------------------------------------------------------ state */

  /*
    Shared across every mount, and held outside the question rather than on it, for the
    reason app.js's `state.picks` always was: a background poll must not wipe a half-made
    decision. The keys are the question's `key` (`workspace/id`), so two mounts drawing
    one proposal are drawing one answer-in-progress.
  */
  /** key → Map(1-based row → 'yes' | 'no'). What you have said about each bead. */
  const picks = new Map();
  /** key → Map(1-based row → partial bead). What you have rewritten. */
  const edits = new Map();
  /** `${key}|${n}` for every long row you have unfolded. */
  const unfolded = new Set();
  /** `${key}|${n}` for every row whose adjust editor is open. */
  const adjusting = new Set();

  const picksFor = (key) => {
    if (!picks.has(key)) picks.set(key, new Map());
    return picks.get(key);
  };

  const editsFor = (key) => {
    if (!edits.has(key)) edits.set(key, new Map());
    return edits.get(key);
  };

  /**
   * A proposed bead as it stands: what the agent wrote, under whatever you changed.
   *
   * Every surface reads beads through this rather than off `q.proposal` — the row, the
   * fold height, the bulk button's count — so an adjusted bead looks adjusted
   * everywhere, and there is never a moment where the card shows one title and the
   * create sends another.
   */
  const beadAt = (key, b, n) => ({ ...b, ...(editsFor(key).get(n) || {}) });

  /** Whether row `n` differs from what was proposed. Drives the "adjusted" flag. */
  const isAdjusted = (key, n) => {
    const patch = editsFor(key).get(n);
    return !!patch && Object.keys(patch).length > 0;
  };

  /** Rows an approve would file: everything not explicitly declined. */
  const keepIndices = (key, beads) => beads.map((_, i) => i + 1).filter((n) => picksFor(key).get(n) !== 'no');

  /**
   * Rows you have not answered either way. Counted, not silently treated as a no:
   * "3 undecided" is the difference between a considered decline and a half-read card.
   */
  const undecidedCount = (key, beads) =>
    beads.length - [...picksFor(key).values()].filter((v) => v === 'yes' || v === 'no').length;

  /**
   * Everything this module is holding for one key, and how to put it back.
   *
   * A submit that `bd` refuses hands the card back, and a proposal that came back with
   * every yes/no — and every rewrite you typed — wiped would cost far more than the
   * failure did. All four sets are snapshotted, not just the two obvious ones.
   */
  function snapshot(key) {
    return {
      picks: new Map(picksFor(key)),
      edits: new Map(editsFor(key)),
      unfolded: [...unfolded].filter((t) => t.startsWith(`${key}|`)),
      adjusting: [...adjusting].filter((t) => t.startsWith(`${key}|`)),
    };
  }

  function clear(key) {
    picks.delete(key);
    edits.delete(key);
    for (const t of [...unfolded]) if (t.startsWith(`${key}|`)) unfolded.delete(t);
    for (const t of [...adjusting]) if (t.startsWith(`${key}|`)) adjusting.delete(t);
  }

  function restore(key, snap) {
    if (!snap) return;
    picks.set(key, snap.picks);
    edits.set(key, snap.edits);
    for (const t of snap.unfolded) unfolded.add(t);
    for (const t of snap.adjusting) adjusting.add(t);
  }

  /* ------------------------------------------------------------- the editor */

  /** The fields adjusting exposes, and nothing else. */
  const EDIT_FIELDS = [
    { key: 'title', label: 'Title', tag: 'input' },
    { key: 'description', label: 'Description', tag: 'textarea', rows: 5 },
    { key: 'acceptance', label: 'Done when', tag: 'textarea', rows: 2 },
  ];

  const TYPES = ['task', 'bug', 'feature', 'epic', 'chore', 'decision'];
  /** Matches `TIERS` in lib/complexity.js, plus the empty one: no tier is a real answer. */
  const TIERS = ['', 'low', 'medium', 'high'];

  /**
   * The row, in edit mode.
   *
   * The five things the chat session lets you change — title, type, priority,
   * description, acceptance — and deliberately not labels or dependencies. Those are
   * structural, they are rarely what is wrong with a proposed bead, and a chip editor is
   * not something to build on a card you are trying to keep short. What you do not
   * adjust is created exactly as proposed.
   *
   * Complexity is the sixth, and it is here for a reason none of the other five have:
   * it is the only field on the row that spends money. An agent rated its own work, you
   * are the last reader before a session runs on that rating, and "this is harder than
   * it thinks" is a correction with nowhere else to go — the alternative is declining a
   * good bead over a wrong tier. `unrated` is a real choice and not a blank: it is what
   * every bead filed before bc-nc6o carries, and it takes the expensive model.
   *
   * Values come out of the `edits` map, never out of the DOM, so a background poll that
   * does manage to repaint cannot lose a word of it.
   */
  function editHtml(key, b, n) {
    const cur = beadAt(key, b, n);
    const field = (f) => {
      const v = esc(cur[f.key] || '');
      const attrs = `data-role="edit-field" data-key="${esc(key)}" data-idx="${n}" data-field="${f.key}"`;
      return `<label class="edit-field">
        <span class="prop-label">${f.label}</span>
        ${f.tag === 'input' ? `<input type="text" ${attrs} value="${v}">` : `<textarea rows="${f.rows}" ${attrs}>${v}</textarea>`}
      </label>`;
    };
    return `<div class="prop-edit">
      ${EDIT_FIELDS.map(field).join('')}
      <div class="edit-row">
        <label class="edit-field small">
          <span class="prop-label">Type</span>
          <select data-role="edit-field" data-key="${esc(key)}" data-idx="${n}" data-field="type">
            ${TYPES.map((t) => `<option value="${t}"${t === cur.type ? ' selected' : ''}>${t}</option>`).join('')}
          </select>
        </label>
        <label class="edit-field small">
          <span class="prop-label">Priority</span>
          <select data-role="edit-field" data-key="${esc(key)}" data-idx="${n}" data-field="priority">
            ${[0, 1, 2, 3, 4]
              .map((p) => `<option value="${p}"${p === Number(cur.priority) ? ' selected' : ''}>P${p}</option>`)
              .join('')}
          </select>
        </label>
        <label class="edit-field small">
          <span class="prop-label">Complexity</span>
          <select data-role="edit-field" data-key="${esc(key)}" data-idx="${n}" data-field="complexity">
            ${TIERS.map(
              (t) => `<option value="${t}"${t === (cur.complexity || '') ? ' selected' : ''}>${t || 'unrated'}</option>`
            ).join('')}
          </select>
        </label>
      </div>
      <button class="linkish" data-act="prop-edit" data-key="${esc(key)}" data-idx="${n}">Done adjusting</button>
    </div>`;
  }

  /**
   * The fields a proposed bead would be created with, in the order proposalBody prints
   * them (lib/proposal.js) — the row and the question body it came from should read the
   * same way round. Rationale is deliberately absent here: it is an argument for the
   * bead rather than part of it, so the row prints it last.
   */
  const PROP_FIELDS = [
    // The description needs no label: it is what a bead obviously is, and a row with
    // one short line in it should not carry a heading saying so.
    { key: 'description', label: '' },
    { key: 'acceptance', label: 'Done when' },
    { key: 'design', label: 'Design' },
    { key: 'notes', label: 'Notes' },
    { key: 'labels', label: 'Labels', pills: true },
    { key: 'deps', label: 'Depends on', pills: 'id' },
    // The files this bead says it expects to touch (bc-42ow). As pills, like labels,
    // because a path is a token and not prose — and last of the six for the reason
    // `proposalBody` prints it last: it is the one line here that says something about
    // the *other* rows, so it reads best after you have read this one.
    { key: 'files', label: 'Expects to touch', pills: true },
  ];

  /**
   * Everything that would end up on the bead, each under a quiet label.
   *
   * Prose goes through the mount's markdown renderer rather than out as escaped text:
   * an advocate writes a description as a bulleted list, and a list rendered as one
   * run-on line is a list you skip — which is the whole failure this row had.
   */
  function fieldsHtml(b, md) {
    return PROP_FIELDS.map((f) => {
      const v = b[f.key];
      const body = f.pills
        ? (Array.isArray(v) ? v : []).map((x) => `<span class="pill${f.pills === 'id' ? ' id' : ''}">${esc(x)}</span>`).join('')
        : v
          ? `<div class="md">${md(v)}</div>`
          : '';
      if (!body) return '';
      const label = f.label ? `<span class="prop-label">${f.label}</span>` : '';
      return `<div class="prop-field${f.pills ? ' pills' : ''}">${label}${body}</div>`;
    }).join('');
  }

  /**
   * "This already exists" — outside the fold, deliberately.
   *
   * Every other field on a row lives in `.prop-body`, which a long row starts folded.
   * This one cannot: it is the only thing on the card that changes what ✓ *means*, and
   * a warning you have to tap "Show the rest" to find is a warning that arrives after
   * the decision. It is stamped on by lib/dupe.js when the proposal is written, and it
   * rides through the stored bead in the `beadproposal` block, so what is drawn here is
   * what the server itself would find.
   */
  function dupeHtml(b) {
    const d = b.duplicate;
    if (!d?.id) return '';
    const where = d.status === 'proposed' ? 'already proposed in' : `already ${esc(d.status)} as`;
    return `<div class="prop-dupe">
      <span class="prop-dupe-flag">Possible duplicate</span>
      <span>${where} <span class="pill id">${esc(d.id)}</span>${d.title ? ` — ${esc(d.title)}` : ''}</span>
    </div>`;
  }

  // A phone column fits about this many characters, and this many lines of one row is
  // as much as can sit above the next proposal and still leave it scannable.
  const PHONE_COLS = 42;
  const COLLAPSE_AT = 9;

  /**
   * Roughly how tall a row's prose will be. Cheap on purpose: the alternative is
   * measuring after layout, and this only has to be right about "is this a wall of
   * text", which counting wrapped lines settles well enough.
   */
  function propLines(b) {
    const prose = [b.description, b.acceptance, b.design, b.notes, b.rationale].filter(Boolean).join('\n');
    if (!prose) return 0;
    return prose.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / PHONE_COLS)), 0);
  }

  /* ------------------------------------------------------------- the rows */

  /**
   * An advocate asking to create beads.
   *
   * Every other question in the inbox is one decision, which is why a mount can treat
   * an option tap as the answer. A proposal is *n* decisions that happen to arrive
   * together, and flattening them into "all or nothing" is what makes an agent's
   * suggestions annoying: one good bead in three is a perfectly ordinary outcome, and
   * having to decline all three to avoid the two bad ones teaches you to decline
   * everything.
   *
   * So: approve and decline per row, and — in `bulkHtml`, which a mount puts wherever
   * its card has room — the two bulk controls that say exactly how many each of them
   * will file. It paints in place, see `paint`, because a re-render would rebuild the
   * card under a decision you are halfway through making.
   */
  function rowsHtml(q, md) {
    const beads = q.proposal?.beads || [];
    if (!beads.length) return '';
    const thePicks = picksFor(q.key);

    const rows = beads
      .map((raw, i) => {
        const n = i + 1;
        // Everything below reads the *adjusted* bead, so a row you have rewritten looks
        // rewritten — there is never a moment where the card shows one title and
        // pressing create sends another.
        const b = beadAt(q.key, raw, n);
        const choice = thePicks.get(n) || '';
        const editing = adjusting.has(`${q.key}|${n}`);
        const adjusted = isAdjusted(q.key, n);
        // Long rows start folded so three proposals still fit on the screen you are
        // deciding from. A fold and not the old three-line clamp, because a clamp cuts
        // markdown mid-list-item and leaves no way at all to see the rest. A row being
        // adjusted is never folded: you cannot edit what is hidden.
        const long = propLines(b) > COLLAPSE_AT && !editing;
        const collapsed = long && !unfolded.has(`${q.key}|${n}`);
        return `<div class="prop-row ${choice ? `pick-${choice}` : ''}${collapsed ? ' is-collapsed' : ''}${
          editing ? ' is-editing' : ''
        }" data-idx="${n}" data-key="${esc(q.key)}">
          <div class="prop-main">
            <div class="prop-head"><span class="prop-n">${n}</span><span class="prop-title">${esc(b.title)}</span>${
              adjusted ? '<span class="pill adjusted">adjusted</span>' : ''
            }</div>
            ${dupeHtml(b)}
            ${
              editing
                ? editHtml(q.key, raw, n)
                : `<div class="prop-body">
              <div class="prop-meta">
                <span class="pill">${esc(b.type)}</span><span class="pill p${b.priority}">P${b.priority}</span>${
                  // How hard the agent thinks it is, which is what picks the model a
                  // session on it will run (bc-nc6o). Beside the type and the priority
                  // because it is the same kind of fact, and shown only when it was
                  // named: an untiered bead is the ordinary case for everything that
                  // predates this, and a pill saying "unrated" on most of the tracker
                  // is a pill nobody reads.
                  b.complexity ? `<span class="pill">${esc(b.complexity)} complexity</span>` : ''
                }
              </div>
              ${fieldsHtml(b, md)}
              ${
                b.rationale
                  ? `<div class="prop-why"><span class="prop-label">Why</span><div class="md">${md(b.rationale)}</div></div>`
                  : ''
              }
            </div>`
            }
            ${
              long
                ? `<button class="prop-more" data-act="prop-more" data-key="${esc(q.key)}" data-idx="${n}"
                    aria-expanded="${!collapsed}">${collapsed ? 'Show the rest' : 'Show less'}</button>`
                : ''
            }
          </div>
          <div class="prop-choice">
            <button class="prop-btn yes" data-act="pick" data-key="${esc(q.key)}" data-idx="${n}" data-pick="yes"
              aria-label="Approve bead ${n}" aria-pressed="${choice === 'yes'}">✓</button>
            <button class="prop-btn edit${editing ? ' on' : ''}" data-act="prop-edit" data-key="${esc(q.key)}" data-idx="${n}"
              aria-label="Adjust bead ${n}" aria-pressed="${editing}">✎</button>
            <button class="prop-btn no" data-act="pick" data-key="${esc(q.key)}" data-idx="${n}" data-pick="no"
              aria-label="Decline bead ${n}" aria-pressed="${choice === 'no'}">✕</button>
          </div>
        </div>`;
      })
      .join('');

    return `<div class="proposal" data-key="${esc(q.key)}">
      <div class="section-label">${beads.length} bead${beads.length === 1 ? '' : 's'} proposed <span>nothing is created until you say so</span></div>
      ${rows}
    </div>`;
  }

  /* -------------------------------------------------------- the bulk answer */

  /** What a bulk button will do, said as a count, armed or not. */
  function bulkLabel(key, beads, side, armed) {
    const total = beads.length;
    const n = side === 'yes' ? keepIndices(key, beads).length : 0;
    const what = n === 0 ? 'create nothing' : n === total ? `create all ${total}` : `create ${n} of ${total}`;
    if (armed) return `Tap again · ${what}`;
    if (side === 'no') return total === 1 ? 'Decline it' : `Decline all ${total}`;
    if (n === total) return total === 1 ? 'Approve it' : `Approve all ${total}`;
    return `Approve ${n} of ${total}`;
  }

  /**
   * The two bulk controls.
   *
   * There used to be three buttons at the foot of a proposal: Approve all and Decline
   * all, which only *marked* every row, and a primary underneath that did the filing.
   * Two of the three were a way of setting up the third, which is a lot of screen for
   * one decision. Now the two are the decision: each arms on the first tap and files on
   * the second, and the mount's own arm token is the same mechanism its other two-tap
   * answers use.
   *
   * What each one does, and why they are not symmetrical:
   *
   * - **Approve** files everything you have not explicitly declined. That is what keeps
   *   "2 of 3" reachable with the third button gone — pick ✕ on the one you don't want,
   *   then approve — and it is why undecided rows are counted rather than folded into
   *   the declines.
   * - **Decline** files nothing at all, whatever the rows say. It is the full stop, and
   *   a full stop that quietly created two beads would be the worst button in the app.
   *
   * Both name their count before the second tap: the exact number this tap will create
   * is the one fact the old primary carried that had to survive the move.
   */
  function bulkHtml(q, armedToken) {
    const beads = q.proposal?.beads || [];
    if (!beads.length) return '';
    const undecided = undecidedCount(q.key, beads);
    const canApprove = keepIndices(q.key, beads).length > 0;
    return `<div class="prop-bulk">
      <span class="prop-count">${undecided ? `${undecided} undecided` : ''}</span>
      <button class="top-btn bulk approve${armedToken === `${q.key}|prop-yes` ? ' confirm' : ''}"
        data-act="prop-bulk" data-key="${esc(q.key)}" data-pick="yes" ${canApprove ? '' : 'disabled'}
        >${bulkLabel(q.key, beads, 'yes', armedToken === `${q.key}|prop-yes`)}</button>
      <button class="top-btn bulk decline${armedToken === `${q.key}|prop-no` ? ' confirm' : ''}"
        data-act="prop-bulk" data-key="${esc(q.key)}" data-pick="no"
        >${bulkLabel(q.key, beads, 'no', armedToken === `${q.key}|prop-no`)}</button>
    </div>`;
  }

  /**
   * The sentence the answer is recorded as, and the payload beside it.
   *
   * One shape for all three mounts, because the server reads one shape: `/api/respond`
   * takes `create` (1-based rows) and `edits` (row → patch) beside the prose, and the
   * prose is what ends up on the thread for a person to read later. The monitor used to
   * write its own near-identical sentence and send no edits at all, which is how a
   * proposal adjusted in the inbox and filed from the Advocates page filed the agent's
   * original words.
   *
   * Only the rows being created carry their edits: a bead you adjusted and then declined
   * is a bead nobody filed, and sending the rewrite for it would put your words in the
   * record of something that does not exist.
   */
  function answerFor(q, side) {
    const beads = q.proposal?.beads || [];
    const approved = side === 'yes' ? keepIndices(q.key, beads) : [];
    const patches = {};
    for (const n of approved) {
      const patch = editsFor(q.key).get(n);
      if (patch && Object.keys(patch).length) patches[n] = patch;
    }
    const adjusted = Object.keys(patches).length;
    const declined = beads.length - approved.length;
    const text = approved.length
      ? `CREATE: ${approved.join(',')} — filing ${approved.length} of ${beads.length} proposed bead${
          beads.length === 1 ? '' : 's'
        }${declined ? `, declining ${declined}` : ''}${adjusted ? `, ${adjusted} adjusted` : ''}.`
      : `Not now — none of the ${beads.length} proposed beads.`;
    return { text, create: approved.length ? approved : null, edits: adjusted ? patches : null };
  }

  /* ---------------------------------------------------------- in-place paint */

  /**
   * Repaint one proposal in place: row states, the undecided count and the two bulk
   * buttons. Deliberately not a re-render — that rebuilds every card in the list, and
   * this runs on every tap.
   *
   * Everything is found **by key**, from the mount's root, rather than by walking up to
   * "the card this is in". A mount is free to put the bulk controls wherever it has room —
   * the inbox puts them in the card's top bar, outside `.proposal` and above the rows; the
   * other two put them underneath — and the three wrap the block in three different
   * things, one of which is nothing at all. Keying it is what keeps the count and the
   * buttons in step with the ✓/✕ that moved them without this file knowing any of that.
   */
  function paint(root, key, beads, armedToken) {
    if (!root || !beads.length) return;
    const sel = CSS.escape(key);
    // Found by key, never by "the card this is in" — the three mounts wrap these in three
    // different things and one of them wraps them in nothing. The inbox has
    // `.card[data-key]`, /monitor has `.mon-proposal[data-key]`, and the Mirror has a
    // plain `.mir-block` with no key on it at all. An earlier version of this took the
    // container and fell back to the whole root when it found none, which is correct for
    // exactly as long as one proposal is on screen: /monitor draws one per advocate, so
    // the fallback repainted the *first* proposal on the page whichever one you tapped.
    const block = root.querySelector(`.proposal[data-key="${sel}"]`);
    if (!block) return;
    const thePicks = picksFor(key);

    for (const row of block.querySelectorAll('.prop-row')) {
      const n = Number(row.dataset.idx);
      const choice = thePicks.get(n) || '';
      row.classList.toggle('pick-yes', choice === 'yes');
      row.classList.toggle('pick-no', choice === 'no');
      for (const btn of row.querySelectorAll('.prop-btn')) {
        btn.setAttribute('aria-pressed', String(btn.dataset.pick === choice));
      }
    }

    // The bulk pair is keyed on every button, which is what lets it live anywhere the
    // mount likes — the inbox puts it in the card's *top bar*, above the rows and outside
    // `.proposal`; the other two put it under them. So it is found by key across the
    // whole root and the undecided count is taken from the row each button is actually
    // in, rather than from a container this file would have to guess at.
    const undecided = undecidedCount(key, beads);
    const bulk = [...root.querySelectorAll(`.prop-bulk .bulk[data-key="${sel}"]`)];
    for (const row of new Set(bulk.map((b) => b.closest('.prop-bulk')))) {
      const count = row?.querySelector('.prop-count');
      if (count) count.textContent = undecided ? `${undecided} undecided` : '';
    }
    for (const btn of bulk) {
      const side = btn.dataset.pick;
      const armed = armedToken === `${key}|prop-${side}`;
      btn.textContent = bulkLabel(key, beads, side, armed);
      btn.classList.toggle('confirm', armed);
      // Only the approve side can run out of things to do: decline is always available,
      // because "create nothing" is always an answer.
      if (side === 'yes') btn.disabled = keepIndices(key, beads).length === 0;
    }
  }

  /**
   * The heading over an open editor, repainted in place as you type.
   *
   * The row keeps its title above the fields, and while you are rewriting that title the
   * two disagree — so the heading has to follow. In place rather than through a
   * re-render, for the obvious reason: a re-render on every keystroke would take the
   * field out from under the caret, which is the one thing this whole editor must never
   * do.
   *
   * The **adjusted** flag matters more than the heading. It appears the moment a field
   * differs and goes again when it matches, so the word is a fact about the row rather
   * than a memory of having once tapped ✎.
   */
  function paintAdjusted(root, key, n, original) {
    const row = root?.querySelector(`.prop-row[data-key="${CSS.escape(key)}"][data-idx="${n}"]`);
    if (!row || !original) return;

    const b = beadAt(key, original, n);
    const title = row.querySelector('.prop-title');
    if (title && title.textContent !== b.title) title.textContent = b.title;

    const head = row.querySelector('.prop-head');
    const flag = head?.querySelector('.pill.adjusted');
    if (isAdjusted(key, n) && !flag && head) {
      const pill = document.createElement('span');
      pill.className = 'pill adjusted';
      pill.textContent = 'adjusted';
      head.appendChild(pill);
    } else if (!isAdjusted(key, n) && flag) {
      flag.remove();
    }
  }

  /**
   * One field of one adjusted bead, into the `edits` map.
   *
   * A value equal to what the agent proposed is *removed* rather than stored, so typing
   * a word and deleting it again leaves the row un-adjusted — the "adjusted" flag has to
   * mean something, and a row that carries it because of a keystroke that was undone is
   * a row that lies.
   */
  function recordEdit(el, original) {
    const key = el.dataset.key;
    const n = Number(el.dataset.idx);
    const f = el.dataset.field;
    if (!original) return;

    const value = f === 'priority' ? Number(el.value) : el.value;
    const patch = editsFor(key).get(n) || {};
    if (value === original[f] || (typeof value === 'string' && value.trim() === String(original[f] ?? '').trim())) {
      delete patch[f];
    } else {
      patch[f] = value;
    }
    if (Object.keys(patch).length) editsFor(key).set(n, patch);
    else editsFor(key).delete(n);
  }

  /* ------------------------------------------------------------------ mount */

  /** Markdown if the page got the vendored parsers, plain text if it didn't. */
  const defaultMarkdown = (text) => {
    const src = String(text || '');
    if (!src.trim()) return '';
    if (!window.marked || !window.DOMPurify) return `<pre class="mir-plain">${esc(src)}</pre>`;
    // `breaks: false` because this is prose out of bd, which stores its fields
    // hard-wrapped at ~78 columns: forcing those wraps gives a staircase, not a
    // paragraph. A mount whose renderer knows better passes its own.
    return window.DOMPurify.sanitize(window.marked.parse(src, { breaks: false, gfm: true }));
  };

  /**
   * Wire one screen to this card.
   *
   * Six functions, and every one of them is something the mount already had:
   *
   * - `root` — the element its cards live in, for the two in-place painters.
   * - `markdown(text)` — its own renderer, so a mount that rewrites local image and
   *   file links (app.js does) keeps doing it. Defaults to marked + DOMPurify.
   * - `byKey(key)` — the question, from wherever that mount keeps its list.
   * - `armed()` / `arm(token, repaint, key)` / `disarm()` — its existing two-tap
   *   mechanism. This file deliberately does not own one: `state.armed` in app.js is
   *   shared with merge, ship and a dozen option taps, and a second arm token living
   *   here would let two different buttons be armed at once. `arm` records the token and
   *   sets the timeout that disarms it; the `repaint` it is handed is what that timeout
   *   must call so the buttons stop saying "Tap again", and the `key` beside it is for a
   *   mount whose own painter is the one that timer has to go through by name. It does
   *   not repaint itself — this file does that once, immediately after.
   * - `gate()` — optional, and asked before every in-place repaint: true means the mount
   *   is holding its screen still and this card must not touch the DOM at all.
   * - `rerender()` — a full repaint, for the one act that changes a row's shape
   *   (opening the adjust editor).
   * - `submit(key, q, answer, restore)` — the network call, which differs per mount:
   *   the inbox routes it through its own in-flight queue, the others post directly.
   *
   * Returns the card pieces bound to that mount plus `onClick`/`onInput`, which the
   * mount calls from the delegation it already has rather than this file adding
   * listeners of its own — three mounts on one page each adding a document listener is
   * how one tap becomes three answers.
   */
  function bind(host) {
    const md = host.markdown || defaultMarkdown;
    const root = () => (typeof host.root === 'function' ? host.root() : host.root);

    /**
     * `gate` is a mount saying "not now" — public/app.js passes its edit-mode freeze,
     * which holds every in-place painter on that page while the screen is being
     * rearranged (bc-p49x.5). It is asked *first*, before any DOM is read, because a
     * frozen screen must cost nothing rather than cost a querySelector.
     */
    const repaint = (key) => {
      if (host.gate?.()) return;
      const q = host.byKey(key);
      paint(root(), key, q?.proposal?.beads || [], host.armed?.() ?? null);
    };

    return {
      rowsHtml: (q) => rowsHtml(q, md),
      bulkHtml: (q) => bulkHtml(q, host.armed?.() ?? null),
      repaint,

      /**
       * Every tap the card can produce, in one place.
       *
       * Returns true when it handled the event, so a mount's delegation can fall
       * through to its own acts on false.
       */
      onClick(ev) {
        const btn = ev.target.closest?.('[data-act]');
        if (!btn) return false;
        const act = btn.dataset.act;
        const key = btn.dataset.key;
        if (!key) return false;

        // Unfolds one row, by touching that row only. Emphatically not a re-render, for
        // the same reason `paint` exists: rebuilding the card under a decision you are
        // halfway through making loses the decision.
        if (act === 'prop-more') {
          // A proposal row folds its `.prop-body`; a delivery folds its `.pr-summary`
          // and has no row around it. Same button, same state, whichever it found.
          const fold = btn.closest('.prop-row') || btn.previousElementSibling;
          const token = `${key}|${btn.dataset.idx}`;
          const open = !unfolded.has(token);
          if (open) unfolded.add(token);
          else unfolded.delete(token);
          fold?.classList.toggle('is-collapsed', !open);
          btn.setAttribute('aria-expanded', String(open));
          btn.textContent = open ? 'Show less' : 'Show the rest';
          ev.preventDefault();
          return true;
        }

        if (act === 'pick') {
          const n = Number(btn.dataset.idx);
          const p = picksFor(key);
          // Tapping the choice you already made clears it — undecided is a real state,
          // and there has to be a way back to it.
          if (p.get(n) === btn.dataset.pick) p.delete(n);
          else p.set(n, btn.dataset.pick);
          host.disarm?.();
          repaint(key);
          ev.preventDefault();
          return true;
        }

        /**
         * Open or close the editor on one row.
         *
         * Opening it also approves the row, and that is not a shortcut — adjusting a
         * bead is the strongest possible statement that you want it. Making you rewrite
         * the title and *then* find the ✓ is how a considered edit turns into an
         * accidental decline.
         */
        if (act === 'prop-edit') {
          const n = Number(btn.dataset.idx);
          const token = `${key}|${n}`;
          if (adjusting.has(token)) adjusting.delete(token);
          else {
            adjusting.add(token);
            picksFor(key).set(n, 'yes');
          }
          host.disarm?.();
          host.rerender?.();
          ev.preventDefault();
          return true;
        }

        /**
         * The bulk answer: approve what you have not declined, or decline the lot.
         *
         * Both sides come through here because both *are* the same answer with a
         * different set — which is what let the third button go. See `bulkHtml` for why
         * they are not symmetrical.
         */
        if (act === 'prop-bulk') {
          const q = host.byKey(key);
          const beads = q?.proposal?.beads || [];
          if (!beads.length) return true;
          const side = btn.dataset.pick;
          const token = `${key}|prop-${side}`;
          if (host.armed?.() !== token) {
            // The same two taps every other answer needs. This one creates beads. The
            // key goes along with the repaint because a mount may already own a gated
            // painter it would rather the timer called by name — app.js does, and
            // test/editfreeze.mjs fails the repo for an arm timer that reaches anything
            // else.
            host.arm?.(token, () => repaint(key), key);
            repaint(key);
            ev.preventDefault();
            return true;
          }
          host.disarm?.();
          const answer = answerFor(q, side);
          const snap = snapshot(key);
          clear(key);
          host.submit(key, q, answer, () => restore(key, snap));
          ev.preventDefault();
          return true;
        }

        return false;
      },

      /** A keystroke in the adjust editor. Same contract: true when it was ours. */
      onInput(ev) {
        const el = ev.target;
        if (!el?.matches?.('[data-role="edit-field"]')) return false;
        const key = el.dataset.key;
        const n = Number(el.dataset.idx);
        const original = host.byKey(key)?.proposal?.beads?.[n - 1];
        if (!original) return false;
        recordEdit(el, original);
        paintAdjusted(root(), key, n, original);
        return true;
      },
    };
  }

  window.beadcause = window.beadcause || {};
  /*
    Three things, and everything else stays inside.

    The picks, the edits, `beadAt`, `answerFor`, `snapshot`/`restore`/`clear` and the two
    counters were all exported at first, on the reasoning that a fourth mount might want
    them. None of the three that exist does — `bind` hands each of them everything it
    needs — and an export with no caller is API that cannot be found wrong, which is the
    same argument this bead applied to a served count nobody drew. A mount that needs one
    can export it then, with a caller to check it against.

    One of them was worse than merely unused. `isAnswering(key)` — "is this proposal
    half-answered, so hold the repaint" — reads plausible and would have been a mistake:
    `isAnswering` in public/app.js already reasons about `[data-role="edit-field"]` and
    deliberately *excludes* it, because an adjust row's `<select>` always holds a value
    and counting it would stop the poll repainting the list for as long as a row was
    open. A second opinion on that question, living here, is how the two come to
    disagree.
  */
  window.beadcause.proposal = {
    bind,
    bulkLabel,
    /**
     * Is this fold open? The set is here rather than on a mount because the `prop-more`
     * button serves two things that both fold: a proposal row (`${key}|${n}`) and a
     * delivery card's summary (`${key}|pr`), which app.js draws with the same button and
     * the same class. One set, one handler, whichever it found — splitting them would
     * mean two answers to "is this open" for one button.
     */
    isUnfolded: (key, n) => unfolded.has(`${key}|${n}`),
  };
})();
