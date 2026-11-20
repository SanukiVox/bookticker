// Kitap detay sayfası.
import { goodreadsUrl, formatVotes, formatPubDate, isUpcoming, computeQuality, QUALITY, qualityWord } from '../store.js';
import { state, getBook, saveBook, computeScore, CRITERIA, SPICY_LABELS, statusInfo, displayTitle, booksInSeries, booksByAuthor } from '../store.js';
import { esc, enc, ICON, coverHTML, bookCard, hydrateCovers, peppers, toast, sheet, $, $$, coverKeyOf, fmtScore } from '../ui.js';
import { fileSectionShell, fillFileSection } from './bookfile.js';
import { formatDuration } from '../files.js';
import { similarTo } from '../similar.js';
import { vocabSection } from './vocab.js';
import { openFinished } from './finished.js';
import { highlightsSection, wireHighlights } from './highlights.js';

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

// Baş harfi büyük (Türkçe)
const cap = v => { const t = String(v || '').trim(); return t ? t[0].toLocaleUpperCase('tr') + t.slice(1) : t; };

export async function renderDetail(view, [id]) {
  const b = getBook(id);
  if (!b) { view.innerHTML = `<div class="topbar">${backButton()}<div class="title"></div></div><div class="empty">Kitap bulunamadı.</div>`; wireBack(view); return; }

  const score = computeScore(b);
  const hasTr = !!b.coverTr, hasOrig = !!b.coverOrig;
  const both = hasTr && hasOrig;
  const hero = both
    ? `<div class="hero">${(state.settings.coverPref === 'orig' ? [[b.coverOrig, 'Orijinal'], [b.coverTr, 'Türkçe']] : [[b.coverTr, 'Türkçe'], [b.coverOrig, 'Orijinal']])
        .map(([k, l]) => `<div class="cv" data-zoom="${esc(k)}">${coverHTML(b, { key: k, badge: false })}<div class="lbl">${l}</div></div>`).join('')}</div>`
    : `<div class="hero single"><div class="cv" ${hasTr || hasOrig ? `data-zoom="${esc(coverKeyOf(b))}"` : ''}>${coverHTML(b, { badge: false })}
        <div class="lbl">${hasTr ? 'Türkçe kapak' : hasOrig ? 'Orijinal kapak' : `<a href="#/edit/${enc(b.id)}?find=tr" style="color:var(--accent)">🔍 Kapak bul</a>`}</div></div></div>`;

  const seriesBooks = b.series ? booksInSeries(b.series) : [];
  const similar = similarTo(b, 10);
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
    ['Yayın yılı', b.pubYear ? esc(b.pubYear) : ''],
    ['Türkçe çıkış', b.trDate ? `${esc(formatPubDate(b.trDate))}${isUpcoming(b) ? ' · 🗓️ yakında' : ''}` : ''],
    ['Spicy', b.spicy !== null && b.spicy !== undefined ? `<span class="peppers" title="${esc(SPICY_LABELS[Math.floor(b.spicy)] || '')}">${peppers(b.spicy)}</span>` : ''],
    ['Güven', esc(b.confidence)],
    ['Görsellerde var mı', esc(b.inVisuals)],
    ['Öncelik sırası', b.priority ? `#${b.priority}` : ''],
  ].filter(([, v]) => v);

  const scored = CRITERIA.filter(c => b.scores?.[c.key] !== undefined && b.scores?.[c.key] !== null && b.scores?.[c.key] !== '');

  const hasSpicy = b.spicy !== null && b.spicy !== undefined && b.spicy !== '';
  const qual = computeQuality(b);
  const qscored = QUALITY.filter(c => b.quality?.[c.key] != null && b.quality[c.key] !== '');
  view.innerHTML = `
    <div class="topbar">${backButton()}<div class="title">${esc(displayTitle(b))}</div>
      <button class="icon-btn" id="fav" aria-label="Favori" style="color:${b.favorite ? '#d6455d' : 'var(--accent)'}">${b.favorite ? ICON.heartFill : ICON.heart}</button>
      <a class="icon-btn" href="#/edit/${enc(b.id)}" aria-label="Düzenle">Düzenle</a></div>
    ${hero}
    <div class="d-title"><h1>${esc(displayTitle(b))}</h1>
      ${b.originalTitle && b.originalTitle !== b.title ? `<div class="orig">${esc(b.originalTitle)}</div>` : ''}
      ${b.author ? `<a class="by" href="#/author/${enc(b.author)}" style="display:inline-block">${esc(b.author)}</a>` : ''}
      ${b.series ? `<div class="ser">${esc(b.series)}${b.seriesOrder ? ` · ${b.seriesOrder}. kitap` : ''}</div>` : ''}
      ${b.owned ? '<div class="owned-tag">📚 Kütüphanemde</div>' : ''}
      <div class="admin-only" style="margin-top:8px"><button class="chip ${b.shared ? 'on' : ''}" id="share-tg">👥 ${b.shared ? 'Paylaşıldı' : 'Paylaş'}</button>${b.shared && (b.file || b.file2) ? ` <button class="chip ${b.shareFile ? 'on' : ''}" id="sharefile-tg">📄 ${b.shareFile ? 'Dosyası paylaşıldı' : 'Dosyasını da paylaş'}</button>` : ''}</div></div>
    <div class="status-pick">${state.options.statuses.map(s => `<button class="chip ${b.status === s.name ? 'on' : ''}" data-st="${esc(s.name)}">${s.emoji} ${esc(s.name)}</button>`).join('')}</div>
    ${seriesWarn}
    ${state.guest && (b.file || b.file2) ? guestReadHTML(b) : ''}
    ${fileSectionShell()}
    ${vocabSection(b)}
    ${highlightsSection(b)}
    <div class="section gr-row"><span class="gr-badge">g</span>
      ${b.goodreads ? `<div style="flex:1"><b style="font-size:20px">★ ${String(b.goodreads.toFixed(2)).replace('.', ',')}</b> <span class="muted small">Goodreads${b.goodreadsVotes ? ` · ${formatVotes(b.goodreadsVotes)}` : ''}</span></div>`
        : '<div style="flex:1" class="muted">Goodreads puanı girilmemiş</div>'}
      <button class="mini-btn" id="gr-edit">${b.goodreads ? 'Güncelle' : '＋ Ekle'}</button></div>
    ${score !== null || scored.length ? `<div class="section"><div class="bigscore"><div class="n">${score !== null ? score.toFixed(1) : '—'}</div><div><b>💗 Romantizm puanı</b><div class="muted small">Senin zevkine uyum · 5 üzerinden</div></div></div>
      <div class="bars">${scored.map(c => `<div class="bar"><span>${c.label}</span><div class="track"><span style="width:${(Number(b.scores[c.key]) / 5) * 100}%"></span></div><b>${fmtScore(b.scores[c.key])}</b></div>`).join('')}</div></div>` : ''}
    ${qual !== null || qscored.length ? `<div class="section"><div class="bigscore"><div class="n q">${qual !== null ? qual.toFixed(2).replace('.', ',') : '—'}</div><div><b>⭐ Genel puan${qual !== null ? ` · ${qualityWord(qual)}` : ''}</b><div class="muted small">Kitabın kendi başına ne kadar iyi olduğu · 5 üzerinden${b.qualityConf ? ` · ${esc(b.qualityConf)}` : ''}</div></div></div>
      <div class="bars q">${qscored.map(c => `<div class="bar"><span>${c.label}</span><div class="track"><span style="width:${(Number(b.quality[c.key]) / 5) * 100}%"></span></div><b>${fmtScore(b.quality[c.key])}</b></div>`).join('')}</div></div>` : ''}
    ${scored.length || qscored.length || hasSpicy || b.goodreads ? `<div class="section basis"><div style="display:flex;align-items:center;gap:8px"><h3 style="flex:1;margin:0">ℹ️ Puanların dayanağı</h3>${b.file || b.file2 ? '<button class="mini-btn" id="basis-reeval">🔎 Yeniden değerlendir</button>' : ''}<button class="mini-btn" id="basis-guide">📏 Tablo</button></div>
      <dl class="kv" style="margin-top:8px">
        ${scored.length ? `<dt>💗 Romantizm</dt><dd>${esc(cap(b.scoreNote || b.confidence || 'Tahmin'))}</dd>` : ''}
        ${hasSpicy ? `<dt>🌶️ Spicy ${fmtScore(b.spicy)}</dt><dd>${esc(SPICY_LABELS[Math.floor(b.spicy)] || '')}<div class="muted small" style="margin-top:2px">Dayanak: ${esc(cap(b.spicyNote || 'Tahmin'))}</div></dd>` : ''}
        ${qscored.length ? `<dt>⭐ Genel</dt><dd>${esc(b.qualityConf || 'Belirtilmemiş')}</dd>` : ''}
        ${b.goodreads ? `<dt>📗 Goodreads</dt><dd>${String(b.goodreads.toFixed(2)).replace('.', ',')}${b.goodreadsVotes ? ` · ${formatVotes(b.goodreadsVotes)}` : ''}</dd>` : ''}
      </dl></div>` : ''}
    ${b.summary ? `<div class="section"><h3>Özet</h3><div class="prose clampable">${esc(b.summary)}</div></div>`
      : `<a class="section" href="#/edit/${enc(b.id)}?summary=1" style="display:flex;align-items:center;gap:10px"><span style="font-size:22px">📝</span><span style="flex:1"><b>Özet / tanıtım yazısı ekle</b><br><span class="muted small">İnternetten bul ya da kopyaladığın yazıyı yapıştır</span></span><span class="chev" style="width:8px;height:8px;border-right:2px solid var(--text-3);border-top:2px solid var(--text-3);transform:rotate(45deg)"></span></a>`}
    ${b.review ? `<div class="section"><h3>Kısa değerlendirme</h3><div class="prose clampable">${esc(b.review)}</div></div>` : ''}
    ${info.length ? `<div class="section"><h3>Bilgiler</h3><dl class="kv">${info.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></div>` : ''}
    ${(b.warnings || []).length ? `<div class="section"><h3>İçerik uyarıları</h3><div class="tags">${b.warnings.map(w => `<span class="tag">⚠️ ${esc(w)}</span>`).join('')}</div></div>` : ''}
    ${(b.tags || []).length ? `<div class="section"><h3>Etiketler</h3><div class="tags">${b.tags.map(w => `<span class="tag"># ${esc(w)}</span>`).join('')}</div></div>` : ''}
    <div class="section my-reading"><h3>Benim okumam</h3>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><span>Puanım</span>
        <div style="display:flex;align-items:center;gap:8px"><div class="stars" id="stars">${[1, 2, 3, 4, 5].map(n => `<button class="${(b.myRating || 0) >= n ? 'on' : (b.myRating || 0) >= n - 0.5 ? 'half' : ''}" data-r="${n}" aria-label="${n} yıldız">★</button>`).join('')}</div>
        <b class="small" style="min-width:24px">${b.myRating ? fmtScore(b.myRating) : ''}</b></div></div>
      <dl class="kv">${b.startDate ? `<dt>Başladım</dt><dd>${fmtDate(b.startDate)}</dd>` : ''}${b.endDate ? `<dt>Bitirdim</dt><dd>${fmtDate(b.endDate)}</dd>` : ''}</dl>
      ${b.notes ? `<div style="margin-top:10px"><div class="muted small">Notlarım</div><div class="prose clampable">${esc(b.notes)}</div></div>` : ''}
      ${b.quotes ? `<div style="margin-top:10px"><div class="muted small">Alıntılar</div><div class="prose clampable" style="font-family:var(--serif);font-style:italic">${esc(b.quotes)}</div></div>` : ''}
      ${!b.notes && !b.quotes ? `<a class="muted small" href="#/edit/${enc(b.id)}?focus=notes" style="display:block;margin-top:8px">＋ Not veya alıntı ekle</a>` : ''}
    </div>
    ${seriesBooks.length > 1 ? `<div class="section"><h3>Serinin kitapları · ${seriesBooks.filter(x => x.status === 'Okundu').length}/${seriesBooks.length}</h3>
      <div class="strip">${seriesBooks.map(x => bookCard(x, x.id === b.id ? 'current' : '')).join('')}</div></div>` : ''}
    ${authorBooks.length ? `<div class="section"><h3>Yazarın diğer kitapları</h3><div class="strip">${authorBooks.map(x => bookCard(x)).join('')}</div></div>` : ''}
    ${state.guest || b.shared ? '<div class="section" id="comments-sec"></div>' : ''}
    <button class="section" id="ask-book" style="display:flex;align-items:center;gap:10px;width:100%;border:0;text-align:left;color:inherit"><span style="font-size:22px">🤖</span><span style="flex:1"><b>Bu kitap hakkında asistana sor</b><br><span class="muted small">Benzer kitaplar, bana uygun mu, notlarımın özeti…</span></span></button>
    ${similar.length ? `<div class="section"><h3>Buna benzer kitaplar</h3><div class="strip">${similar.map(r => bookCard(r.b, '', r.why.slice(0, 2).join(' · '))).join('')}</div></div>` : ''}
  `;

  wireBack(view);
  hydrateCovers(view);
  $('#basis-reeval', view)?.addEventListener('click', async () => {
    const m = await import('../autoeval.js');
    if (!m.canEvaluate(b)) { toast('Kitap dosyası bu cihazda yok'); return; }
    m.openReEvaluate(b.id);
  });
  $('#basis-guide', view)?.addEventListener('click', async () => (await import('../ui.js')).openGuide());
  $('#sharefile-tg', view)?.addEventListener('click', async e => {
    const btn = e.currentTarget;
    b.shareFile = !b.shareFile; await saveBook(b);
    btn.disabled = true; btn.textContent = b.shareFile ? '📤 Dosya yükleniyor…' : '…';
    try { await (await import('../share.js')).publishShare(); toast(b.shareFile ? '📄 Dosya paylaşıldı' : 'Dosya paylaşımı kapatıldı'); }
    catch (err) { toast(`Paylaşım güncellenemedi: ${err.message}`); }
    route_refresh(view, b);
  });
  $$('[data-gread]', view).forEach(x => x.addEventListener('click', async () => {
    const slot = Number(x.dataset.gread), f = slot === 2 ? b.file2 : b.file;
    const { db } = await import('../db.js');
    const go = () => { location.hash = `#/read/${enc(b.id)}${slot === 2 ? '?f=2' : ''}`; };
    if (await db.getFile(f.key)) return go();
    const msg = $('#gread-msg', view);
    $$('[data-gread]', view).forEach(y => { y.disabled = true; });
    try {
      await (await import('../share.js')).downloadSharedFile(f, p => { msg.textContent = `İndiriliyor… %${Math.round(p * 100)}`; });
      await db.loadFileKeys();
      go();
    } catch (err) { msg.textContent = err.message; $$('[data-gread]', view).forEach(y => { y.disabled = false; }); }
  }));
  $('#share-tg', view)?.addEventListener('click', async () => {
    b.shared = !b.shared; await saveBook(b);
    try { await (await import('../share.js')).publishShare(); toast(b.shared ? '👥 Paylaşıldı' : 'Paylaşımdan çıkarıldı'); }
    catch (e) { toast(`Paylaşım güncellenemedi: ${e.message}`); }
  });
  if ($('#comments-sec', view)) (await import('./sharing.js')).fillComments($('#comments-sec', view), b, { guestMode: !!state.guest });
  $('#ask-book', view).addEventListener('click', async () => { if (await (await import('../ai.js')).hasKey()) location.hash = `#/chat?book=${enc(b.id)}`; else (await import('./ask.js')).openAsk({ book: b }); });
  $('#gr-edit', view).addEventListener('click', () => sheet({
    title: 'Goodreads puanı',
    body: `<a class="btn block" href="${goodreadsUrl(b)}" target="_blank" rel="noopener" style="margin-bottom:14px">📗 Goodreads'te aç</a>
      <p class="muted small">Goodreads'te kitabın puanına bakıp buraya yaz, sonra uygulamaya dön.</p>
      <div class="form-group"><div class="field inline"><label for="gr-v">Puan (0–5)</label><input id="gr-v" type="number" inputmode="decimal" step="0.01" min="0" max="5" placeholder="4,21" value="${b.goodreads ?? ''}"></div>
      <div class="field inline"><label for="gr-c">Oy sayısı</label><input id="gr-c" type="number" inputmode="numeric" min="0" placeholder="isteğe bağlı" value="${b.goodreadsVotes ?? ''}"></div></div>`,
    foot: '<button class="btn" data-close>Vazgeç</button><button class="btn primary" id="gr-save">Kaydet</button>',
    onMount: (el, close) => $('#gr-save', el).addEventListener('click', async () => {
      const raw = $('#gr-v', el).value.trim().replace(',', '.');
      const v = raw === '' ? null : Number(raw);
      if (v !== null && (isNaN(v) || v < 0 || v > 5)) { toast('Puan 0 ile 5 arasında olmalı'); return; }
      const c = $('#gr-c', el).value.trim();
      b.goodreads = v; b.goodreadsVotes = c === '' ? null : Number(c);
      close(); await saveBook(b); toast('⭐ Goodreads puanı kaydedildi');
    }),
  }));
  fillFileSection(view, b);
  wireHighlights(view, b);
  // Uzun metinler (özet, değerlendirme, notlar): ilk satırlar görünür, "Devamını gör" ile tamamı açılır
  requestAnimationFrame(() => $$('.clampable', view).forEach(el => {
    const line = parseFloat(getComputedStyle(el).lineHeight) || 24;
    if (el.scrollHeight <= line * 8) return;
    el.classList.add('clamped');
    const btn = document.createElement('button');
    btn.className = 'more-btn'; btn.type = 'button'; btn.textContent = 'Devamını gör ▾';
    btn.addEventListener('click', () => {
      const open = el.classList.toggle('clamped') === false;
      btn.textContent = open ? 'Daha az göster ▴' : 'Devamını gör ▾';
      if (!open) el.scrollIntoView({ block: 'nearest' });
    });
    el.after(btn);
  }));
  $$('[data-st]', view).forEach(c => c.addEventListener('click', async () => {
    if (b.status === c.dataset.st) return;
    b.status = c.dataset.st;
    await saveBook(b);
    toast(`${statusInfo(b.status).emoji} ${b.status}`);
    if (b.status === 'Okundu') { if (state.guest) toast('✅ Okundu! Aşağıdan yorum ve yıldız bırakabilirsin'); else openFinished(b); }
  }));
  $('#fav', view).addEventListener('click', async () => { b.favorite = !b.favorite; await saveBook(b); toast(b.favorite ? '❤️ Favorilere eklendi' : 'Favorilerden çıkarıldı'); });
  // Yıldızın sol yarısı yarım puan, sağ yarısı tam puan; aynı değere tekrar basınca silinir
  $$('[data-r]', view).forEach(s => s.addEventListener('click', async e => {
    const box = s.getBoundingClientRect();
    const half = e.clientX && e.clientX < box.left + box.width / 2;
    const r = Number(s.dataset.r) - (half ? 0.5 : 0);
    b.myRating = b.myRating === r ? null : r;
    await saveBook(b);
  }));
  $$('[data-zoom]', view).forEach(z => z.addEventListener('click', () => {
    const img = z.querySelector('img');
    if (!img) return;
    sheet({ title: displayTitle(b), body: `<img src="${img.src}" alt="" style="width:100%;border-radius:10px">` });
  }));
}

function route_refresh(view, b) { renderDetail(view, [b.id]); }

// Misafir: kitabı okuma / devam etme düğmesi ve ilerlemesi
function guestReadHTML(b) {
  const slots = [1, 2].filter(s => (s === 2 ? b.file2 : b.file));
  const rows = slots.map(s => {
    const f = s === 2 ? b.file2 : b.file, p = s === 2 ? b.progress2 : b.progress;
    const pct = p && typeof p.percent === 'number' ? Math.max(0, Math.min(100, p.percent)) : null;
    const name = b.file && b.file2 ? (f.lang === 'tr' ? 'Türkçesi' : 'Orijinali') : '';
    const started = pct !== null || p?.loc || p?.page;
    const label = started ? `▶ ${name ? `${name}: ` : ''}Devam et` : `📖 ${name ? `${name === 'Türkçesi' ? 'Türkçesini' : 'Orijinalini'} oku` : 'Kitabı oku'}`;
    return `${started ? `<div style="margin-top:10px"><div style="display:flex;justify-content:space-between;align-items:baseline"><span class="small">${name ? `<b>${name}</b> · ` : ''}${esc(p.chapter || p.label || '')}</span><b>%${Math.round(pct || 0)}</b></div>
        <div class="progress" style="height:8px;margin-top:4px"><span style="width:${pct || 0}%"></span></div>
        ${p.updatedAt ? `<div class="muted small" style="margin-top:2px">Son okuma: ${new Date(p.updatedAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })}</div>` : ''}</div>` : ''}
      <button class="btn primary block" data-gread="${s}" style="margin-top:8px">${label} <span class="small" style="opacity:.75">(${(f.type || '').toUpperCase()})</span></button>`;
  }).join('');
  return `<div class="section" id="guest-read"><h3>📖 Oku</h3>${rows}
    ${b.readingSeconds ? `<div class="muted small" style="margin-top:8px">⏱ Bu kitapta toplam ${formatDuration(b.readingSeconds)} okudun</div>` : ''}
    <div class="muted small" id="gread-msg" style="margin-top:6px"></div></div>`;
}
