// Kitaplık: Kitaplar / Yazarlar / Seriler sekmeleri.
import { state, authors, seriesList, collator, displayTitle, computeScore, saveSettings, colorFor } from '../store.js';
import { esc, enc, ICON, booksView, hydrateCovers, $, $$ } from '../ui.js';

let statusFilter = '';
let sortBy = 'recent';

export const SORTS = {
  recent: ['Son eklenen', (a, b) => (b.createdAt || 0) - (a.createdAt || 0)],
  title: ['Kitap adı', (a, b) => collator.compare(displayTitle(a), displayTitle(b))],
  author: ['Yazar', (a, b) => collator.compare(a.author || '', b.author || '') || collator.compare(a.series || '', b.series || '') || (a.seriesOrder ?? 99) - (b.seriesOrder ?? 99)],
  score: ['Uyum puanı', (a, b) => (computeScore(b) ?? -1) - (computeScore(a) ?? -1)],
  year: ['Çıkış yılı (yeni → eski)', (a, b) => (b.pubYear ?? -1) - (a.pubYear ?? -1)],
  goodreads: ['Goodreads puanı', (a, b) => (b.goodreads ?? -1) - (a.goodreads ?? -1)],
  spicy: ['Spicy', (a, b) => (b.spicy ?? -1) - (a.spicy ?? -1)],
  updated: ['Son değişen', (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)],
};

export async function renderLibrary(view, [tab = 'books']) {
  const total = state.books.length;
  const tabs = `<div class="seg" role="tablist">
    ${[['books', 'Kitaplar'], ['authors', 'Yazarlar'], ['series', 'Seriler']].map(([k, l]) => `<button role="tab" class="${tab === k ? 'on' : ''}" data-go="${k}">${l}</button>`).join('')}
  </div>`;

  let body = '';
  if (!total) {
    body = `<div class="empty"><div class="big">📚</div><h2>Kitaplığın boş</h2>
      <p>İlk kitabını ekleyerek başla. Elinde Excel listesi varsa onu da tek seferde aktarabilirsin.</p>
      <div class="btn-row" style="justify-content:center"><a class="btn primary" href="#/edit/new">Kitap ekle</a><a class="btn" href="#/settings">Excel'den aktar</a></div></div>`;
  } else if (tab === 'books') body = booksTab();
  else if (tab === 'authors') body = authorsTab();
  else body = seriesTab();

  const v = state.settings.view;
  view.innerHTML = `
    <div class="page-head"><h1>Kitaplığım</h1>
      <div class="actions">${tab === 'books' && total ? `<button class="icon-btn" id="toggle-view" aria-label="Görünümü değiştir">${v === 'grid' ? ICON.list : ICON.grid}</button>` : ''}
      <a class="icon-btn" href="#/search" aria-label="Ara">${ICON.search}</a></div></div>
    ${tabs}${body}`;

  $$('[data-go]', view).forEach(b => b.addEventListener('click', () => location.replace(`#/library/${b.dataset.go}`)));
  $('#toggle-view', view)?.addEventListener('click', () => { state.settings.view = v === 'grid' ? 'list' : 'grid'; saveSettings(); });
  $$('[data-status]', view).forEach(c => c.addEventListener('click', () => { statusFilter = c.dataset.status; renderLibrary(view, [tab]); }));
  $('#tip-go', view)?.addEventListener('click', async () => (await import('./autofill.js')).openAutofill());
  $('#tip-x', view)?.addEventListener('click', () => { state.settings.hideCoverTip = true; saveSettings(); });
  $('#sort', view)?.addEventListener('change', e => { sortBy = e.target.value; renderLibrary(view, [tab]); });
  hydrateCovers(view);
}

function booksTab() {
  const counts = {};
  for (const b of state.books) counts[b.status] = (counts[b.status] || 0) + 1;
  const statuses = state.options.statuses.filter(s => counts[s.name]);
  let books = statusFilter === '♥' ? state.books.filter(b => b.favorite) : statusFilter ? state.books.filter(b => b.status === statusFilter) : [...state.books];
  books.sort(SORTS[sortBy][1]);
  const favs = state.books.filter(b => b.favorite).length;
  const noCover = state.books.filter(b => !b.coverTr && !b.coverOrig).length;
  const tip = noCover >= 5 && !state.settings.hideCoverTip
    ? `<div class="tip" id="cover-tip"><span style="font-size:24px">🖼️</span><button id="tip-go" style="border:0;background:none;text-align:left;padding:0;flex:1"><b>${noCover} kitabın kapağı yok</b><br><span class="small">Kapak ve özetleri internetten bul →</span></button><button class="x" id="tip-x" aria-label="Gizle">✕</button></div>`
    : '';
  return `${tip}
    <div class="chips">
      <button class="chip ${!statusFilter ? 'on' : ''}" data-status="">Tümü · ${state.books.length}</button>
      ${favs ? `<button class="chip ${statusFilter === '♥' ? 'on' : ''}" data-status="♥">❤️ Favoriler · ${favs}</button>` : ''}
      ${statuses.map(s => `<button class="chip ${statusFilter === s.name ? 'on' : ''}" data-status="${esc(s.name)}">${s.emoji} ${esc(s.name)} · ${counts[s.name]}</button>`).join('')}
    </div>
    <div class="result-bar"><span>${books.length} kitap</span>
      <label>Sırala: <select id="sort">${Object.entries(SORTS).map(([k, [l]]) => `<option value="${k}" ${k === sortBy ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    ${books.length ? booksView(books, state.settings.view) : '<div class="empty">Bu durumda kitap yok.</div>'}`;
}

function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toLocaleUpperCase('tr');
}

function authorsTab() {
  const list = authors();
  let html = `<div class="result-bar"><span>${list.length} yazar</span></div><div class="list">`;
  let letter = '';
  for (const a of list) {
    const L = a.name[0]?.toLocaleUpperCase('tr') || '#';
    if (L !== letter) { letter = L; html += `<div class="alpha-head">${esc(L)}</div>`; }
    const read = a.books.filter(b => b.status === 'Okundu').length;
    html += `<a class="row" href="#/author/${enc(a.name)}"><div class="avatar" style="background:${colorFor(a.name)}">${esc(initials(a.name))}</div>
      <div class="body"><div class="t">${esc(a.name)}</div><div class="s">${a.books.length} kitap${read ? ` · ${read} okundu` : ''}</div></div><span class="chev"></span></a>`;
  }
  return html + '</div>';
}

function seriesTab() {
  const list = seriesList();
  if (!list.length) return '<div class="empty">Henüz seri yok. Kitap eklerken "Seri" alanını doldurursan burada görünür.</div>';
  return `<div class="result-bar"><span>${list.length} seri</span></div><div class="list">${list.map(s => {
    const read = s.books.filter(b => b.status === 'Okundu').length;
    const reading = s.books.some(b => b.status === 'Okunuyor');
    const pct = Math.round((read / s.books.length) * 100);
    const first = s.books[0];
    return `<a class="row" href="#/series/${enc(s.name)}">
      <div class="cover" style="width:44px;flex:0 0 44px;box-shadow:none;border-radius:4px" ${first.coverTr || first.coverOrig ? `data-cover="${esc(first.coverTr || first.coverOrig)}"` : ''}>
        <div class="ph" style="background:${colorFor(s.name)}"><b style="font-size:7px">${esc(s.name)}</b></div></div>
      <div class="body"><div class="t">${esc(s.name)}</div>
        <div class="s">${esc(first.author || '')} · ${read}/${s.books.length} okundu${reading ? ' · 📖' : ''}</div>
        <div class="progress"><span style="width:${pct}%"></span></div></div><span class="chev"></span></a>`;
  }).join('')}</div>`;
}
