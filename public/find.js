/* Find — one box for beads, chats, pull requests and pages (bc-qzng7.4).
 *
 * The redesign has three destinations (Inbox, Work, Beads) and Settings behind the space
 * name, and everything else — the ledger, the merge queue, the foundations, the terminal,
 * every one-off page — is reached from here: ⌘K (or Ctrl+K) on a desktop, the Find item at
 * the end of the bar on a phone. Typing narrows four lists at once:
 *
 *   - **Pages**, from `PAGES` below — a static list, because the set of places in this app
 *     is a fact about the app and not about the tracker. test/findpages.mjs fails the
 *     build when an HTML page in public/ is neither here nor in `NOT_A_PLACE` with a
 *     reason, so a new page cannot ship unreachable.
 *   - **Beads**, from `/api/beads?q=` — the same search the bead filter's typeahead uses
 *     (lib/beadsearch.js), so the two can never disagree about what a query matches.
 *   - **Chats**, from `/api/consoles`, matched on their title.
 *   - **Pull requests**, from `/api/prs`, matched on number and title.
 *
 * The overlay is built on first open, so a page that never opens it pays for nothing but
 * this file's parse. It is loaded by public/viewbar.js on demand, which is how every page
 * that draws the bar gets Find without each page's HTML naming this file.
 */
(() => {
  'use strict';
  if (window.beadcause?.find) return;

  /**
   * Every place in the app, as Find lists it. `href` is what a tap loads; `words` are what
   * it is also called, so `prs` finds the merge queue and `deploys` finds Releases.
   */
  const PAGES = [
    { label: 'Inbox', icon: '📥', href: '/', words: 'home questions merges waiting' },
    { label: 'Work', icon: '🛠️', href: '/?kind=epics', words: 'efforts epics board pipeline chats' },
    { label: 'Beads — open', icon: '🧿', href: '/?kind=bead', words: 'is:open all beads tracker live' },
    { label: 'Beads — closed', icon: '🧿', href: '/#history?status=closed', words: 'is:closed ledger history done closed' },
    { label: 'Beads — ledger', icon: '📜', href: '/#history', words: 'is:all ledger history everything' },
    { label: 'Advocate console', icon: '📣', href: '/#advocates', words: 'advocates monitor sessions roster' },
    { label: 'Merge queue', icon: '🚢', href: '/#advocates?tab=prs', words: 'prs pulls pull requests queue' },
    { label: 'Mirror', icon: '🪞', href: '/#advocates?tab=mirror', words: 'mirror device screen' },
    { label: 'Releases', icon: '🚀', href: '/#releases', words: 'deploys shipping releases' },
    { label: 'Settings', icon: '⚙️', href: '/#config', words: 'config space advocate settings' },
    { label: 'All settings', icon: '⚙️', href: '/#config?p=all', words: 'config keys every setting' },
    { label: 'Endorsement queue', icon: '🗳️', href: '/endorse', words: 'endorse held unendorsed' },
    { label: 'Chat sessions', icon: '💬', href: '/console', words: 'console chats conversations' },
    { label: 'This machine', icon: '🖥️', href: '/admin', words: 'admin daemon machine' },
    { label: 'Foundations', icon: '⚖️', href: '/foundations', words: 'agents kinds permissions' },
    { label: 'Requirements', icon: '📋', href: '/requirements', words: 'requirements' },
    { label: 'Flow', icon: '🔀', href: '/flow', words: 'flow lifecycle' },
    { label: 'Skills', icon: '🧰', href: '/skills', words: 'skills library' },
    { label: 'Sounds', icon: '🔔', href: '/sounds', words: 'sounds audition notifications' },
    { label: 'Terminal', icon: '⌨️', href: '/terminal', words: 'terminal shell term' },
    { label: 'Demo mode', icon: '🎬', href: '/demo', words: 'demo candidates green' },
  ];

  /**
   * The pages Find deliberately does not list, each with why. They are not places: each
   * needs an argument (a bead, a document, a session) that only the thing you tapped can
   * give it, or it is the sign-in screen. test/findpages.mjs reads this list.
   */
  const NOT_A_PLACE = {
    'beadsession.html': 'a bead’s own session, opened from that bead',
    'doc.html': 'a document, opened from the link that names it',
    'docket.html': 'a question’s docket, opened from its card',
    'graph.html': 'a bead’s graph, opened from the bead (Find lists beads)',
    'login.html': 'the sign-in screen',
    'session.html': 'one session, opened from where it is listed',
    'index.html': 'the shell itself — Inbox, Work, Beads and Settings above are its places',
  };

  const token = (() => {
    try {
      return localStorage.getItem('beadcause.token') || '';
    } catch {
      return '';
    }
  })();
  const api = async (path) => {
    const res = await fetch(path, { headers: token ? { 'x-beadcause-token': token } : {} });
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json();
  };
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  let root = null;
  let input = null;
  let list = null;
  let asked = '';
  let timer = null;
  let lastFocus = null;
  /** Chats and pull requests, fetched once per open: a list to filter, not a search. */
  let chats = null;
  let prs = null;

  const norm = (s) => String(s || '').toLowerCase();
  const pageHits = (q) =>
    PAGES.filter((p) => !q || norm(`${p.label} ${p.words} ${p.href}`).includes(q)).slice(0, q ? 8 : PAGES.length);

  function rowHtml({ icon, label, sub, href }) {
    return `<a class="find-row" href="${esc(href)}" role="option"><span class="find-icon" aria-hidden="true">${icon}</span><span class="find-text"><span class="find-label">${esc(
      label
    )}</span>${sub ? `<span class="find-sub">${esc(sub)}</span>` : ''}</span></a>`;
  }

  function groupHtml(title, rows) {
    if (!rows.length) return '';
    return `<div class="find-group" role="group" aria-label="${esc(title)}"><div class="find-head">${esc(title)}</div>${rows
      .map(rowHtml)
      .join('')}</div>`;
  }

  function paint(beads = null) {
    const q = norm(input.value.trim());
    const pages = pageHits(q).map((p) => ({ icon: p.icon, label: p.label, href: p.href }));
    const chatRows = q
      ? (chats || [])
          .filter((c) => norm(`${c.title} ${c.workspace}`).includes(q))
          .slice(0, 6)
          .map((c) => ({ icon: '💬', label: c.title || 'Untitled chat', sub: c.workspace, href: `/console?id=${encodeURIComponent(c.id)}` }))
      : [];
    const prRows = q
      ? (prs || [])
          .filter((p) => norm(`#${p.number} ${p.title} ${p.workspace}`).includes(q))
          .slice(0, 6)
          .map((p) => ({ icon: '🚢', label: `#${p.number} ${p.title || ''}`, sub: `${p.workspace} · ${p.stage || ''}`, href: p.url || '/#advocates?tab=prs' }))
      : [];
    const beadRows = (beads || []).slice(0, 10).map((b) => ({
      icon: '🧿',
      label: `${b.id} ${b.title || ''}`,
      sub: [b.workspace, b.status].filter(Boolean).join(' · '),
      href: `/graph?ws=${encodeURIComponent(b.workspace)}&id=${encodeURIComponent(b.id)}&open=1`,
    }));
    const html =
      groupHtml('Pages', pages) + groupHtml('Beads', beadRows) + groupHtml('Chats', chatRows) + groupHtml('Pull requests', prRows);
    list.innerHTML = html || `<div class="find-empty">Nothing matches “${esc(input.value.trim())}”.</div>`;
  }

  async function searchBeads() {
    const q = input.value.trim();
    asked = q;
    if (q.length < 2) return paint([]);
    paint(null);
    try {
      const data = await api(`/api/beads?q=${encodeURIComponent(q)}`);
      if (asked === q) paint(Array.isArray(data.beads) ? data.beads : []);
    } catch {
      if (asked === q) paint([]);
    }
  }

  async function loadLists() {
    try {
      const data = await api('/api/consoles');
      chats = Array.isArray(data?.consoles) ? data.consoles : Array.isArray(data) ? data : [];
    } catch {
      chats = [];
    }
    try {
      const data = await api('/api/prs');
      prs = (data?.repos || []).flatMap((r) => r.prs || []).filter((p) => p.stage !== 'closed');
    } catch {
      prs = [];
    }
    if (root && !root.hidden) paint();
  }

  function build() {
    root = document.createElement('div');
    root.className = 'find';
    root.hidden = true;
    root.innerHTML = `<div class="find-backdrop" data-find-close></div>
      <div class="find-panel" role="dialog" aria-modal="true" aria-label="Find">
        <div class="find-box">
          <span aria-hidden="true">🔎</span>
          <input type="search" class="find-input" placeholder="Find a bead, chat, pull request or page" aria-label="Find" autocomplete="off" />
          <button type="button" class="find-close" data-find-close aria-label="Close">Esc</button>
        </div>
        <div class="find-list" role="listbox"></div>
      </div>`;
    document.body.appendChild(root);
    input = root.querySelector('.find-input');
    list = root.querySelector('.find-list');
    input.addEventListener('input', () => {
      paint(asked === input.value.trim() ? undefined : []);
      clearTimeout(timer);
      timer = setTimeout(searchBeads, 180);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const first = list.querySelector('.find-row');
        if (first) {
          e.preventDefault();
          first.click();
        }
      }
    });
    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-find-close]')) close();
      else if (e.target.closest('.find-row')) setTimeout(close, 0);
    });
  }

  function open() {
    if (!root) build();
    if (!root.hidden) return;
    lastFocus = document.activeElement;
    root.hidden = false;
    document.documentElement.classList.add('find-open');
    input.value = '';
    chats = null;
    prs = null;
    paint([]);
    loadLists();
    input.focus();
  }

  function close() {
    if (!root || root.hidden) return;
    root.hidden = true;
    document.documentElement.classList.remove('find-open');
    lastFocus?.focus?.();
  }

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && String(e.key).toLowerCase() === 'k') {
      e.preventDefault();
      if (root && !root.hidden) close();
      else open();
    } else if (e.key === 'Escape' && root && !root.hidden) {
      close();
    }
  });

  window.beadcause = window.beadcause || {};
  window.beadcause.find = { open, close, PAGES, NOT_A_PLACE };
})();
