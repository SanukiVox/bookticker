// Arama: hangi alanda aranacağını seç, filtrele, sırala, filtreleri kaydet.
import { state, norm, authors, seriesList, computeScore, saveSettings, colorFor, OPTION_LISTS } from '../store.js';
import { esc, enc, ICON, booksView, hydrateCovers, sheet, promptSheet, toast, $, $$ } from '../ui.js';
import { SORTS } from './library.js';

const SCOPES = [
  ['all', 'Tümü'],
  ['title', 'Kitap adı'],
  ['originalTitle', 'Orijinal ad'],
  ['author', 'Yazar'],
  ['series', 'Seri'],
  ['notes', 'Notlar'],
];

const emptyFilters = () => ({
  status: [], genre: [], translation: [], publisher: [], confidence: [], tags: [], noWarnings: [],
  spicyMin: '', spicyMax: '', scoreMin: '', grMin: '', favorite: false, cover: '',
});

const S = {
  q: '',
  scope: 'all',
  sort: 'score',
  f: emptyFilters(),
};

function fieldsFor(b, scope) {
  switch (scope) {
    case 'title': return [b.title];
    case 'originalTitle': return [b.originalTitle];
    case 'author': return [b.author];
    case 'series': return [b.series];
    case 'notes': return [b.review, b.summary, b.notes, b.quotes];
    default: return [b.title, b.originalTitle, b.author, b.series, b.publisher, b.genre, b.review, b.summary, b.notes, ...(b.tags || [])];
  }
}

function activeCount(f) {
  let n = 0;
  for (const k of ['status', 'genre', 'translation', 'publisher', 'confidence', 'tags', 'noWarnings']) n += f[k].length;
  for (const k of ['spicyMin', 'spicyMax', 'scoreMin', 'grMin', 'cover']) if (f[k] !== '') n++;
  if (f.favorite) n++;
  return n;
}

export function applyFilters(books, f, q = '', scope = 'all') {
  const nq = norm(q);
  const words = nq ? nq.split(' ') : [];
  return books.filter(b => {
    if (words.length) {
      const hay = norm(fieldsFor(b, scope).filter(Boolean).join(' | '));
      if (!words.every(w => hay.includes(w))) return false;
    }
    if (f.status.length && !f.status.includes(b.status)) return false;
    if (f.genre.length && !f.genre.includes(b.genre)) return false;
    if (f.translation.length && !f.translation.includes(b.translation)) return false;
    if (f.publisher.length && !f.publisher.includes(b.publisher)) return false;
    if (f.confidence.length && !f.confidence.includes(b.confidence)) return false;
    if (f.tags.length && !f.tags.some(t => (b.tags || []).includes(t))) return false;
    if (f.noWarnings.length && f.noWarnings.some(t => (b.warnings || []).includes(t))) return false;
    if (f.spicyMin !== '' && (b.spicy ?? -1) < Number(f.spicyMin)) return false;
    if (f.spicyMax !== '' && (b.spicy === null || b.spicy === undefined || b.spicy > Number(f.spicyMax))) return false;
    if (f.grMin === 'none') { if (b.goodreads) return false; }
    else if (f.grMin !== '' && (b.goodreads ?? -1) < Number(f.grMin)) return false;
    if (f.scoreMin !== '') { const s = computeScore(b); if (s === null || s < Number(f.scoreMin)) return false; }
    if (f.favorite && !b.favorite) return false;
    if (f.cover === 'yes' && !(b.coverTr || b.coverOrig)) return false;
    if (f.cover === 'no' && (b.coverTr || b.coverOrig)) return false;
    return true;
  });
}

export async function renderSearch(view, _p, query) {
  // Başka ekrandan hazır filtreyle gelinebilir: #/search?status=Okundu
  if (query && [...query.keys()].length) {
    S.f = emptyFilters(); S.q = '';
    for (const [k, v] of query) if (Array.isArray(S.f[k])) S.f[k] = [v]; else if (k in S.f) S.f[k] = v;
    history.replaceState(null, '', '#/search');
  }
  view.innerHTML = `
    <div class="page-head"><h1>Ara</h1></div>
    <div class="searchbox">${ICON.search}<input id="q" type="search" inputmode="search" enterkeyhint="search" placeholder="Kitap, yazar, seri ara…" value="${esc(S.q)}" autocomplete="off" autocorrect="off" spellcheck="false"><button class="clear ${S.q ? '' : 'hidden'}" id="clear" aria-label="Temizle">✕</button></div>
    <div class="chips" id="scopes">${SCOPES.map(([k, l]) => `<button class="chip ${S.scope === k ? 'on' : ''}" data-scope="${k}">${l}</button>`).join('')}</div>
    <div id="filterbar"></div>
    <div id="results"></div>`;

  const q = $('#q', view);
  q.addEventListener('input', () => { S.q = q.value; $('#clear', view).classList.toggle('hidden', !S.q); renderResults(view); });
  q.addEventListener('keydown', e => { if (e.key === 'Enter') q.blur(); });
  $('#clear', view).addEventListener('click', () => { S.q = ''; q.value = ''; q.focus(); $('#clear', view).classList.add('hidden'); renderResults(view); });
  $$('[data-scope]', view).forEach(c => c.addEventListener('click', () => {
    S.scope = c.dataset.scope;
    $$('[data-scope]', view).forEach(x => x.classList.toggle('on', x === c));
    q.placeholder = S.scope === 'all' ? 'Kitap, yazar, seri ara…' : `${c.textContent} içinde ara…`;
    renderResults(view);
  }));
  renderFilterBar(view);
  renderResults(view);
}

function renderFilterBar(view) {
  const n = activeCount(S.f);
  const saved = state.settings.savedFilters || [];
  const bar = $('#filterbar', view);
  const pills = [];
  for (const k of ['status', 'genre', 'translation', 'publisher', 'confidence', 'tags']) for (const v of S.f[k]) pills.push([k, v, v]);
  for (const v of S.f.noWarnings) pills.push(['noWarnings', v, `${v} olmasın`]);
  if (S.f.spicyMin !== '') pills.push(['spicyMin', '', `Spicy ≥ ${S.f.spicyMin}`]);
  if (S.f.spicyMax !== '') pills.push(['spicyMax', '', `Spicy ≤ ${S.f.spicyMax}`]);
  if (S.f.scoreMin !== '') pills.push(['scoreMin', '', `Uyum ≥ ${S.f.scoreMin}`]);
  if (S.f.grMin !== '') pills.push(['grMin', '', S.f.grMin === 'none' ? 'Goodreads puanı yok' : `Goodreads ≥ ${S.f.grMin}`]);
  if (S.f.favorite) pills.push(['favorite', '', '❤️ Favori']);
  if (S.f.cover) pills.push(['cover', '', S.f.cover === 'yes' ? 'Kapaklı' : 'Kapaksız']);

  bar.innerHTML = `<div class="chips">
      <button class="chip ${n ? 'on' : ''}" id="open-filters">${ICON.filter.replace('<svg', '<svg width="16" height="16" style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round"')} Filtreler${n ? ` · ${n}` : ''}</button>
      ${pills.map(([k, v, l]) => `<button class="chip" data-rm="${k}" data-v="${esc(v)}">${esc(l)} <span class="x">✕</span></button>`).join('')}
      ${n ? '<button class="chip" id="save-filter">＋ Kaydet</button>' : ''}
      ${!n ? saved.map((s, i) => `<button class="chip" data-saved="${i}">⭐ ${esc(s.name)}</button>`).join('') : ''}
    </div>`;
  $('#open-filters', bar).addEventListener('click', () => openFilterSheet(view));
  $$('[data-rm]', bar).forEach(c => c.addEventListener('click', () => {
    const k = c.dataset.rm;
    if (Array.isArray(S.f[k])) S.f[k] = S.f[k].filter(x => x !== c.dataset.v);
    else S.f[k] = k === 'favorite' ? false : '';
    renderFilterBar(view); renderResults(view);
  }));
  $$('[data-saved]', bar).forEach(c => c.addEventListener('click', () => {
    S.f = { ...emptyFilters(), ...structuredClone(saved[Number(c.dataset.saved)].f) };
    renderFilterBar(view); renderResults(view);
  }));
  $('#save-filter', bar)?.addEventListener('click', async () => {
    const name = await promptSheet('Filtreyi kaydet', { placeholder: 'Örn. Türkçesi var, az spicy' });
    if (!name) return;
    state.settings.savedFilters = [...saved, { name, f: structuredClone(S.f) }];
    await saveSettings();
    toast('Filtre kaydedildi');
  });
}

function renderResults(view) {
  const res = $('#results', view);
  let books = applyFilters(state.books, S.f, S.q, S.scope);
  books.sort(SORTS[S.sort][1]);
  const nq = norm(S.q);
  let top = '';
  // Yazar ya da seri aranırsa önce eşleşen yazar/seri sayfalarını göster.
  if (nq && (S.scope === 'author' || S.scope === 'all')) {
    const as = authors().filter(a => norm(a.name).includes(nq)).slice(0, 6);
    if (as.length) top += `<h3 style="margin:6px 0 8px">Yazarlar</h3><div class="list" style="margin-bottom:16px">${as.map(a => `<a class="row" href="#/author/${enc(a.name)}"><div class="avatar" style="background:${colorFor(a.name)}">${esc(a.name.split(/\s+/).slice(0, 2).map(w => w[0]).join(''))}</div><div class="body"><div class="t">${esc(a.name)}</div><div class="s">${a.books.length} kitap</div></div><span class="chev"></span></a>`).join('')}</div>`;
  }
  if (nq && (S.scope === 'series' || S.scope === 'all')) {
    const ss = seriesList().filter(s => norm(s.name).includes(nq)).slice(0, 6);
    if (ss.length) top += `<h3 style="margin:6px 0 8px">Seriler</h3><div class="list" style="margin-bottom:16px">${ss.map(s => `<a class="row" href="#/series/${enc(s.name)}"><div class="body"><div class="t">${esc(s.name)}</div><div class="s">${s.books.length} kitap · ${s.books.filter(b => b.status === 'Okundu').length} okundu</div></div><span class="chev"></span></a>`).join('')}</div>`;
  }
  const searching = nq || activeCount(S.f);
  res.innerHTML = `${top}
    <div class="result-bar"><span>${searching ? `${books.length} sonuç` : `Tüm kitaplar · ${books.length}`}</span>
      <label>Sırala: <select id="ssort">${Object.entries(SORTS).map(([k, [l]]) => `<option value="${k}" ${k === S.sort ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    ${books.length ? booksView(books, state.settings.view) : `<div class="empty"><div class="big">🔍</div>Eşleşen kitap bulunamadı.</div>`}`;
  $('#ssort', res).addEventListener('change', e => { S.sort = e.target.value; renderResults(view); });
  hydrateCovers(res);
}

function openFilterSheet(view) {
  const f = structuredClone(S.f);
  const multi = (key, title) => {
    const opts = state.options[optKey(key)];
    if (!opts?.length) return '';
    return `<div class="f-block"><h3>${title}</h3><div class="chip-wrap">${opts.map(o => `<button class="chip ${f[key].includes(o.name) ? 'on' : ''}" data-k="${key}" data-v="${esc(o.name)}">${o.emoji ? o.emoji + ' ' : ''}${esc(o.name)}</button>`).join('')}</div></div>`;
  };
  const num = (key, from, to, step = 1) => {
    const vals = []; for (let v = from; v <= to + 1e-9; v += step) vals.push(Math.round(v * 10) / 10);
    return `<select data-num="${key}"><option value="">Farketmez</option>${vals.map(v => `<option value="${v}" ${String(f[key]) === String(v) ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
  };
  const body = `
    ${multi('status', 'Okuma durumu')}
    ${multi('genre', 'Tür')}
    ${multi('translation', 'Türkçe çeviri')}
    <div class="f-block"><h3>Spicy (0–5)</h3><div class="range-row">En az ${num('spicyMin', 0, 5)} En çok ${num('spicyMax', 0, 5)}</div></div>
    <div class="f-block"><h3>Genel uyum puanı</h3><div class="range-row">En az ${num('scoreMin', 1, 5, 0.5)}</div></div>
    <div class="f-block"><h3>Goodreads puanı</h3><div class="range-row"><select data-num="grMin"><option value="">Farketmez</option>${['3.5', '3.75', '4', '4.25', '4.5'].map(v => `<option value="${v}" ${f.grMin === v ? 'selected' : ''}>En az ${v.replace('.', ',')}</option>`).join('')}<option value="none" ${f.grMin === 'none' ? 'selected' : ''}>Puanı girilmemiş</option></select></div></div>
    ${multi('publisher', 'Yayınevi')}
    ${multi('confidence', 'Güven')}
    ${multi('tags', 'Etiketler')}
    ${state.options.warnings.length ? `<div class="f-block"><h3>Bu içerik uyarıları OLMASIN</h3><div class="chip-wrap">${state.options.warnings.map(o => `<button class="chip ${f.noWarnings.includes(o.name) ? 'on' : ''}" data-k="noWarnings" data-v="${esc(o.name)}">${esc(o.name)}</button>`).join('')}</div></div>` : ''}
    <div class="f-block"><h3>Diğer</h3><div class="chip-wrap">
      <button class="chip ${f.favorite ? 'on' : ''}" data-flag="favorite">❤️ Sadece favoriler</button>
      <button class="chip ${f.cover === 'yes' ? 'on' : ''}" data-cover="yes">🖼️ Kapağı olan</button>
      <button class="chip ${f.cover === 'no' ? 'on' : ''}" data-cover="no">▫️ Kapağı olmayan</button></div></div>`;
  sheet({
    title: 'Filtreler',
    body,
    foot: '<button class="btn" id="f-reset">Temizle</button><button class="btn primary" id="f-apply">Göster</button>',
    onMount: (el, close) => {
      const count = () => { $('#f-apply', el).textContent = `${applyFilters(state.books, f, S.q, S.scope).length} kitabı göster`; };
      $$('[data-k]', el).forEach(c => c.addEventListener('click', () => {
        const k = c.dataset.k, v = c.dataset.v;
        f[k] = f[k].includes(v) ? f[k].filter(x => x !== v) : [...f[k], v];
        c.classList.toggle('on'); count();
      }));
      $$('[data-num]', el).forEach(s => s.addEventListener('change', () => { f[s.dataset.num] = s.value; count(); }));
      $('[data-flag]', el).addEventListener('click', e => { f.favorite = !f.favorite; e.currentTarget.classList.toggle('on'); count(); });
      $$('[data-cover]', el).forEach(c => c.addEventListener('click', () => {
        f.cover = f.cover === c.dataset.cover ? '' : c.dataset.cover;
        $$('[data-cover]', el).forEach(x => x.classList.toggle('on', x.dataset.cover === f.cover)); count();
      }));
      $('#f-reset', el).addEventListener('click', () => { S.f = emptyFilters(); close(); renderFilterBar(view); renderResults(view); });
      $('#f-apply', el).addEventListener('click', () => { S.f = f; close(); renderFilterBar(view); renderResults(view); });
      count();
    },
  });
}

// Filtre anahtarını seçenek listesi adına çevir (status → statuses).
function optKey(field) {
  return Object.keys(OPTION_LISTS).find(k => OPTION_LISTS[k].field === field) || field;
}
