// Kitap detay sayfası.
import { state, getBook, saveBook, computeScore, CRITERIA, SPICY_LABELS, statusInfo, displayTitle, booksInSeries, booksByAuthor } from '../store.js';
import { esc, enc, ICON, coverHTML, bookCard, hydrateCovers, peppers, toast, sheet, $, $$ } from '../ui.js';

export function backButton(fallback = '#/') {
  return `<button class="icon-btn" data-back="${fallback}" aria-label="Geri">${ICON.back}</button>`;
}
export function wireBack(view) {
  $$('[data-back]', view).forEach(b => b.addEventListener('click', () => {
    if ((window.__navCount || 0) > 1) history.back();
    else location.hash = b.dataset.back;
  }));
}

const fmtDate = d => (d ? new Date(d + 'T00:00').toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }) : '');

export async function renderDetail(view, [id]) {
  const b = getBook(id);
  if (!b) { view.innerHTML = `<div class="topbar">${backButton()}<div class="title"></div></div><div class="empty">Kitap bulunamadı.</div>`; wireBack(view); return; }

  const score = computeScore(b);
  const hasTr = !!b.coverTr, hasOrig = !!b.coverOrig;
  const both = hasTr && hasOrig;
  const hero = both
    ? `<div class="hero"><div class="cv" data-zoom="${esc(b.coverTr)}">${coverHTML(b, { key: b.coverTr, badge: false })}<div class="lbl">Türkçe</div></div>
        <div class="cv" data-zoom="${esc(b.coverOrig)}">${coverHTML(b, { key: b.coverOrig, badge: false })}<div class="lbl">Orijinal</div></div></div>`
    : `<div class="hero single"><div class="cv" ${hasTr || hasOrig ? `data-zoom="${esc(b.coverTr || b.coverOrig)}"` : ''}>${coverHTML(b, { badge: false })}
        <div class="lbl">${hasTr ? 'Türkçe kapak' : hasOrig ? 'Orijinal kapak' : `<a href="#/edit/${enc(b.id)}" style="color:var(--accent)">＋ Kapak ekle</a>`}</div></div></div>`;

  const seriesBooks = b.series ? booksInSeries(b.series) : [];
  const authorBooks = b.author ? booksByAuthor(b.author).filter(x => x.id !== b.id && (!b.series || x.series !== b.series)) : [];

  // Seri devam uyarısı: sonraki kitabın Türkçesi yoksa.
  let seriesWarn = '';
  if (seriesBooks.length > 1) {
    const idx = seriesBooks.findIndex(x => x.id === b.id);
    const next = seriesBooks[idx + 1];
    if (next && next.translation && next.translation !== 'Var') seriesWarn = `<div class="warn">⚠️ <span>Serinin sonraki kitabı <b>${esc(displayTitle(next))}</b> için Türkçe çeviri durumu: <b>${esc(next.translation)}</b></span></div>`;
  }

  const info = [
    ['Yazar', b.author && `<a href="#/author/${enc(b.author)}" style="color:var(--accent)">${esc(b.author)}</a>`],
    ['Seri', b.series && `<a href="#/series/${enc(b.series)}" style="color:var(--accent)">${esc(b.series)}${b.seriesOrder ? ` #${b.seriesOrder}` : ''}</a>`],
    ['Tür', esc(b.genre)],
    ['Türkçe çeviri', esc(b.translation)],
    ['Yayınevi', esc(b.publisher)],
    ['Spicy', b.spicy !== null && b.spicy !== undefined ? `<span class="peppers" title="${esc(SPICY_LABELS[b.spicy] || '')}">${peppers(b.spicy)}</span>` : ''],
    ['Güven', esc(b.confidence)],
    ['Görsellerde var mı', esc(b.inVisuals)],
    ['Öncelik sırası', b.priority ? `#${b.priority}` : ''],
  ].filter(([, v]) => v);

  const scored = CRITERIA.filter(c => b.scores?.[c.key] !== undefined && b.scores?.[c.key] !== null && b.scores?.[c.key] !== '');

  view.innerHTML = `
    <div class="topbar">${backButton()}<div class="title">${esc(displayTitle(b))}</div>
      <button class="icon-btn" id="fav" aria-label="Favori" style="color:${b.favorite ? '#d6455d' : 'var(--accent)'}">${b.favorite ? ICON.heartFill : ICON.heart}</button>
      <a class="icon-btn" href="#/edit/${enc(b.id)}" aria-label="Düzenle">Düzenle</a></div>
    ${hero}
    <div class="d-title"><h1>${esc(displayTitle(b))}</h1>
      ${b.originalTitle && b.originalTitle !== b.title ? `<div class="orig">${esc(b.originalTitle)}</div>` : ''}
      ${b.author ? `<a class="by" href="#/author/${enc(b.author)}" style="display:inline-block">${esc(b.author)}</a>` : ''}
      ${b.series ? `<div class="ser">${esc(b.series)}${b.seriesOrder ? ` · ${b.seriesOrder}. kitap` : ''}</div>` : ''}</div>
    <div class="status-pick">${state.options.statuses.map(s => `<button class="chip ${b.status === s.name ? 'on' : ''}" data-st="${esc(s.name)}">${s.emoji} ${esc(s.name)}</button>`).join('')}</div>
    ${seriesWarn}
    ${score !== null || scored.length ? `<div class="section"><div class="bigscore"><div class="n">${score !== null ? score.toFixed(1) : '—'}</div><div><b>Genel uyum puanı</b><div class="muted small">5 üzerinden, ağırlıklı ortalama</div></div></div>
      <div class="bars">${scored.map(c => `<div class="bar"><span>${c.label}</span><div class="track"><span style="width:${(Number(b.scores[c.key]) / 5) * 100}%"></span></div><b>${b.scores[c.key]}</b></div>`).join('')}</div></div>` : ''}
    ${b.summary ? `<div class="section"><h3>Özet</h3><div class="prose">${esc(b.summary)}</div></div>` : ''}
    ${b.review ? `<div class="section"><h3>Kısa değerlendirme</h3><div class="prose">${esc(b.review)}</div></div>` : ''}
    ${info.length ? `<div class="section"><h3>Bilgiler</h3><dl class="kv">${info.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></div>` : ''}
    ${(b.warnings || []).length ? `<div class="section"><h3>İçerik uyarıları</h3><div class="tags">${b.warnings.map(w => `<span class="tag">⚠️ ${esc(w)}</span>`).join('')}</div></div>` : ''}
    ${(b.tags || []).length ? `<div class="section"><h3>Etiketler</h3><div class="tags">${b.tags.map(w => `<span class="tag"># ${esc(w)}</span>`).join('')}</div></div>` : ''}
    <div class="section"><h3>Benim okumam</h3>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><span>Puanım</span>
        <div class="stars" id="stars">${[1, 2, 3, 4, 5].map(n => `<button class="${(b.myRating || 0) >= n ? 'on' : ''}" data-r="${n}" aria-label="${n} yıldız">★</button>`).join('')}</div></div>
      <dl class="kv">${b.startDate ? `<dt>Başladım</dt><dd>${fmtDate(b.startDate)}</dd>` : ''}${b.endDate ? `<dt>Bitirdim</dt><dd>${fmtDate(b.endDate)}</dd>` : ''}</dl>
      ${b.notes ? `<div style="margin-top:10px"><div class="muted small">Notlarım</div><div class="prose">${esc(b.notes)}</div></div>` : ''}
      ${b.quotes ? `<div style="margin-top:10px"><div class="muted small">Alıntılar</div><div class="prose" style="font-family:var(--serif);font-style:italic">${esc(b.quotes)}</div></div>` : ''}
      ${!b.notes && !b.quotes ? `<a class="muted small" href="#/edit/${enc(b.id)}?focus=notes" style="display:block;margin-top:8px">＋ Not veya alıntı ekle</a>` : ''}
    </div>
    ${seriesBooks.length > 1 ? `<div class="section"><h3>Serinin kitapları · ${seriesBooks.filter(x => x.status === 'Okundu').length}/${seriesBooks.length}</h3>
      <div class="strip">${seriesBooks.map(x => bookCard(x, x.id === b.id ? 'current' : '')).join('')}</div></div>` : ''}
    ${authorBooks.length ? `<div class="section"><h3>Yazarın diğer kitapları</h3><div class="strip">${authorBooks.map(x => bookCard(x)).join('')}</div></div>` : ''}
  `;

  wireBack(view);
  hydrateCovers(view);
  $$('[data-st]', view).forEach(c => c.addEventListener('click', async () => {
    if (b.status === c.dataset.st) return;
    b.status = c.dataset.st;
    await saveBook(b);
    toast(`${statusInfo(b.status).emoji} ${b.status}`);
  }));
  $('#fav', view).addEventListener('click', async () => { b.favorite = !b.favorite; await saveBook(b); toast(b.favorite ? '❤️ Favorilere eklendi' : 'Favorilerden çıkarıldı'); });
  $$('[data-r]', view).forEach(s => s.addEventListener('click', async () => {
    const r = Number(s.dataset.r);
    b.myRating = b.myRating === r ? null : r;
    await saveBook(b);
  }));
  $$('[data-zoom]', view).forEach(z => z.addEventListener('click', () => {
    const img = z.querySelector('img');
    if (!img) return;
    sheet({ title: displayTitle(b), body: `<img src="${img.src}" alt="" style="width:100%;border-radius:10px">` });
  }));
}
