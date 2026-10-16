/*
  Notes on a document — select a passage, Comment or Suggest edit, send the lot as one
  batch (bc-03vg2.2, under the phone-reader epic bc-03vg2).

  ## What it does

  Select text in a rendered document and a small bar offers **Comment** and **Suggest
  edit**. Either opens a sheet; what you write there becomes a note in a tray at the foot
  of the page ("3 notes · Send"). **Send** posts every note as ONE comment on the bead,
  whose body is a fenced `docnotes` block (the format is the epic's, and it is the
  contract with the agent that applies the notes), and that one comment dispatches one
  agent turn — one turn per batch, not one per note.

  The reader never writes a file. A suggestion is a request the owning agent applies,
  through the repo's own gates.

  ## The hard part: the source, not the page

  A note has to point at the markdown SOURCE, because that is what the applier edits —
  and a selection is made on the rendered page, where `**bold**` is "bold" and a link is
  its text. So `anchor()` projects the source to the plain text the page shows, keeping
  an index back into the source for every character it keeps, finds the selected text
  in that projection, and maps the hit back. Two hits are told apart by the text the
  page shows either side of the selection. When that still cannot pick one — or finds
  none — the sheet says so and will not save, because a note anchored in the wrong place
  is worse than a note not written.

  The quote is widened to take in an emphasis marker it would otherwise cut in half, so
  replacing it never leaves a stray `**` behind.

  ## Where it runs

  The /doc reader (public/doc.js calls `attach` once the document is drawn), and any repo
  view, through `ctx.notes` in public/viewhost.js — loremia's Briefs pane uses it without
  copying it. The Android reader adds the same two actions to the system selection menu
  (DocActivity.kt), which call `open('comment' | 'suggest')` here.

  ## What survives what

  Unsent notes live in localStorage under the file, the ref and the bead, so a closed app
  or a reload loses nothing. Storage that throws (a private window) degrades to notes
  held for this page only.
*/
(function (root) {
  'use strict';

  const CONTEXT = 60;
  const MARKERS = ['**', '__', '~~', '*', '_', '`'];

  /* --------------------------------------------------------- the source projection */

  /**
   * The plain text a markdown source renders to, closely enough to find a selection in,
   * with `map[i]` the source index of the i-th plain character. Whitespace runs collapse
   * to one space (mapped to the first of them), as they do on the page.
   */
  function project(source, { markdown = true } = {}) {
    const src = String(source || '');
    const out = [];
    const map = [];
    let lastSpace = true;
    const emit = (ch, at) => {
      if (/\s/.test(ch)) {
        if (lastSpace) return;
        out.push(' ');
        map.push(at);
        lastSpace = true;
        return;
      }
      out.push(ch);
      map.push(at);
      lastSpace = false;
    };
    // A plain-text file is drawn as itself in a <pre>: only the whitespace differs.
    if (!markdown) {
      for (let k = 0; k < src.length; k++) emit(src[k], k);
      return { plain: out.join(''), map };
    }

    let i = 0;
    let lineStart = true;
    let fence = false;
    while (i < src.length) {
      if (lineStart) {
        const eol = src.indexOf('\n', i);
        const line = src.slice(i, eol < 0 ? src.length : eol);
        // A code fence's own line renders as nothing, and a table's rule row too.
        if (/^\s{0,3}(```|~~~)/.test(line)) {
          fence = !fence;
          i = eol < 0 ? src.length : eol;
          continue;
        }
        if (!fence && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line) && line.includes('|')) {
          i = eol < 0 ? src.length : eol;
          continue;
        }
        if (!fence && /^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
          i = eol < 0 ? src.length : eol;
          continue;
        }
        if (!fence) {
          // Block prefixes, as many as are stacked: "> - " is a quote holding a list.
          // A heading ends the stack: "## 3. The Sky" is a heading, not a list item.
          for (;;) {
            const m = /^(\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d{1,9}[.)]\s+))/.exec(src.slice(i, i + 40));
            if (!m) break;
            i += m[1].length;
            if (m[2][0] === '#') break;
          }
        }
        lineStart = false;
        continue;
      }
      const ch = src[i];
      if (ch === '\n') {
        emit(' ', i);
        i++;
        lineStart = true;
        continue;
      }
      if (fence) {
        emit(ch, i);
        i++;
        continue;
      }
      if (ch === '\\' && i + 1 < src.length && /[\\`*_{}[\]()#+\-.!|~<>]/.test(src[i + 1])) {
        emit(src[i + 1], i + 1);
        i += 2;
        continue;
      }
      if (ch === '!' && src[i + 1] === '[') {
        const m = /^!\[[^\]]*\]\([^)]*\)/.exec(src.slice(i));
        if (m) {
          i += m[0].length;
          continue;
        }
      }
      if (ch === '[') {
        const m = /^\[([^\]]*)\]\([^)]*\)/.exec(src.slice(i));
        if (m) {
          // The link's text is what the page shows; its target is not.
          const text = m[1];
          let j = i + 1;
          const end = i + 1 + text.length;
          while (j < end) {
            const c = src[j];
            if (MARKERS.some((mk) => mk.length === 1 && mk === c)) {
              j++;
              continue;
            }
            emit(c, j);
            j++;
          }
          i += m[0].length;
          continue;
        }
      }
      if (ch === '<') {
        const auto = /^<((?:https?|mailto):[^>\s]+)>/.exec(src.slice(i));
        if (auto) {
          for (let k = 0; k < auto[1].length; k++) emit(auto[1][k], i + 1 + k);
          i += auto[0].length;
          continue;
        }
        const tag = /^<\/?[A-Za-z][^>]*>/.exec(src.slice(i));
        if (tag) {
          i += tag[0].length;
          continue;
        }
      }
      if (ch === '&') {
        const ent = /^&(amp|lt|gt|quot|#39|nbsp);/.exec(src.slice(i, i + 7));
        if (ent) {
          emit({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' }[ent[1]], i);
          i += ent[0].length;
          continue;
        }
      }
      if (ch === '~') {
        // Only a pair is strikethrough; "~60 chars" shows its tilde.
        if (src[i + 1] === '~') {
          i += 2;
          continue;
        }
        emit(ch, i);
        i++;
        continue;
      }
      if (ch === '*' || ch === '_' || ch === '`') {
        // `_` inside a word is a character, not emphasis (snake_case renders as itself).
        if (ch === '_' && /\w/.test(src[i - 1] || '') && /\w/.test(src[i + 1] || '')) {
          emit(ch, i);
          i++;
          continue;
        }
        i++;
        continue;
      }
      if (ch === '|') {
        emit(' ', i);
        i++;
        continue;
      }
      emit(ch, i);
      i++;
    }
    return { plain: out.join(''), map };
  }

  const norm = (s) => String(s || '').replace(/\s+/g, ' ');

  /** How many characters two strings share at their ends (`tail`) or starts. */
  function shared(a, b, tail) {
    let n = 0;
    const max = Math.min(a.length, b.length);
    while (n < max && (tail ? a[a.length - 1 - n] === b[b.length - 1 - n] : a[n] === b[n])) n++;
    return n;
  }

  /**
   * Where a selection sits in the source.
   *
   * `selected` is the page's selected text; `seenBefore` / `seenAfter` are the page's
   * text either side of it, which is what tells two copies of a phrase apart. Returns
   * `{ ok: true, start, end, quote, before, after, line, section }` with offsets into the
   * source, or `{ ok: false, why }`.
   */
  function anchor(source, selected, { seenBefore = '', seenAfter = '', markdown = true } = {}) {
    const src = String(source || '');
    const want = norm(selected).trim();
    if (!want) return { ok: false, why: 'Nothing is selected.' };
    const { plain, map } = project(src, { markdown });
    const hits = [];
    for (let at = plain.indexOf(want); at >= 0; at = plain.indexOf(want, at + 1)) hits.push(at);
    if (!hits.length) {
      return { ok: false, why: "This passage can't be found in the file's source, so a note on it could not be applied. Try selecting within one paragraph." };
    }
    let pick = hits[0];
    if (hits.length > 1) {
      const before = norm(seenBefore);
      const after = norm(seenAfter);
      const scored = hits.map((at) => ({
        at,
        score: shared(plain.slice(Math.max(0, at - 200), at).trimEnd(), before.trimEnd(), true) +
          shared(plain.slice(at + want.length, at + want.length + 200).trimStart(), after.trimStart(), false),
      }));
      scored.sort((a, b) => b.score - a.score);
      if (scored[0].score === scored[1].score) {
        return { ok: false, why: `This passage appears ${hits.length} times and the text around it doesn't say which one. Select a little more of it.` };
      }
      pick = scored[0].at;
    }
    let start = map[pick];
    let end = map[pick + want.length - 1] + 1;

    // Take in an emphasis marker the quote would otherwise cut in half.
    for (const mk of MARKERS) {
      const count = (s) => s.split(mk).length - 1;
      let guard = 0;
      while (count(src.slice(start, end)) % 2 === 1 && guard++ < 2) {
        if (src.slice(start - mk.length, start) === mk) start -= mk.length;
        else if (src.slice(end, end + mk.length) === mk) end += mk.length;
        else break;
      }
      // A quote that sits just inside a pair (`**bold**` selected as "bold") is fine
      // as it is: replacing "bold" keeps the emphasis, which is what you would mean.
    }

    const upto = src.slice(0, start);
    const line = upto.split('\n').length;
    let section = '';
    const heads = upto.match(/^#{1,6}\s+.*$/gm);
    if (heads) section = heads[heads.length - 1].trim();
    return {
      ok: true,
      start,
      end,
      quote: src.slice(start, end),
      before: src.slice(Math.max(0, start - CONTEXT), start),
      after: src.slice(end, end + CONTEXT),
      line,
      section,
    };
  }

  /* ------------------------------------------------------------- the notes format */

  // JSON strings are valid YAML double-quoted scalars, and they quote everything a
  // passage of prose can hold — colons, quotes, newlines, a leading dash.
  const y = (s) => JSON.stringify(String(s == null ? '' : s));

  /** The comment body: one fenced `docnotes` block, YAML inside, as the epic defines. */
  function format({ file, ref, blob, notes }) {
    const lines = ['```docnotes', `file: ${y(file)}`];
    if (ref) lines.push(`ref: ${y(ref)}`);
    if (blob) lines.push(`blob: ${y(blob)}`);
    lines.push('notes:');
    for (const n of notes) {
      lines.push(`  - kind: ${n.kind === 'suggest' ? 'suggest' : 'comment'}`);
      if (n.section) lines.push(`    section: ${y(n.section)}`);
      if (n.line) lines.push(`    line: ${Number(n.line) | 0}`);
      lines.push(`    quote: ${y(n.quote)}`);
      lines.push(`    before: ${y(n.before)}`);
      lines.push(`    after: ${y(n.after)}`);
      if (n.kind === 'suggest') lines.push(`    replacement: ${y(n.replacement)}`);
      if (n.note) lines.push(`    note: ${y(n.note)}`);
    }
    lines.push('```');
    const name = String(file || '').split('/').pop();
    const count = `${notes.length} note${notes.length === 1 ? '' : 's'}`;
    return `${count} on ${name}${ref ? ` at ${ref}` : ''}, from the reader.\n\n${lines.join('\n')}\n`;
  }

  /* ------------------------------------------------------------------- the storage */

  const memory = new Map();
  const store = {
    get(key) {
      try {
        const raw = root.localStorage?.getItem(key);
        if (raw) return JSON.parse(raw);
      } catch {
        /* fall through to what this page holds */
      }
      return memory.get(key) || [];
    },
    set(key, notes) {
      memory.set(key, notes);
      try {
        if (notes.length) root.localStorage?.setItem(key, JSON.stringify(notes));
        else root.localStorage?.removeItem(key);
      } catch {
        /* held in memory for this page, which is the most a private window allows */
      }
    },
  };
  const keyFor = ({ file, ref, workspace, bead }) => `beadcause.docnotes:${file}|${ref || ''}|${workspace || ''}/${bead || ''}`;

  /* -------------------------------------------------------------------- the page */

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  /** The page's text either side of a range, inside `body`. */
  function around(body, range) {
    const doc = body.ownerDocument;
    const pre = doc.createRange();
    pre.selectNodeContents(body);
    pre.setEnd(range.startContainer, range.startOffset);
    const post = doc.createRange();
    post.selectNodeContents(body);
    post.setStart(range.endContainer, range.endOffset);
    return { seenBefore: pre.toString().slice(-200), seenAfter: post.toString().slice(0, 200) };
  }

  let active = null;

  /**
   * Put the notes layer on a rendered document.
   *
   * `body` is the element the document is drawn in. `doc` is what a note needs to say
   * where it came from: `{ source, file, ref, blob, workspace, bead }`, plus
   * `markdown: false` for a plain-text file drawn as itself. `api(path, init)`
   * is the page's authenticated fetch. Returns `{ open(kind), detach() }`.
   */
  function attach(body, doc, { api } = {}) {
    if (active) active.detach();
    const d = body.ownerDocument;
    const state = { ...doc };
    let key = keyFor(state);
    let snap = null;
    let timer = 0;

    const bar = d.createElement('div');
    bar.className = 'dn-bar';
    bar.hidden = true;
    bar.innerHTML = '<button type="button" class="secondary" data-kind="comment">Comment</button><button type="button" class="secondary" data-kind="suggest">Suggest edit</button>';
    const tray = d.createElement('div');
    tray.className = 'dn-tray';
    tray.hidden = true;
    const sheet = d.createElement('div');
    sheet.className = 'dn-sheet';
    sheet.hidden = true;
    d.body.append(bar, tray, sheet);

    // The selection must survive the tap: a button press can collapse it before the
    // click lands, so the bar keeps it from being taken at all, and the snapshot is
    // taken as the selection changes rather than on the click.
    bar.addEventListener('pointerdown', (e) => e.preventDefault());
    bar.addEventListener('mousedown', (e) => e.preventDefault());
    bar.addEventListener('click', (e) => {
      const kind = e.target?.dataset?.kind;
      if (kind) open(kind);
    });

    function take() {
      const sel = d.getSelection?.();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
      const range = sel.getRangeAt(0);
      if (!body.contains(range.commonAncestorContainer)) return null;
      const text = sel.toString();
      if (!text.trim()) return null;
      return { text, ...around(body, range), rect: range.getBoundingClientRect() };
    }

    function onSelection() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const s = take();
        if (!s) {
          if (sheet.hidden) bar.hidden = true;
          return;
        }
        snap = s;
        // In the Android app the system selection toolbar carries the two actions.
        if (root.beadcause?.docnotes?.native) return;
        bar.hidden = false;
        // Below the selection: above it is where the system's own copy/share menu goes.
        const top = Math.min(s.rect.bottom + 8, (root.innerHeight || 600) - 56);
        bar.style.top = `${Math.max(8, top)}px`;
        bar.style.left = `${Math.max(8, Math.min(s.rect.left, (root.innerWidth || 360) - 220))}px`;
      }, 250);
    }
    d.addEventListener('selectionchange', onSelection);

    function notes() {
      return store.get(key);
    }

    function drawTray(msg = '') {
      const list = notes();
      tray.hidden = !list.length && !msg;
      const n = list.length;
      tray.innerHTML =
        (n
          ? `<button type="button" class="dn-count secondary" aria-expanded="false">${n} note${n === 1 ? '' : 's'}</button>` +
            `<button type="button" class="dn-send primary">Send</button>`
          : '') +
        (msg ? `<div class="dn-msg">${msg}</div>` : '') +
        `<ol class="dn-list" hidden>${list
          .map(
            (x, i) =>
              `<li><span class="dn-kind">${x.kind === 'suggest' ? 'Suggest' : 'Comment'}</span> ` +
              `<q>${esc(x.quote.length > 90 ? `${x.quote.slice(0, 90)}…` : x.quote)}</q>` +
              (x.kind === 'suggest' ? ` → <ins>${esc(x.replacement || '(delete)')}</ins>` : '') +
              (x.note ? `<div class="dn-note">${esc(x.note)}</div>` : '') +
              `<button type="button" class="dn-drop" data-i="${i}" aria-label="Remove this note">✕</button></li>`
          )
          .join('')}</ol>`;
      tray.querySelector('.dn-count')?.addEventListener('click', (e) => {
        const ol = tray.querySelector('.dn-list');
        ol.hidden = !ol.hidden;
        e.currentTarget.setAttribute('aria-expanded', String(!ol.hidden));
      });
      for (const b of tray.querySelectorAll('.dn-drop')) {
        b.addEventListener('click', () => {
          const next = notes().filter((_, i) => i !== Number(b.dataset.i));
          store.set(key, next);
          drawTray();
          if (next.length) {
            tray.querySelector('.dn-list').hidden = false;
          }
        });
      }
      tray.querySelector('.dn-send')?.addEventListener('click', send);
    }

    function close() {
      sheet.hidden = true;
      sheet.innerHTML = '';
    }

    /** The sheet for one note. `kind` is 'comment' or 'suggest'. */
    function open(kind) {
      const s = take() || snap;
      bar.hidden = true;
      if (!s) return;
      const at = anchor(state.source, s.text, { ...s, markdown: state.markdown !== false });
      const suggest = kind === 'suggest';
      sheet.hidden = false;
      sheet.innerHTML =
        `<div class="dn-card" role="dialog" aria-label="${suggest ? 'Suggest an edit' : 'Comment'}">` +
        `<div class="dn-head">${suggest ? 'Suggest edit' : 'Comment'}</div>` +
        `<blockquote class="dn-quote">${esc(at.ok ? at.quote : s.text)}</blockquote>` +
        (at.ok ? '' : `<div class="dn-msg dn-err">${esc(at.why)}</div>`) +
        (suggest
          ? `<label class="dn-label">Replace with<textarea class="dn-text" rows="4"></textarea></label>` +
            `<label class="dn-label">Why (optional)<input class="dn-why" type="text"></label>`
          : `<label class="dn-label">Your comment<textarea class="dn-text" rows="4"></textarea></label>`) +
        `<div class="dn-actions"><button type="button" class="dn-cancel secondary">Cancel</button>` +
        `<button type="button" class="dn-save primary"${at.ok ? '' : ' disabled'}>Add note</button></div></div>`;
      const text = sheet.querySelector('.dn-text');
      // Prefilled with the source's own words, emphasis and all, so an edit is an edit
      // of what is there rather than a retyping of it.
      if (suggest && at.ok) text.value = at.quote;
      sheet.querySelector('.dn-cancel').addEventListener('click', close);
      sheet.querySelector('.dn-save').addEventListener('click', () => {
        const value = text.value;
        if (!suggest && !value.trim()) {
          text.focus();
          return;
        }
        const note = {
          kind: suggest ? 'suggest' : 'comment',
          section: at.section,
          line: at.line,
          quote: at.quote,
          before: at.before,
          after: at.after,
        };
        if (suggest) {
          note.replacement = value;
          const why = sheet.querySelector('.dn-why').value.trim();
          if (why) note.note = why;
        } else {
          note.note = value.trim();
        }
        store.set(key, [...notes(), note]);
        close();
        d.getSelection?.()?.removeAllRanges?.();
        drawTray();
      });
      setTimeout(() => text.focus?.(), 0);
    }

    /** The bead to send to — the one in the URL, or one filed for these notes. */
    async function beadFor() {
      if (state.workspace && state.bead) return true;
      let names = [];
      try {
        const res = await api('/api/workspaces');
        names = ((await res.json()).workspaces || []).map((w) => w.name);
      } catch {
        /* the picker is drawn with whatever there is */
      }
      if (state.workspace && !names.includes(state.workspace)) names.unshift(state.workspace);
      // The repo a file is in is usually the workspace named after it.
      const guess = state.workspace || names.find((n) => String(state.file).split('/').includes(n)) || names[0] || '';
      const name = String(state.file || '').split('/').pop();
      return new Promise((resolve) => {
        sheet.hidden = false;
        sheet.innerHTML =
          `<div class="dn-card" role="dialog" aria-label="File a bead for these notes">` +
          `<div class="dn-head">No bead to send these to</div>` +
          `<div class="dn-msg">This document wasn't opened from a bead. File one for the notes — ` +
          `<strong>Notes on ${esc(name)}</strong>, labelled <code>human</code> — and send them there?</div>` +
          `<label class="dn-label">Workspace<select class="dn-ws">${names
            .map((n) => `<option${n === guess ? ' selected' : ''}>${esc(n)}</option>`)
            .join('')}</select></label>` +
          `<div class="dn-actions"><button type="button" class="dn-cancel secondary">Cancel</button>` +
          `<button type="button" class="dn-save primary"${names.length ? '' : ' disabled'}>File and send</button></div></div>`;
        sheet.querySelector('.dn-cancel').addEventListener('click', () => {
          close();
          resolve(false);
        });
        sheet.querySelector('.dn-save').addEventListener('click', async (e) => {
          e.currentTarget.disabled = true;
          const workspace = sheet.querySelector('.dn-ws').value;
          try {
            const res = await api('/api/bead/create', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                workspace,
                title: `Notes on ${name}`,
                type: 'task',
                labels: ['human'],
                description: `Notes from the phone reader on ${state.file}${state.ref ? ` at ${state.ref}` : ''}. They arrive as a docnotes comment.`,
              }),
            });
            const out = await res.json().catch(() => ({}));
            if (!res.ok || !out.id) throw new Error(out.error || `HTTP ${res.status}`);
            // The notes were stored under "no bead"; they move with the bead they now have.
            const held = notes();
            store.set(key, []);
            state.workspace = workspace;
            state.bead = out.id;
            key = keyFor(state);
            store.set(key, [...notes(), ...held]);
            close();
            resolve(true);
          } catch (err) {
            close();
            drawTray(`<span class="dn-err">Could not file a bead: ${esc(err.message)}</span>`);
            resolve(false);
          }
        });
      });
    }

    async function send() {
      if (!notes().length) return;
      if (!(await beadFor())) return;
      const batch = notes();
      const btn = tray.querySelector('.dn-send');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Sending…';
      }
      try {
        const res = await api('/api/comment', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            workspace: state.workspace,
            id: state.bead,
            text: format({ file: state.file, ref: state.ref, blob: state.blob, notes: batch }),
          }),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`);
        // Only what was sent is cleared — a note added while the request was out stays.
        const sent = new Set(batch.map((n) => JSON.stringify(n)));
        store.set(key, notes().filter((n) => !sent.has(JSON.stringify(n))));
        drawTray(`Sent ${batch.length} note${batch.length === 1 ? '' : 's'} to ${esc(state.bead)}${out.dispatched ? ' — an agent is on it' : ''}.`);
      } catch (err) {
        drawTray(`<span class="dn-err">Not sent — ${esc(err.message)}. Your notes are kept.</span>`);
      }
    }

    drawTray();
    const handle = {
      open,
      detach() {
        d.removeEventListener('selectionchange', onSelection);
        clearTimeout(timer);
        bar.remove();
        tray.remove();
        sheet.remove();
        if (active === handle) active = null;
      },
    };
    active = handle;
    return handle;
  }

  const api = { project, anchor, format, attach, keyFor, open: (kind) => active?.open(kind) };
  root.beadcause = root.beadcause || {};
  root.beadcause.docnotes = api;
})(typeof window !== 'undefined' ? window : globalThis);
