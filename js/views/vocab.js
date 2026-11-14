// Kelime defteri: okurken bakılan kelimeler (kelime, geçtiği cümle, çeviri) kitap bazında saklanır,
// kartlarla tekrar edilir. book.vocab = [{ id, w, t, ctx, lang, at, box, due, upd }], silinenler book.vocabDel = { id: zaman }.
import { state, getBook, saveBook, displayTitle } from '../store.js';
import { esc, enc, toast, ICON, $, $$ } from '../ui.js';

const DAY = 86400000;
const GAPS = [0, 1, 3, 7, 16, 35]; // kutu → kaç gün sonra tekrar
const real = b => b?.__real || b;
const key = w => String(w || '').toLocaleLowerCase('en').trim();

export const findWord = (book, w) => (real(book).vocab || []).find(v => key(v.w) === key(w));

export async function addWord(book, { w, t = '', ctx = '', lang = 'orig' }) {
  const b = real(book);
  const have = findWord(b, w);
  if (have) { if (t && !have.t) { have.t = t; have.upd = Date.now(); await saveBook(b); } return have; }
  const now = Date.now();
  const entry = { id: `v${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, w: String(w).trim(), t, ctx: String(ctx || '').trim().slice(0, 400), lang, at: now, box: 0, due: now, upd: now };
  (b.vocab ||= []).push(entry);
  await saveBook(b);
  return entry;
}

export async function removeWord(book, id) {
  const b = real(book);
  b.vocab = (b.vocab || []).filter(v => v.id !== id);
  (b.vocabDel ||= {})[id] = Date.now();
  await saveBook(b);
}

async function grade(book, id, knew) {
  const v = (book.vocab || []).find(x => x.id === id);
  if (!v) return;
  v.box = knew ? Math.min(5, (v.box || 0) + 1) : 0;
  v.due = Date.now() + GAPS[v.box] * DAY - (knew ? 0 : -10 * 60000);
  v.upd = Date.now();
  await saveBook(book);
}

export const allWords = (bookId) => state.books
  .filter(b => (!bookId || b.id === bookId) && (b.vocab || []).length)
  .flatMap(b => b.vocab.map(v => ({ ...v, book: b })));

export const vocabCount = () => state.books.reduce((n, b) => n + (b.vocab || []).length, 0);

const markWord = (ctx, w) => {
  const s = esc(ctx), k = esc(w);
  const i = s.toLocaleLowerCase('en').indexOf(k.toLocaleLowerCase('en'));
  return i < 0 ? s : `${s.slice(0, i)}<b>${s.slice(i, i + k.length)}</b>${s.slice(i + k.length)}`;
};

// ---------- Liste ----------
export async function renderVocab(view, [bookId], query) {
  if (query.get('review') === '1') return renderReview(view, bookId);
  const book = bookId ? getBook(bookId) : null;
  const draw = (filter = '') => {
    const words = allWords(bookId).sort((a, b) => b.at - a.at);
    const f = key(filter);
    const shown = f ? words.filter(v => key(v.w).includes(f) || key(v.t).includes(f) || key(v.ctx).includes(f)) : words;
    const due = words.filter(v => (v.due || 0) <= Date.now()).length;
    view.innerHTML = `
      <div class="topbar"><button class="icon-btn" data-back aria-label="Geri"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button><div class="title">📒 Kelime defteri</div></div>
      <div class="page-pad">
        ${book ? `<div class="muted small" style="margin-bottom:8px">${esc(displayTitle(book))}</div>` : ''}
        ${words.length ? `<div class="section" style="display:flex;align-items:center;gap:12px">
            <div style="flex:1"><b>${words.length} kelime</b><div class="muted small">${due ? `${due} kelime tekrar için hazır` : 'Bugünlük tekrar bitti 🎉'}</div></div>
            <a class="btn primary" href="#/vocab${bookId ? `/${enc(bookId)}` : ''}?review=1">🃏 Tekrar et</a></div>
          <div class="searchbox" style="margin-bottom:10px">${ICON.search}<input id="vq" type="search" placeholder="Kelimelerde ara…" value="${esc(filter)}" autocomplete="off" autocorrect="off" spellcheck="false"></div>
          <div class="list">${shown.map(v => `
            <div class="row vocab-row"><div class="body" style="flex:1;min-width:0">
              <div><b style="font-size:17px">${esc(v.w)}</b>${v.t ? ` <span class="muted">— ${esc(v.t)}</span>` : ''}</div>
              ${v.ctx ? `<div class="small vocab-ctx">${markWord(v.ctx, v.w)}</div>` : ''}
              ${!bookId ? `<a class="small muted" href="#/book/${enc(v.book.id)}">📖 ${esc(displayTitle(v.book))}</a>` : ''}
            </div><span class="vocab-box" title="Öğrenme seviyesi">${'●'.repeat(v.box || 0)}${'○'.repeat(5 - (v.box || 0))}</span>
            <button class="mini-btn" data-del="${v.id}" data-book="${v.book.id}" aria-label="Sil" style="background:transparent;color:var(--danger)">✕</button></div>`).join('') || '<div class="row muted">Eşleşen kelime yok</div>'}</div>`
        : `<div class="empty"><div class="big">📒</div><h2>Defter boş</h2><p>EPUB okurken bir kelimeyi seç; alttaki çeviri kartında <b>📒 Deftere ekle</b>'ye bas. Kelime, geçtiği cümleyle buraya kaydedilir.</p></div>`}
      </div>`;
    $('[data-back]', view).addEventListener('click', () => { if ((window.__navCount || 0) > 1) history.back(); else location.hash = bookId ? `#/book/${enc(bookId)}` : '#/reading'; });
    $('#vq', view)?.addEventListener('input', e => { const v = e.target.value; draw(v); const i = $('#vq', view); i.focus(); i.setSelectionRange(v.length, v.length); });
    $$('[data-del]', view).forEach(btn => btn.addEventListener('click', async () => {
      await removeWord(getBook(btn.dataset.book), btn.dataset.del);
      toast('Kelime silindi'); draw($('#vq', view)?.value || '');
    }));
  };
  draw();
}

// ---------- Kartlarla tekrar ----------
function renderReview(view, bookId) {
  const queue = allWords(bookId).filter(v => (v.due || 0) <= Date.now()).sort((a, b) => (a.box || 0) - (b.box || 0) || a.due - b.due);
  const total = queue.length;
  let i = 0, known = 0;
  const back = `#/vocab${bookId ? `/${enc(bookId)}` : ''}`;
  const next = () => {
    if (i >= queue.length) {
      view.innerHTML = `<div class="topbar"><a class="icon-btn" href="${back}" aria-label="Geri"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></a><div class="title">Tekrar</div></div>
        <div class="empty"><div class="big">🎉</div><h2>${total ? 'Tekrar bitti' : 'Şimdilik tekrar edilecek kelime yok'}</h2>
        ${total ? `<p>${total} kelimeden ${known} tanesini bildin.</p>` : '<p>Kelimeler, bildikçe daha seyrek sorulur. Yarın tekrar bak.</p>'}
        <a class="btn primary" href="${back}">Deftere dön</a></div>`;
      return;
    }
    const v = queue[i];
    view.innerHTML = `<div class="topbar"><a class="icon-btn" href="${back}" aria-label="Geri"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></a><div class="title">Tekrar · ${i + 1}/${total}</div></div>
      <div class="page-pad">
        <div class="flash" id="card"><div class="flash-w">${esc(v.w)}</div>
          ${v.ctx ? `<div class="flash-ctx">${markWord(v.ctx, v.w)}</div>` : ''}
          <div class="flash-a hidden" id="ans"><div class="flash-t">${esc(v.t || '—')}</div><div class="muted small">📖 ${esc(displayTitle(v.book))}</div></div>
          <div class="muted small" id="hint" style="margin-top:18px">Anlamını hatırlamaya çalış, sonra karta dokun</div></div>
        <div class="btn-row hidden" id="grade" style="margin-top:14px"><button class="btn" id="no">🔁 Bilmiyordum</button><button class="btn primary" id="yes">✅ Biliyordum</button></div>
      </div>`;
    $('#card', view).addEventListener('click', () => { $('#ans', view).classList.remove('hidden'); $('#hint', view).classList.add('hidden'); $('#grade', view).classList.remove('hidden'); });
    $('#no', view).addEventListener('click', async () => { await grade(v.book, v.id, false); queue.push(v); i++; next(); });
    $('#yes', view).addEventListener('click', async () => { await grade(v.book, v.id, true); known++; i++; next(); });
  };
  next();
}

// ---------- Kitap sayfası bölümü ----------
export function vocabSection(b) {
  const list = (b.vocab || []).slice().sort((x, y) => y.at - x.at);
  if (!list.length) return '';
  return `<a class="section" href="#/vocab/${enc(b.id)}" style="display:block;color:inherit">
    <div style="display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0">📒 Kelime defteri · ${list.length}</h3><span class="muted small">Tümü ›</span></div>
    <div class="small" style="margin-top:8px">${list.slice(0, 4).map(v => `<b>${esc(v.w)}</b>${v.t ? ` <span class="muted">${esc(v.t)}</span>` : ''}`).join(' · ')}</div></a>`;
}
