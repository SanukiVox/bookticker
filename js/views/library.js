// Kitaplık: Kitaplar / Yazarlar / Seriler sekmeleri.
import { state, authors, seriesList, collator, displayTitle, computeScore, computeQuality, saveSettings, colorFor } from '../store.js';
import { esc, enc, ICON, booksView, hydrateCovers, $, $$, coverHTML } from '../ui.js';

let statusFilter = '';
let trOnly = false; // yalnızca Türkçesi olanlar (durum filtresiyle birlikte çalışır)
let fileOnly = false; // yalnızca dosyası (PDF/EPUB) eklenmiş olanlar
let ownedOnly = false; // yalnızca kütüphanemde (basılı) olanlar
const hasFile = b => !!(b.file || b.file2);
const hasTr = b => b.translation === 'Var';
let sortBy = 'recent';

export const SORTS = {
  recent: ['Son eklenen', (a, b) => (b.createdAt || 0) - (a.createdAt || 0)],
  title: ['Kitap adı', (a, b) => collator.compare(displayTitle(a), displayTitle(b))],
  author: ['Yazar', (a, b) => collator.compare(a.author || '', b.author || '') || collator.compare(a.series || '', b.series || '') || (a.seriesOrder ?? 99) - (b.seriesOrder ?? 99)],
  score: ['Romantizm puanı', (a, b) => (computeScore(b) ?? -1) - (computeScore(a) ?? -1)],
  quality: ['Genel puan', (a, b) => (computeQuality(b) ?? -1) - (computeQuality(a) ?? -1)],
  year: ['Çıkış yılı (yeni → eski)', (a, b) => (b.pubYear ?? -1) - (a.pubYear ?? -1)],
  goodreads: ['Goodreads puanı', (a, b) => (b.goodreads ?? -1) - (a.goodreads ?? -1)],
  spicy: ['Spicy', (a, b) => (b.spicy ?? -1) - (a.spicy ?? -1)],
  updated: ['Son değişen', (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)],
};

export async function renderLibrary(view, [tab = 'books']) {
  const total = state.books.length;
  // Yeni cihaz (veri yok, eşitleme kurulmamış): doğrudan giriş sayfası
  if (!total && !state.guest && !(await import('../sync.js')).isConfigured()) return (await import('./sharing.js')).renderLogin(view, { landing: true });
  const tabs = `<div class="seg" role="tablist">
    ${[['books', 'Kitaplar'], ['authors', 'Yazarlar'], ['series', 'Seriler']].map(([k, l]) => `<button role="tab" class="${tab === k ? 'on' : ''}" data-go="${k}">${l}</button>`).join('')}
  </div>`;

  let body = '';
  if (!total) {
    body = `<div class="empty"><div class="big">📚</div><h2>Kitaplığın boş</h2>
      <p>İlk kitabını ekleyerek başla. Elinde Excel listesi varsa onu da tek seferde aktarabilirsin.</p>
      <div class="btn-row" style="justify-content:center"><a class="btn primary" href="#/edit/new">Kitap ekle</a><a class="btn" href="#/settings">Excel'den aktar</a></div><p class="muted small" style="margin-top:14px">Sana kullanıcı adı ve şifre verildiyse: <a href="#/giris" style="text-decoration:underline">Kullanıcı girişi</a></p></div>`;
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
  $('#tr-only', view)?.addEventListener('click', () => { trOnly = !trOnly; renderLibrary(view, [tab]); });
  $('#file-only', view)?.addEventListener('click', () => { fileOnly = !fileOnly; renderLibrary(view, [tab]); });
  $('#owned-only', view)?.addEventListener('click', () => { ownedOnly = !ownedOnly; renderLibrary(view, [tab]); });
  $('#tip-go', view)?.addEventListener('click', async () => (await import('./autofill.js')).openAutofill());
  $('#tip-x', view)?.addEventListener('click', () => { state.settings.hideCoverTip = true; saveSettings(); });
  $('#sort', view)?.addEventListener('change', e => { sortBy = e.target.value; renderLibrary(view, [tab]); });
  hydrateCovers(view);
}

function booksTab() {
  const pool = state.books.filter(b => (!trOnly || hasTr(b)) && (!fileOnly || hasFile(b)) && (!ownedOnly || b.owned));
  const ownedCount = state.books.filter(b => b.owned).length;
  const fileCount = state.books.filter(hasFile).length;
  const trCount = state.books.filter(hasTr).length;
  const counts = {};
  for (const b of pool) counts[b.status] = (counts[b.status] || 0) + 1;
  const statuses = state.options.statuses.filter(s => counts[s.name] || statusFilter === s.name);
  let books = statusFilter === '♥' ? pool.filter(b => b.favorite) : statusFilter ? pool.filter(b => b.status === statusFilter) : [...pool];
  books.sort(SORTS[sortBy][1]);
  const favs = pool.filter(b => b.favorite).length;
  const noCover = state.books.filter(b => !b.coverTr && !b.coverOrig).length;
  const tip = noCover >= 5 && !state.settings.hideCoverTip
    ? `<div class="tip" id="cover-tip"><span style="font-size:24px">🖼️</span><button id="tip-go" style="border:0;background:none;text-align:left;padding:0;flex:1"><b>${noCover} kitabın kapağı yok</b><br><span class="small">Kapak ve özetleri internetten bul →</span></button><button class="x" id="tip-x" aria-label="Gizle">✕</button></div>`
    : '';
  return `${tip}
    <div class="chips">
      <button class="chip ${!statusFilter ? 'on' : ''}" data-status="">Tümü · ${pool.length}</button>
      ${favs || statusFilter === '♥' ? `<button class="chip ${statusFilter === '♥' ? 'on' : ''}" data-status="♥">❤️ Favoriler · ${favs}</button>` : ''}
      ${statuses.map(s => `<button class="chip ${statusFilter === s.name ? 'on' : ''}" data-status="${esc(s.name)}">${s.emoji} ${esc(s.name)} · ${counts[s.name] || 0}</button>`).join('')}
    </div>
    <div class="chips">
      <button class="chip ${trOnly ? 'on' : ''}" id="tr-only" aria-pressed="${trOnly}">🇹🇷 Türkçesi olanlar · ${trCount}</button>
      ${fileCount || fileOnly ? `<button class="chip ${fileOnly ? 'on' : ''}" id="file-only" aria-pressed="${fileOnly}">📄 Dosyası olanlar · ${fileCount}</button>` : ''}
      ${ownedCount || ownedOnly ? `<button class="chip ${ownedOnly ? 'on' : ''}" id="owned-only" aria-pressed="${ownedOnly}">📚 Kütüphanemde · ${ownedCount}</button>` : ''}
    </div>
    <div class="result-bar"><span>${books.length} kitap</span>
      <label>Sırala: <select id="sort">${Object.entries(SORTS).map(([k, [l]]) => `<option value="${k}" ${k === sortBy ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    ${books.length ? booksView(books, state.settings.view) : `<div class="empty">${trOnly || fileOnly || ownedOnly ? 'Seçili filtrelere uyan kitap yok.' : 'Bu durumda kitap yok.'}</div>`}`;
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
  // Her seri bir kart: üstte adı ve ilerlemesi, altında tüm kapaklar sırasıyla yan yana (yatay kaydırılır)
  return `<div class="result-bar"><span>${list.length} seri</span></div><div class="ser-list">${list.map(s => {
    const read = s.books.filter(b => b.status === 'Okundu').length;
    const reading = s.books.some(b => b.status === 'Okunuyor');
    const pct = Math.round((read / s.books.length) * 100);
    const authorsTxt = [...new Set(s.books.map(b => b.author).filter(Boolean))].join(', ');
    const covers = s.books.map(b => `<a class="ser-book ${b.status === 'Okundu' ? 'done' : ''}" href="#/book/${enc(b.id)}" title="${esc(displayTitle(b))}">
        ${coverHTML(b)}<span class="ser-no">${b.seriesOrder != null ? `#${esc(String(b.seriesOrder))}` : '•'}</span></a>`).join('');
    return `<div class="ser-card">
      <a class="ser-head" href="#/series/${enc(s.name)}">
        <div class="body"><div class="t">${esc(s.name)}</div>
          <div class="s">${esc(authorsTxt)} · ${s.books.length} kitap · ${read}/${s.books.length} okundu${reading ? ' · 📖' : ''}</div></div>
        <span class="chev"></span></a>
      <div class="ser-strip">${covers}</div>
      <div class="progress ser-prog"><span style="width:${pct}%"></span></div>
    </div>`;
  }).join('')}</div>`;
}
