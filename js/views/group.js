// Yazar ve seri sayfaları.
import { state, booksByAuthor, booksInSeries, sortSeries, colorFor, collator, displayTitle, statusInfo } from '../store.js';
import { esc, enc, bookRow, booksView, hydrateCovers, $ } from '../ui.js';
import { backButton, wireBack } from './detail.js';

function statusSummary(books) {
  const c = {};
  for (const b of books) c[b.status] = (c[b.status] || 0) + 1;
  return Object.entries(c).map(([k, n]) => `${statusInfo(k).emoji} ${n}`).join('  ');
}

export async function renderAuthor(view, [name]) {
  const books = booksByAuthor(name);
  const series = new Map();
  const single = [];
  for (const b of books) {
    if (b.series) { if (!series.has(b.series)) series.set(b.series, []); series.get(b.series).push(b); }
    else single.push(b);
  }
  const groups = [...series.entries()].sort((a, b) => collator.compare(a[0], b[0]));
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toLocaleUpperCase('tr');

  view.innerHTML = `
    <div class="topbar">${backButton('#/library/authors')}<div class="title">${esc(name)}</div><span style="width:40px"></span></div>
    <div style="text-align:center;margin:8px 0 18px">
      <div class="avatar" style="width:72px;height:72px;font-size:26px;margin:0 auto 10px;background:${colorFor(name)}">${esc(initials)}</div>
      <h1 style="font-size:26px">${esc(name)}</h1>
      <div class="muted">${books.length} kitap${groups.length ? ` · ${groups.length} seri` : ''}</div>
      <div class="small" style="margin-top:4px">${statusSummary(books)}</div>
    </div>
    ${groups.map(([s, list]) => `<div class="section"><h3><a href="#/series/${enc(s)}">${esc(s)} ›</a></h3>
      <div class="list" style="box-shadow:none;margin:0 -14px -14px">${sortSeries(list).map(b => bookRow(b, { sub: `${b.seriesOrder ? b.seriesOrder + '. kitap' : ''}${b.originalTitle ? ' · ' + b.originalTitle : ''}` })).join('')}</div></div>`).join('')}
    ${single.length ? `<div class="section"><h3>${groups.length ? 'Tek kitaplar' : 'Kitaplar'}</h3><div class="list" style="box-shadow:none;margin:0 -14px -14px">${single.sort((a, b) => collator.compare(displayTitle(a), displayTitle(b))).map(b => bookRow(b, { sub: b.originalTitle || b.genre || '' })).join('')}</div></div>` : ''}
    <a class="btn block" href="#/edit/new?author=${enc(name)}">＋ Bu yazara kitap ekle</a>`;
  wireBack(view);
  hydrateCovers(view);
}

export async function renderSeries(view, [name]) {
  const books = booksInSeries(name);
  const read = books.filter(b => b.status === 'Okundu').length;
  const pct = books.length ? Math.round((read / books.length) * 100) : 0;
  const authorsSet = [...new Set(books.map(b => b.author).filter(Boolean))];
  const next = books.find(b => b.status !== 'Okundu' && b.status !== 'Elendi');
  const missingTr = books.filter(b => b.translation && b.translation !== 'Var');

  view.innerHTML = `
    <div class="topbar">${backButton('#/library/series')}<div class="title">${esc(name)}</div><span style="width:40px"></span></div>
    <div style="margin:4px 0 16px">
      <h1 style="font-size:26px">${esc(name)}</h1>
      <div class="muted">${authorsSet.map(a => `<a href="#/author/${enc(a)}" style="color:var(--accent);font-weight:600">${esc(a)}</a>`).join(', ')}</div>
      <div style="display:flex;justify-content:space-between;margin-top:12px;font-size:14px"><span>${read}/${books.length} okundu</span><span>%${pct}</span></div>
      <div class="progress" style="height:8px"><span style="width:${pct}%"></span></div>
    </div>
    ${next ? `<div class="warn" style="background:var(--accent-soft)">📍 <span>Sıradaki: <a href="#/book/${enc(next.id)}"><b>${next.seriesOrder ? next.seriesOrder + '. ' : ''}${esc(displayTitle(next))}</b></a>${next.translation && next.translation !== 'Var' ? ` — Türkçe: ${esc(next.translation)}` : ''}</span></div>` : read === books.length && books.length ? '<div class="warn" style="background:color-mix(in srgb, var(--ok) 15%, var(--surface))">🎉 <span>Seriyi bitirdin!</span></div>' : ''}
    ${missingTr.length ? `<div class="muted small" style="margin:0 2px 12px">Türkçesi olmayan / belirsiz: ${missingTr.map(b => esc(b.seriesOrder ? '#' + b.seriesOrder : displayTitle(b))).join(', ')}</div>` : ''}
    ${booksView(books, state.settings.view)}
    <a class="btn block" style="margin-top:18px" href="#/edit/new?series=${enc(name)}&author=${enc(authorsSet[0] || '')}&order=${books.length + 1}">＋ Seriye kitap ekle</a>`;
  wireBack(view);
  hydrateCovers(view);
}
