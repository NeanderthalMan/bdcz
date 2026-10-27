/* The PRs chip's two subtabs, and the second of them: the merge queue (bc-gjlix).
 *
 * **Why this exists.** On 2026-09-27 the queue held 75 pull requests for about three days
 * behind a red `main`, and nothing on any screen said so. The one way to see it was
 * `grep "[merge-queue] beadcause" ~/Library/Logs/beadcause.log`. The PRs board already
 * listed every open pull request, but a list of open PRs cannot say that they are all
 * waiting on one thing, or in which order they will go.
 *
 * So the PRs chip has two subtabs:
 *
 *   - **Open PRs** is the board public/prs.js has always drawn, unchanged. It draws into
 *     `#prs-open` now instead of `#prs`, and asks `up('open')` below where it used to ask
 *     only whether its chip was up. A board behind the other subtab is not being looked
 *     at, and every wake it acts on costs a `gh` sweep per repo.
 *   - **Merge queue** is this file. It draws every merge-bead in the order the queue tries
 *     them. There is no priority: `sweepMergeQueue` sorts by bead id, and `position` on
 *     each entry (lib/queues.js) is that order. Each repo has a header with what the queue
 *     last learned about its base, because a red base is what holds everything behind it.
 *     The header also names which source answered, GitHub or a local `b7e-gate` run.
 *
 * **The data is `GET /api/queues`, and this asks for nothing new.** The entries are
 * lib/queues.js's `mergeEntry`, the same payload public/releases.js draws its merge cards
 * from. `bases` is the reading the queue already takes each tick, kept in memory by
 * `checkBase` in lib/server.js (`baseReadings`). Reading this tab costs one board sweep,
 * which is shared with /api/prs through the daemon's 25-second cache.
 *
 * **The subtab row is a segmented switch (`.chip-row.scopes`), not another row of chips.**
 * The chip row above it moves between modes of the page, and bc-stci is about two rows
 * that mean different things being drawn alike. This one picks between two lists of the
 * same thing, the same kind of choice as the inbox's scope switch, so it borrows that look.
 *
 * Which subtab is up is remembered per device in `localStorage`. The address is left
 * alone: public/montabs.js owns the `?tab=` slot of the hash. A second key in that slot
 * would be a second writer racing the first, and arriving on the board a notification
 * links to already works.
 */
(() => {
  'use strict';

  const pane = document.getElementById('prs');
  const tabsEl = document.getElementById('prs-tabs');
  const out = document.getElementById('prs-queue');
  if (!pane || !tabsEl || !out) return;

  const token = localStorage.getItem('beadcause.token') || '';
  const panes = (window.beadcause && window.beadcause.panes) || null;
  const inShell = Boolean(panes && typeof panes.has === 'function' && panes.has('advocates'));

  const KEY = 'beadcause.prs.sub';
  const chips = [...tabsEl.querySelectorAll('[data-sub]')];
  const sectionOf = new Map(chips.map((c) => [c.dataset.sub, document.getElementById(c.dataset.section)]));
  const known = (which) => sectionOf.has(which);

  let active = null;
  const subs = [];

  /** Whether the PRs chip itself is the one being looked at, per public/montabs.js. */
  const chipUp = () => window.beadcause?.monTabs?.up?.('prs') ?? !pane.hidden;
  /** Whether a subtab is on screen: its chip is up, and the PRs chip is too. */
  const up = (which) => chipUp() && active === which;

  function stored() {
    try {
      return localStorage.getItem(KEY) || '';
    } catch {
      return '';
    }
  }

  function show(which) {
    if (!known(which)) which = chips[0]?.dataset.sub || '';
    if (which === active) return;
    const prev = active;
    active = which;
    try {
      localStorage.setItem(KEY, which);
    } catch {
      /* Private mode, or a quota. The subtab still moves. */
    }
    for (const c of chips) {
      const on = c.dataset.sub === which;
      c.setAttribute('aria-pressed', String(on));
      const section = sectionOf.get(c.dataset.sub);
      if (section) section.hidden = !on;
    }
    // Each subscriber is contained, for the reason public/montabs.js gives for its own:
    // one section throwing must not leave the other believing it is still on screen.
    for (const fn of subs) {
      try {
        fn(which, prev);
      } catch (err) {
        setTimeout(() => {
          throw err;
        });
      }
    }
  }

  tabsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sub]');
    if (b) show(b.dataset.sub);
  });

  // Up before any subscriber registers, so each one is called with the answer straight
  // away and public/prs.js, which loads after this file, needs no first-paint special case.
  show(known(stored()) ? stored() : chips[0]?.dataset.sub || '');

  window.beadcause = window.beadcause || {};
  window.beadcause.prsTabs = {
    show,
    active: () => active,
    up,
    /** `fn(which, prev)` on every change. It is also called once, straight away. */
    onChange(fn) {
      if (typeof fn !== 'function') return;
      subs.push(fn);
      fn(active, null);
    },
  };

  /* ----------------------------------------------------------- the merge queue */

  const SUB = 'queue';
  const card = window.beadcause.prCard || {};
  const esc =
    card.esc ||
    ((s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]));
  const ago = card.ago || ((iso) => String(iso || ''));
  const inSpace = (r) => window.beadcause?.space?.matches?.(r.workspace) ?? true;

  /* The events that can have moved an entry: the same list the PR board and the releases
     pane wake on, plus `red-base`, which is the one event about why the queue is still. */
  const EVENTS = [...(window.beadcause?.stream?.BOARD_EVENTS || ['merged', 'changes', 'pr-declined', 'deploy', 'advocate']), 'red-base'];

  const state = { data: null, error: null, mounted: false };

  /** The reading for a repo card, matched on its key, or on its workspace when that has
   *  only one reading. */
  function baseFor(repo, bases) {
    const exact = bases.find((b) => b.workspace === repo.workspace && b.key === repo.key && b.base === (repo.base || 'main'));
    if (exact) return exact;
    const mine = bases.filter((b) => b.workspace === repo.workspace && b.key === repo.key);
    if (mine.length === 1) return mine[0];
    const ws = bases.filter((b) => b.workspace === repo.workspace);
    return ws.length === 1 && repo.key === repo.workspace ? ws[0] : null;
  }

  function baseHtml(reading, repo) {
    if (!reading) {
      return `<p class="mq-base unknown">The queue has not read <code>${esc(repo.base || 'main')}</code> since the daemon started.</p>`;
    }
    const src = reading.source === 'local-gate' ? 'Local gate · ' : reading.source === 'github' ? 'GitHub · ' : '';
    return `<p class="mq-base ${esc(reading.state)}" title="${esc(reading.why || '')}">${esc(reading.summary)}<span class="mq-base-at">${esc(
      src
    )}read ${esc(ago(reading.at))}</span></p>`;
  }

  function entryHtml(e) {
    const title = e.title || e.branch || 'a branch';
    const pr = e.number
      ? e.url
        ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">#${esc(e.number)}</a>`
        : `#${esc(e.number)}`
      : '';
    const pos = e.position ? `<span class="mq-pos" title="Tried in this order: by bead id, there is no priority">${esc(e.position)}</span>` : '';
    // A held entry's sentence is the base line's, already drawn once above the list.
    const reason = e.refused && e.stage !== 'held' ? `<p class="mq-why">${esc(e.refused)}</p>` : '';
    const tries = e.attempts ? ` · ${esc(e.attempts)} tried, ${esc(e.attemptsLeft)} left` : '';
    const downs = e.downmerges ? ` · downmerged ${esc(e.downmerges)}×` : '';
    return `<li class="mq-row st-${esc(e.stage)}">
      ${pos}
      <div class="mq-main">
        <span class="mq-title">${pr} ${esc(title)}</span>
        <span class="mq-sub"><span class="pill pr-stage st-${esc(e.stage)}" title="${esc(e.note)}">${esc(e.stageLabel || e.stage)}</span>
          <code>${esc(e.mergeBead)}</code>${e.bead ? ` for <code>${esc(e.bead)}</code>` : ''}${tries}${downs}${
            e.at ? ` · ${esc(ago(e.at))}` : ''
          }</span>
        ${reason}
      </div>
    </li>`;
  }

  const byPosition = (a, b) => (a.position || 1e9) - (b.position || 1e9) || String(a.mergeBead).localeCompare(String(b.mergeBead));

  function repoHtml(repo, bases) {
    const entries = [...repo.merge].sort(byPosition);
    const name = repo.repo || repo.where || repo.workspace;
    const err = repo.error ? `<p class="mq-why">${esc(repo.error)}</p>` : '';
    return `<article class="card work-card mq-repo">
      <h3 class="work-head mq-head"><span class="work-name">${esc(name)}</span><span class="work-count${entries.length ? ' on' : ''}">${esc(
        entries.length
      )} queued</span></h3>
      ${baseHtml(baseFor(repo, bases), repo)}
      ${err}
      ${entries.length ? `<ol class="mq-list">${entries.map(entryHtml).join('')}</ol>` : ''}
    </article>`;
  }

  function boardHtml() {
    const d = state.data;
    if (!d) {
      if (state.error) return `<div class="empty"><strong>Can't reach the server</strong>${esc(state.error)}</div>`;
      return '<div class="empty">Asking the merge queue…</div>';
    }
    const bases = d.bases || [];
    const stale = state.error
      ? `<p class="board-foot bad board-quiet">Showing the queue as of ${esc(ago(d.at))}: the last refresh did not answer.</p>`
      : '';
    const errors = (d.errors || []).length
      ? `<p class="board-foot bad">Could not read the queue in ${esc(d.errors.map((e) => e.workspace || e).join(', '))}. It may not be empty.</p>`
      : '';
    // A repo with nothing queued still gets a card when its base is red, because a red
    // base with nothing behind it yet is the next thing to hold whatever is delivered.
    const repos = (d.repos || []).filter(inSpace).filter((r) => r.merge.length || baseFor(r, bases)?.state === 'red');
    const orphans = (d.orphans || []).filter(inSpace).sort(byPosition);
    const orphanCard = orphans.length
      ? `<article class="card work-card mq-repo"><h3 class="work-head mq-head"><span class="work-name">Not on this board</span><span class="work-count on">${esc(
          orphans.length
        )}</span></h3><p class="mq-base unknown">Merge-beads whose repo this board does not list: another account, a <code>gh</code> that did not answer, or a checkout not on this Mac.</p><ol class="mq-list">${orphans
          .map(entryHtml)
          .join('')}</ol></article>`
      : '';
    const body = repos.map((r) => repoHtml(r, bases)).join('') + orphanCard;
    const foot =
      '<p class="board-foot board-quiet">Entries are tried in bead-id order, a couple per tick. There is no priority.</p>';
    if (!body) return `${stale}${errors}<div class="empty"><strong>The merge queue is empty</strong>Nothing delivered is waiting to merge.</div>`;
    return stale + errors + body + foot;
  }

  function render() {
    const was = out.scrollTop;
    out.innerHTML = boardHtml();
    out.scrollTop = was;
    const count = document.getElementById('prs-queue-count');
    if (count && state.data) {
      const n = state.data.counts?.merge || 0;
      count.textContent = n ? String(n) : '';
      count.hidden = !n;
    }
  }

  async function load({ refresh = false } = {}) {
    try {
      const res = await fetch(`/api/queues${refresh ? '?refresh=1' : ''}`, { headers: { 'x-beadcause-token': token } });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      state.data = await res.json();
      window.beadcause?.warm?.write?.('/api/queues', state.data);
      state.error = null;
    } catch (err) {
      state.error = err.message;
    }
    render();
    follow();
  }

  function warmBoot() {
    const hit = window.beadcause?.warm?.read?.('/api/queues');
    if (!Array.isArray(hit?.data?.repos)) return;
    state.data = hit.data;
    render();
  }

  function wake({ events, resync } = {}) {
    if (!up(SUB)) return;
    if (resync) return load({ refresh: true });
    if (!window.beadcause?.stream?.touched?.(events, EVENTS)) return;
    load();
  }
  window.beadcause?.monTabs?.onWake?.(wake);

  /* On the document only, as public/prs.js's own `follow`: in the shell the one poll is
     public/panestage.js's and reaches `wake` through public/montabs.js. */
  let stream = null;
  function follow() {
    if (inShell || !window.beadcause?.stream) return;
    if (stream) return stream.start();
    stream = window.beadcause.stream.follow({
      api: async (path, opts = {}) => {
        const res = await fetch(path, { ...opts, headers: { 'x-beadcause-token': token, ...(opts.headers || {}) } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      },
      want: 'presence',
      cold: true,
      ready: () => up(SUB),
      onWake: wake,
    });
    stream.start();
  }

  document.getElementById('refresh')?.addEventListener('click', () => {
    if (up(SUB)) load({ refresh: true });
  });
  window.beadcause?.space?.onChange?.(() => {
    if (state.data) render();
  });

  function arrive() {
    if (!up(SUB)) return;
    if (!state.mounted) {
      state.mounted = true;
      warmBoot();
    }
    load();
  }

  if (!token) {
    out.innerHTML = '<div class="empty"><strong>This device is not paired</strong>Open the inbox first.</div>';
    return;
  }
  // Either switch can bring this list on screen: the PRs chip, or this subtab.
  window.beadcause.prsTabs.onChange(arrive);
  window.beadcause?.monTabs?.onChange?.(arrive);
})();
