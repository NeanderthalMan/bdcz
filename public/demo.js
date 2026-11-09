/* DemoMode — the list of green candidates, and a tap deploys one. bc-sj8k.2.
 *
 * Adam reviews by using a thing, not by reading its diff. So this page is one card per open
 * pull request of this app — what it changes, which beads it came from, whether its gates
 * passed, how old it is, and whether it is the one on green — and tapping a card is the
 * whole of trying it: `/api/demo/green` prepares the candidate and stands it up beside the
 * live build, and the page then follows the router's `/__demo/green?id=`, which sets this
 * device's cookie and lands it on the candidate's own app.
 *
 * The way back is the router's `/__demo/blue` rather than anything here, because a
 * candidate branched before DemoMode has never heard of this page. It lands on
 * `/demo?from=<id>`, and `from` is what puts the candidate you were just using first.
 *
 * Only this app's own pull requests are listed, because green runs a beadcause backend —
 * see lib/demomode.js.
 *
 * Down the right of each card are the three verdicts (bc-sj8k.3), beside the card rather
 * than inside it because the card itself is the tap that tries it. **Approve** is the
 * merge queue and then the deploy, and it arms: the first tap writes what the second will do
 * into the button, the way the board's Merge does. **Decline** and **Comment** open a box
 * under the card, and nothing is sent until something is typed and Send is pressed — a
 * decline's reason goes on the bead, a comment goes on the bead and sends an agent to
 * answer it. None of the three is one tap.
 */
(() => {
  'use strict';

  const token = (() => {
    try {
      return localStorage.getItem('beadcause.token') || '';
    } catch {
      return '';
    }
  })();

  const out = document.getElementById('demo');
  const where = document.getElementById('demo-where');
  const refreshBtn = document.getElementById('demo-refresh');
  const from = new URLSearchParams(location.search).get('from') || '';
  // `?open=<number>` lands with that card already expanded — a link to one candidate's
  // evidence rather than to the list it is in (bc-sj8k.4). Honoured once, on the first load.
  let openOnLoad = Number(new URLSearchParams(location.search).get('open')) || 0;

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // `open` and `history` are bc-sj8k.4's: which cards are expanded, and what each one's
  // `/api/demo/history` said — `'loading'`, `{ error }`, or the answer. Kept here rather than
  // in the DOM because `render` redraws the whole list.
  // `armed`, `panel`, `acting`, `said` and `drafts` are bc-sj8k.3's: which Approve is waiting
  // for its second tap, which card has its Decline or Comment box open (`{ number, kind }`),
  // which verdict is in flight, what the last one said per card (`{ ok, text }`), and what has
  // been typed so far — kept here so a redraw of the list never eats a half-written reason.
  const state = {
    data: null,
    env: 'blue',
    candidate: '',
    loading: false,
    busy: null,
    refused: {},
    open: new Set(),
    history: {},
    armed: null,
    panel: null,
    acting: null,
    said: {},
    drafts: {},
  };
  /** How long an armed Approve waits for its second tap, as the board's Merge does. */
  const ARM_MS = 5000;
  let armTimer = null;

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;

  /** A date as something a person reads, the way public/skills.js says it. */
  function ago(iso) {
    if (!iso) return '';
    const then = Date.parse(iso);
    if (!Number.isFinite(then)) return '';
    const mins = Math.round((Date.now() - then) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days <= 7) return `${days}d ago`;
    return new Date(then).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  /** What the checks said about the head, as a chip. `none` is not `pass` — nothing ran. */
  const GATE = {
    pass: { label: 'gates passed', cls: 'is-pass' },
    fail: { label: 'gates failing', cls: 'is-fail' },
    pending: { label: 'gates running', cls: 'is-pending' },
    none: { label: 'no gates ran', cls: 'is-none' },
  };

  const beadHref = (b) => `/graph?ws=beadcause&id=${encodeURIComponent(b.id)}`;

  /** The title without the `bc-x.y: ` a delivery puts in front — the bead chip says that. */
  const said = (r) => {
    const m = /^([a-z0-9]+-[a-z0-9.]+):\s+(.*)$/.exec(r.title);
    return m && r.beads.some((b) => b.id === m[1]) ? m[2] : r.title;
  };

  /** The banner for a device that is on green right now — and the way off it. */
  function renderWhere() {
    if (state.env !== 'green') {
      where.innerHTML = '';
      return;
    }
    where.innerHTML = `<div class="demo-on">
      <span>This device is on green${state.candidate ? ` — <code>${esc(state.candidate)}</code>` : ''}.</span>
      <a class="demo-home" href="/__demo/blue">Back to blue</a>
    </div>`;
  }

  function card(r) {
    const gate = GATE[r.gate] || GATE.none;
    const failed = r.gate === 'fail' && r.failed.length ? ` · ${esc(r.failed.join(', '))}` : '';
    const chips = [
      r.onGreen ? '<span class="demo-chip is-green">on green</span>' : '',
      r.candidate?.id && r.candidate.id === from ? '<span class="demo-chip is-back">just tried</span>' : '',
      `<span class="demo-chip ${gate.cls}">${gate.label}${failed}</span>`,
      r.draft ? '<span class="demo-chip is-none">draft</span>' : '',
      r.candidate?.current && r.candidate.behind ? '<span class="demo-chip is-pending">behind main</span>' : '',
    ].join('');
    const beads = r.beads.length
      ? r.beads.map((b) => `<a class="pill id" href="${esc(beadHref(b))}" title="${esc(b.title)}">${esc(b.id)}</a>`).join('')
      : '<span class="demo-meta">no bead</span>';
    const size = `+${r.additions} −${r.deletions} · ${plural(r.files, 'file')}`;
    const refused = state.refused[r.number] || (r.candidate?.current && r.candidate.unservable) || '';
    const busy = state.busy === r.number;
    const action = !state.data?.router
      ? ''
      : busy
        ? '<span class="demo-go is-busy">Putting it on green…</span>'
        : r.onGreen
          ? '<span class="demo-go">Tap to go to it</span>'
          : refused
            ? '<span class="demo-go">Tap to try again</span>'
            : '<span class="demo-go">Tap to try it on green</span>';
    return `<div class="demo-card${r.onGreen ? ' is-green' : ''}${busy ? ' is-busy' : ''}" role="button" tabindex="0"
        data-number="${esc(r.number)}" aria-label="Try #${esc(r.number)} on green">
      <span class="demo-top">${chips}</span>
      <span class="demo-title">${esc(said(r))}</span>
      <span class="demo-beads">${beads}</span>
      <span class="demo-meta">#${esc(r.number)} · ${esc(size)} · updated ${esc(ago(r.updatedAt))} · opened ${esc(ago(r.createdAt))}
        · <a href="${esc(r.url)}" target="_blank" rel="noopener">diff ↗</a></span>
      ${refused ? `<span class="demo-refused">${esc(refused)}</span>` : ''}
      ${action}
    </div>`;
  }

  function render() {
    renderWhere();
    const d = state.data;
    if (!d) return;
    const notes = [];
    if (!d.router) {
      notes.push(`<p class="lede">No router is in front of this daemon, so there is no green to put a
        candidate on. The list is still what would be offered.</p>`);
    }
    if (d.unavailable) notes.push(`<p class="lede">${esc(d.unavailable)}</p>`);
    if (d.greenStarting) notes.push(`<p class="lede">Green is bringing up <code>${esc(d.greenStarting)}</code>.</p>`);
    if (!d.repo) {
      out.innerHTML = `${notes.join('')}<div class="empty"><strong>This app's own repo is not on the board.</strong>
        DemoMode lists its pull requests, so there is nothing to offer.</div>`;
      return;
    }
    if (!d.rows.length) {
      out.innerHTML = `${notes.join('')}<div class="empty"><strong>No open pull requests.</strong>
        Anything a session delivers shows up here, ready to try.</div>`;
      return;
    }
    out.innerHTML = `${notes.join('')}<div class="demo-list">${d.rows
      .map((r) => `<div class="demo-item"><div class="demo-row">${card(r)}${verdicts(r)}</div>${panel(r)}${saidLine(r)}${expander(r)}</div>`)
      .join('')}</div>`;
  }

  /* ---- Approve, Decline, Comment — bc-sj8k.3 ----------------------------------------- */

  /** Why Approve cannot be pressed at all yet, or '' — the server refuses the rest. */
  function approveBlocked(r) {
    if (r.draft) return 'A draft cannot merge';
    if (!r.candidate?.current) return 'Try it on green first';
    return '';
  }

  function verdicts(r) {
    const acting = state.acting === r.number;
    const armed = state.armed === r.number;
    const blocked = approveBlocked(r);
    const open = state.panel?.number === r.number ? state.panel.kind : '';
    const dis = (extra) => (acting || extra ? ' disabled' : '');
    return `<div class="demo-verdicts" data-number="${esc(r.number)}">
      <button type="button" class="board-btn merge${armed ? ' armed' : ''}" data-verdict="approve"${dis(blocked)}
        title="${esc(blocked || 'Merges it through the merge queue, then the deploy makes it live')}">${
          acting && state.actingKind === 'approve' ? 'Approving…' : armed ? 'Tap again — merge & ship' : 'Approve'
        }</button>
      <button type="button" class="board-btn${open === 'decline' ? ' armed' : ''}" data-verdict="decline"${dis()}
        title="Close the pull request and say why on its bead">Decline</button>
      <button type="button" class="board-btn${open === 'comment' ? ' armed' : ''}" data-verdict="comment"${dis(!r.beads.length)}
        title="${esc(r.beads.length ? 'Comment on its bead — an agent answers' : 'No bead to comment on')}">Comment</button>
    </div>`;
  }

  /** The box a Decline or a Comment is typed into. Nothing is sent without its Send. */
  function panel(r) {
    const p = state.panel;
    if (!p || p.number !== r.number) return '';
    const decline = p.kind === 'decline';
    const key = `${p.kind}:${r.number}`;
    const beadPick =
      !decline && r.beads.length > 1
        ? `<select class="demo-bead-pick">${r.beads
            .map((b) => `<option value="${esc(b.id)}"${state.drafts[`bead:${r.number}`] === b.id ? ' selected' : ''}>${esc(b.id)}</option>`)
            .join('')}</select>`
        : '';
    const said = decline
      ? `Closes #${esc(r.number)} without merging${r.onGreen ? ', takes it off green' : ''}, and puts this on ${
          r.beads.length ? r.beads.map((b) => esc(b.id)).join(', ') : 'the pull request (it names no bead)'
        }.`
      : `Goes on ${r.beads.length === 1 ? esc(r.beads[0].id) : 'the bead you pick'}, and an agent is sent to answer it.`;
    return `<div class="demo-panel" data-number="${esc(r.number)}" data-kind="${esc(p.kind)}">
      <p class="demo-meta">${said}</p>
      ${beadPick}
      <textarea class="demo-text" rows="3" placeholder="${decline ? 'Why it is declined' : 'What you want changed, or asked'}">${esc(
        state.drafts[key] || ''
      )}</textarea>
      <div class="board-actions">
        <button type="button" class="board-btn${decline ? ' revoke' : ' merge'}" data-send="${esc(p.kind)}"${
          state.acting === r.number ? ' disabled' : ''
        }>${decline ? `Decline #${esc(r.number)}` : 'Send comment'}</button>
        <button type="button" class="board-btn link" data-cancel="1">Cancel</button>
      </div>
    </div>`;
  }

  function saidLine(r) {
    const s = state.said[r.number];
    if (!s) return '';
    return `<p class="${s.ok ? 'pr-said pr-ok' : 'demo-refused'} demo-said-line">${esc(s.text)}</p>`;
  }

  function disarm() {
    clearTimeout(armTimer);
    armTimer = null;
    state.armed = null;
  }

  async function post(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'x-beadcause-token': token, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const said = await res.json().catch(() => ({}));
    if (!res.ok && said.ok === undefined) said.error = said.error || `HTTP ${res.status}`;
    return { ok: res.ok && said.ok !== false && !said.error, said };
  }

  async function approve(number) {
    if (state.armed !== number) {
      disarm();
      state.armed = number;
      armTimer = setTimeout(() => {
        disarm();
        render();
      }, ARM_MS);
      render();
      return;
    }
    disarm();
    state.acting = number;
    state.actingKind = 'approve';
    delete state.said[number];
    render();
    try {
      const { ok, said } = await post(`/api/demo/approve?number=${encodeURIComponent(number)}`);
      state.said[number] = ok
        ? {
            ok: true,
            text: said.alreadyMerged
              ? `#${number} is already merged.`
              : `Approved on ${said.gatesOn || 'its gates'} — ${said.queued ? `on the merge queue as ${said.id}` : `already queued as ${said.id}`}. ` +
                'It merges, then deploys itself; this list drops it once it has landed.',
          }
        : { ok: false, text: said.error || 'refused' };
      const row = state.data?.rows.find((r) => r.number === number);
      if (!ok && said.behind && row?.candidate) row.candidate.behind = true;
    } catch (err) {
      state.said[number] = { ok: false, text: err.message };
    }
    state.acting = null;
    render();
  }

  async function send(number, kind) {
    const row = state.data?.rows.find((r) => r.number === number);
    const text = String(state.drafts[`${kind}:${number}`] || '').trim();
    if (!row) return;
    if (!text) {
      state.said[number] = { ok: false, text: kind === 'decline' ? 'Say why first — the reason goes on the bead.' : 'Write the comment first.' };
      render();
      return;
    }
    state.acting = number;
    state.actingKind = kind;
    delete state.said[number];
    render();
    try {
      if (kind === 'decline') {
        const { ok, said } = await post('/api/demo/decline', { number, reason: text });
        state.said[number] = ok
          ? { ok: true, text: `Declined — #${number} is closed${said.dropped ? ' and off green' : ''}${said.beads?.length ? `, and the reason is on ${said.beads.join(', ')}` : ''}.` }
          : { ok: false, text: said.error || 'refused' };
        if (ok) {
          delete state.drafts[`decline:${number}`];
          state.panel = null;
          state.acting = null;
          // Gone from the list: it is not an open pull request any more.
          await load(true);
          return;
        }
      } else {
        const bead = row.beads.length > 1 ? state.drafts[`bead:${number}`] || row.beads[0].id : row.beads[0]?.id;
        const { ok, said } = await post('/api/comment', { workspace: state.data.repo?.workspace || 'beadcause', id: bead, text });
        state.said[number] = ok
          ? { ok: true, text: `Commented on ${bead}${said.dispatched ? ' — an agent is answering it' : ''}.` }
          : { ok: false, text: said.error || 'refused' };
        if (ok) {
          delete state.drafts[`comment:${number}`];
          state.panel = null;
        }
      }
    } catch (err) {
      state.said[number] = { ok: false, text: err.message };
    }
    state.acting = null;
    render();
  }

  /* ---- The card, expanded — bc-sj8k.4 ----------------------------------------------
   *
   * Beneath each card rather than inside it, because the whole card is the tap that puts
   * it on green and a tap meant for a thread must never be that. A native <details>, so it
   * opens with no script of its own; the first open asks `/api/demo/history` and the
   * answer is kept, so reopening — or the list redrawing — never asks again until a
   * refresh. Every section says whether it is empty because nothing is there or because
   * it could not be read: lib/demomode.js's `demoHistory` keeps those apart and this draws
   * them apart. */

  const sessionHref = (ws, bead, commit) =>
    `/bead-session?ws=${encodeURIComponent(ws)}&id=${encodeURIComponent(bead)}&commit=${encodeURIComponent(commit)}`;

  const when = (iso) => (iso ? esc(ago(iso)) : 'at an unknown time');

  function expander(r) {
    const open = state.open.has(r.number);
    return `<details class="demo-history" data-number="${esc(r.number)}"${open ? ' open' : ''}>
      <summary>Everything behind #${esc(r.number)}</summary>
      ${open ? `<div class="demo-history-body">${historyBody(r.number)}</div>` : ''}
    </details>`;
  }

  function historyBody(number) {
    const h = state.history[number];
    if (!h || h === 'loading') return '<p class="demo-meta">Reading its history…</p>';
    if (h.error) return `<p class="demo-refused">Could not read its history: ${esc(h.error)}</p>`;
    return [prSection(h), gateSection(h), coverageSection(h), beadSections(h)].join('');
  }

  const section = (title, body) => `<section class="demo-sec"><h3>${esc(title)}</h3>${body}</section>`;

  function prSection(h) {
    const state_ = h.draft ? 'draft' : String(h.state || 'unknown').toLowerCase();
    const lines = [
      `<p class="demo-meta"><a href="${esc(h.url)}" target="_blank" rel="noopener">#${esc(h.number)} ↗</a> · ${esc(state_)}
        · <code>${esc(h.branch)}</code> → <code>${esc(h.base)}</code> at <code>${esc(h.head)}</code></p>`,
    ];
    if (h.candidate) {
      lines.push(
        `<p class="demo-meta">Candidate <code>${esc(h.candidate.id)}</code>${h.candidate.current ? '' : ' — for an older head'}${
          h.candidate.behind ? ' · behind its base' : ''
        } · prepared ${when(h.candidate.preparedAt)}</p>`
      );
    } else lines.push('<p class="demo-meta">Not prepared as a candidate yet.</p>');
    const c = h.checks;
    if (!c) lines.push('<p class="demo-meta">The board carries no checks for it.</p>');
    else if (!c.total) lines.push('<p class="demo-meta">CI: no checks ran on this head.</p>');
    else {
      const failed = c.failed.length
        ? ` — ${c.failed
            .map((name, i) => (c.failedUrls[i] ? `<a href="${esc(c.failedUrls[i])}" target="_blank" rel="noopener">${esc(name)}</a>` : esc(name)))
            .join(', ')}`
        : '';
      lines.push(
        `<p class="demo-meta">CI (npm test, sharded): ${c.passing} passing, ${c.failing} failing, ${c.pending} running of ${c.total}${failed}${
          c.at ? ` · last ${when(c.at)}` : ''
        }</p>`
      );
    }
    return section('Pull request', lines.join(''));
  }

  function gateSection(h) {
    const g = h.gates;
    // Said every time, because it is the gap a reader would otherwise fill in: the browser
    // checks write nothing down when they run, so their verdict exists only in the words of
    // whoever ran them — the Tests line a delivery puts on the pull request.
    const checks = `<p class="demo-meta">npm run checks keeps no record of a run; what it said is only in the
      <a href="${esc(h.url)}" target="_blank" rel="noopener">pull request's Tests line ↗</a>.</p>`;
    const titled = (body) => section('Local gate', body + checks);
    if (!g?.known) return titled(`<p class="demo-meta">npm test suites (b7e-gate) unknown: ${esc(g?.why || 'not read')}</p>`);
    if (!g.runs.length) return titled(`<p class="demo-meta">No b7e-gate run is filed under <code>${esc(g.slug)}</code>.</p>`);
    const rows = g.runs.map((run) => {
      const verdict = run.running ? `running, ${run.done ?? 0}/${run.total ?? '?'}` : `${esc(run.status)}, ${run.done ?? 0}/${run.total ?? '?'} suites`;
      const fails = run.failed.length ? ` — failed ${esc(run.failed.join(', '))}` : '';
      const on = run.onHead ? 'this head' : run.sha ? `an earlier commit <code>${esc(run.sha)}</code>` : 'an unrecorded commit';
      return `<li class="demo-meta">${verdict}${fails} · on ${on} · ${when(run.startedAt)}</li>`;
    });
    return titled(`<p class="demo-meta">npm test suites, run by b7e-gate in <code>${esc(g.slug)}</code>:</p><ul class="demo-runs">${rows.join('')}</ul>`);
  }

  function coverageSection(h) {
    const cov = h.coverage;
    if (!cov?.known) return section('Coverage', `<p class="demo-meta">Unknown: ${esc(cov?.why || 'not read')}</p>`);
    const of = cov.onHead
      ? 'measured on this head'
      : `measured on <code>${esc(cov.commit || 'an unrecorded commit')}</code>, not this head${cov.generated ? `, ${when(cov.generated)}` : ''}`;
    const lines = [`<p class="demo-meta">${plural(cov.changed, 'changed file')} · ${of}</p>`];
    if (cov.untested.length) {
      lines.push(`<p class="demo-refused">Never imported by the suite: ${cov.untested.map((p) => `<code>${esc(p)}</code>`).join(', ')}</p>`);
    }
    const measured = cov.files.filter((f) => f.functions);
    if (measured.length) {
      lines.push(
        `<ul class="demo-runs">${measured
          .map((f) => {
            const miss = f.uncovered.length ? ` — never ran ${esc(f.uncovered.map((u) => u.name).join(', '))}` : '';
            return `<li class="demo-meta"><code>${esc(f.path)}</code> ${f.functions.covered}/${f.functions.total} functions${miss}</li>`;
          })
          .join('')}</ul>`
      );
    }
    const unknown = cov.files.filter((f) => f.loaded === null);
    if (unknown.length) {
      lines.push(`<p class="demo-meta">New since that measurement: ${unknown.map((f) => `<code>${esc(f.path)}</code>`).join(', ')}</p>`);
    }
    if (cov.outOfScope.length) {
      lines.push(`<p class="demo-meta">${plural(cov.outOfScope.length, 'file')} outside lib/ and bin/, which the Node suite's coverage does not measure.</p>`);
    }
    return section('Coverage', lines.join(''));
  }

  function beadSections(h) {
    if (!h.beads.length) return section('Beads', '<p class="demo-meta">No bead is named on this pull request.</p>');
    return h.beads.map((b) => section(`${b.id} · ${b.status || 'unknown status'}`, beadBody(h, b))).join('');
  }

  function beadBody(h, b) {
    const ws = h.workspace || 'beadcause';
    const parts = [`<p class="demo-title"><a href="${esc(beadHref(b))}">${esc(b.title || b.id)}</a></p>`];
    if (b.closeReason) parts.push(`<p class="demo-meta">Closed: ${esc(b.closeReason)}</p>`);

    if (b.liveError) parts.push(`<p class="demo-meta">Live sessions unknown: ${esc(b.liveError)}</p>`);
    else if (b.live.length) {
      parts.push(
        `<ul class="demo-runs">${b.live
          .map((s) => `<li class="demo-meta">Running now: <a href="/session?pid=${esc(s.pid)}">${esc(s.name || `pid ${s.pid}`)}</a> · ${when(s.at)}</li>`)
          .join('')}</ul>`
      );
    }
    if (b.sessionsError) parts.push(`<p class="demo-meta">Sessions unknown: ${esc(b.sessionsError)}</p>`);
    else if (!b.sessions.length) parts.push('<p class="demo-meta">No finished session is archived for it.</p>');
    else {
      parts.push(
        `<ul class="demo-runs">${b.sessions
          .map((s) => `<li class="demo-meta"><a href="${esc(sessionHref(ws, b.id, s.commit))}">${esc(s.subject || s.commit.slice(0, 12))}</a> · ${when(s.at)}</li>`)
          .join('')}</ul>`
      );
    }

    if (b.threadError) parts.push(`<p class="demo-meta">Thread unknown: ${esc(b.threadError)}</p>`);
    else if (!b.thread.length) parts.push('<p class="demo-meta">No comments.</p>');
    else {
      const older = b.comments - b.thread.length;
      if (older > 0) parts.push(`<p class="demo-meta">${plural(older, 'older comment')} — <a href="${esc(beadHref(b))}">the whole thread</a></p>`);
      parts.push(
        `<ol class="demo-thread">${b.thread
          .map(
            (c) => `<li><span class="demo-meta">${esc(c.author || 'someone')} · ${when(c.at)}</span>
              <span class="demo-said">${esc(c.text)}</span>${c.cut ? ` <a class="demo-meta" href="${esc(beadHref(b))}">read on</a>` : ''}</li>`
          )
          .join('')}</ol>`
      );
    }
    return parts.join('');
  }

  async function loadHistory(number) {
    state.history[number] = 'loading';
    try {
      const res = await fetch(`/api/demo/history?number=${encodeURIComponent(number)}`, { headers: { 'x-beadcause-token': token } });
      const body = await res.json().catch(() => ({}));
      state.history[number] = res.ok ? body : { error: body.error || `HTTP ${res.status}` };
    } catch (err) {
      state.history[number] = { error: err.message };
    }
    const body = out.querySelector(`.demo-history[data-number="${number}"] .demo-history-body`);
    if (body) body.innerHTML = historyBody(number);
  }

  async function load(refresh) {
    if (state.loading) return;
    state.loading = true;
    try {
      const q = new URLSearchParams();
      if (refresh) q.set('refresh', '1');
      if (from) q.set('from', from);
      const res = await fetch(`/api/demo${q.size ? `?${q}` : ''}`, { headers: { 'x-beadcause-token': token } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Which side answered — bin/router.js stamps every proxied response with it.
      state.env = res.headers.get('x-beadcause-env') || 'blue';
      state.candidate = res.headers.get('x-beadcause-candidate') || '';
      state.data = await res.json();
      if (openOnLoad && state.data.rows?.some((r) => r.number === openOnLoad)) {
        state.open.add(openOnLoad);
        loadHistory(openOnLoad);
      }
      openOnLoad = 0;
    } catch (err) {
      out.innerHTML = `<div class="empty"><strong>Could not read the candidates.</strong>${esc(err.message)}</div>`;
      return;
    } finally {
      state.loading = false;
    }
    render();
  }

  /** The tap: prepare it, stand it up, and put this device on it. */
  async function tryIt(number) {
    if (state.busy !== null || !state.data?.router) return;
    const row = state.data.rows.find((r) => r.number === number);
    if (!row) return;
    // Already standing: no need to ask the daemon anything, the router's link is the flip.
    // Unless main has moved since it was tried — then asking again is what re-records the
    // main it was tried against, which Approve refuses without (bc-sj8k.3).
    if (row.onGreen && !row.candidate?.behind) {
      location.href = `/__demo/green?id=${encodeURIComponent(row.candidate.id)}`;
      return;
    }
    state.busy = number;
    delete state.refused[number];
    render();
    try {
      const res = await fetch(`/api/demo/green?number=${encodeURIComponent(number)}`, {
        method: 'POST',
        headers: { 'x-beadcause-token': token },
      });
      const said = await res.json().catch(() => ({}));
      if (said.ok && said.go) {
        location.href = said.go;
        return;
      }
      state.refused[number] = said.error || `HTTP ${res.status}`;
    } catch (err) {
      state.refused[number] = err.message;
    } finally {
    }
    state.busy = null;
    render();
  }

  out.addEventListener('click', (e) => {
    if (e.target.closest('a')) return; // the diff and the bead chips are links of their own
    const verdict = e.target.closest('[data-verdict]');
    if (verdict) {
      if (verdict.disabled) return;
      const number = Number(verdict.closest('.demo-verdicts').dataset.number);
      const kind = verdict.dataset.verdict;
      if (kind === 'approve') return approve(number);
      disarm();
      // The same button again closes its box; the other one swaps it.
      const same = state.panel?.number === number && state.panel.kind === kind;
      state.panel = same ? null : { number, kind };
      delete state.said[number];
      render();
      if (!same) out.querySelector(`.demo-panel[data-number="${number}"] .demo-text`)?.focus();
      return;
    }
    const sendBtn = e.target.closest('[data-send]');
    if (sendBtn) {
      if (!sendBtn.disabled) send(Number(sendBtn.closest('.demo-panel').dataset.number), sendBtn.dataset.send);
      return;
    }
    if (e.target.closest('[data-cancel]')) {
      state.panel = null;
      render();
      return;
    }
    if (e.target.closest('.demo-panel')) return; // typing in the box is not a tap on the card
    const el = e.target.closest('.demo-card');
    if (el) tryIt(Number(el.dataset.number));
  });
  // What is typed is kept per card and per box, so the list redrawing never eats it.
  out.addEventListener('input', (e) => {
    const p = e.target.closest?.('.demo-panel');
    if (!p) return;
    if (e.target.classList.contains('demo-text')) state.drafts[`${p.dataset.kind}:${p.dataset.number}`] = e.target.value;
  });
  out.addEventListener('change', (e) => {
    const p = e.target.closest?.('.demo-panel');
    if (p && e.target.classList.contains('demo-bead-pick')) state.drafts[`bead:${p.dataset.number}`] = e.target.value;
  });
  out.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target.closest?.('.demo-card');
    if (!el || e.target !== el) return;
    e.preventDefault();
    tryIt(Number(el.dataset.number));
  });
  // `toggle` does not bubble, hence the capture. A redraw that puts `open` back fires it
  // too, and finds the card already in `state.open` — so it neither re-asks nor closes.
  out.addEventListener(
    'toggle',
    (e) => {
      const el = e.target;
      if (!el.classList?.contains('demo-history')) return;
      const number = Number(el.dataset.number);
      if (!el.open) {
        state.open.delete(number);
        return;
      }
      if (state.open.has(number)) return;
      state.open.add(number);
      if (!el.querySelector('.demo-history-body')) el.insertAdjacentHTML('beforeend', `<div class="demo-history-body">${historyBody(number)}</div>`);
      if (!state.history[number] || state.history[number].error) loadHistory(number);
    },
    true
  );
  refreshBtn?.addEventListener('click', () => {
    // A refresh is a request for what is true now, so the expanded cards ask again too.
    state.history = {};
    for (const n of state.open) loadHistory(n);
    load(true);
  });

  if (!token) {
    out.innerHTML = `<div class="empty"><strong>This device is not paired.</strong>Open the inbox first — it is where a token is set.</div>`;
  } else {
    load(false);
  }
})();
