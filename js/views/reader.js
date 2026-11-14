// Kitap okuyucu: EPUB (epub.js) ve PDF (pdf.js). İlerleme, yer imleri, okuma süresi.
import { state, getBook, saveBook, saveSettings, displayTitle, statusInfo } from '../store.js';
import { db } from '../db.js';
import { esc, ICON, sheet, toast, $, $$ } from '../ui.js';
import { getFileBlob, addReadingTime, formatDuration } from '../files.js';

const loaded = {};
function loadScript(src) {
  return (loaded[src] ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => { delete loaded[src]; rej(new Error('Okuyucu yüklenemedi')); };
    document.head.appendChild(s);
  }));
}

const THEMES = {
  light: { bg: '#fffdf9', fg: '#24202a', label: 'Beyaz' },
  sepia: { bg: '#f4ecd8', fg: '#4b3a2a', label: 'Sepya' },
  dark: { bg: '#121014', fg: '#e6dfe8', label: 'Koyu' },
};
const FONTS = {
  publisher: ['Yayıncı', ''],
  serif: ['Serif', 'Georgia, "Iowan Old Style", "Times New Roman", serif'],
  sans: ['Sans', '-apple-system, "Helvetica Neue", Arial, sans-serif'],
};
const rs = () => (state.settings.reader ||= { theme: 'light', fontSize: 100, font: 'publisher', pdfZoom: 1 });

export async function renderReader(view, [id], query) {
  const book = getBook(id);
  if (!book?.file?.key) { location.replace(book ? `#/book/${encodeURIComponent(id)}` : '#/'); return; }
  const blob = await getFileBlob(book);
  if (!blob) {
    view.innerHTML = `<div class="empty"><div class="big">📄</div><h2>Dosya bu telefonda yok</h2><p>Kitap dosyası sadece eklendiği telefonda saklanır. Kitap sayfasından yeniden ekleyebilirsin.</p><a class="btn primary" href="#/book/${encodeURIComponent(id)}">Kitap sayfasına dön</a></div>`;
    return;
  }

  const s = rs();
  view.innerHTML = `
    <div class="reader ${book.file.type}" id="reader" data-rtheme="${s.theme}">
      <div class="r-stage" id="stage"></div>
      ${book.file.type === 'epub' ? '<div class="r-tap" id="r-tap"></div>' : ''}
      <div class="r-status" id="r-status"><span id="r-chap"></span><span id="r-pct"></span></div>
      <div class="r-top">
        <button class="icon-btn" id="r-close" aria-label="Kapat">${ICON.back}</button>
        <div class="r-title">${esc(displayTitle(book))}</div>
        <button class="icon-btn" id="r-ai" aria-label="Yapay zekâya gönder" style="font-size:20px">🤖</button>
        <button class="icon-btn" id="r-toc" aria-label="İçindekiler"><svg viewBox="0 0 24 24"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg></button>
        <button class="icon-btn" id="r-bm" aria-label="Yer imi"><svg viewBox="0 0 24 24"><path d="M6 4h12v17l-6-4-6 4z"/></svg></button>
        <button class="icon-btn" id="r-set" aria-label="Görünüm" style="font-weight:700;font-family:var(--serif)">Aa</button>
      </div>
      <div class="r-bottom">
        <div class="r-info"><span id="r-label"></span><span id="r-time"></span></div>
        <div class="r-nav">${book.file.type === 'epub' ? '<button class="icon-btn" id="r-prev" aria-label="Önceki sayfa">‹</button>' : ''}<input type="range" id="r-range" min="0" max="1000" value="0" aria-label="Kitapta konum">${book.file.type === 'epub' ? '<button class="icon-btn" id="r-next" aria-label="Sonraki sayfa">›</button>' : ''}</div>
      </div>
      <div class="r-finish hidden" id="r-finish"><div>🎉 <b>Kitabı bitirdin mi?</b></div>
        <div class="btn-row"><button class="btn" id="r-fin-no">Henüz değil</button><button class="btn primary" id="r-fin-yes">✅ Okundu olarak işaretle</button></div></div>
      <div class="r-loading" id="r-loading">Kitap açılıyor…</div>
    </div>`;
  const root = $('#reader', view);
  const stage = $('#stage', root);

  // ---------- Okuma süresi ----------
  let lastActivity = Date.now();
  const activity = () => { lastActivity = Date.now(); };
  const sessionStart = book.readingSeconds || 0;
  const tick = setInterval(() => {
    if (document.visibilityState === 'visible' && Date.now() - lastActivity < 5 * 60 * 1000) {
      addReadingTime(book, 10);
      $('#r-time', root).textContent = `⏱ ${formatDuration(book.readingSeconds - sessionStart)} bu oturumda`;
    }
  }, 10000);

  // ---------- İlk açış: Okunuyor ----------
  if (book.status !== 'Okunuyor' && book.status !== 'Okundu') {
    book.status = 'Okunuyor';
    await saveBook(book);
    toast(`${statusInfo('Okunuyor').emoji} Okunuyor olarak işaretlendi`);
  }

  // ---------- İlerleme kaydı (sık yazar, GitHub'a kapanışta gider) ----------
  let saveT = null, finishDismissed = false, dragging = false;
  const persist = () => db.putBook(book);
  function onLocation(p) {
    activity();
    book.progress = { ...p, updatedAt: Date.now() };
    $('#r-chap', root).textContent = p.chapter || '';
    $('#r-pct', root).textContent = p.percent != null ? `%${Math.floor(p.percent)}` : '';
    $('#r-label', root).textContent = p.label || '';
    if (!dragging && ctrl) $('#r-range', root).value = ctrl.rangeValue();
    updateBookmarkBtn();
    clearTimeout(saveT); saveT = setTimeout(persist, 1500);
    const atEnd = p.atEnd || (p.percent != null && p.percent >= 99.5);
    if (atEnd && book.status !== 'Okundu' && !finishDismissed) $('#r-finish', root).classList.remove('hidden');
  }

  // ---------- Kontroller ----------
  let ctrl;
  try {
    ctrl = book.file.type === 'epub'
      ? await openEpub(stage, blob, book, { onLocation, onTap: zone => tap(zone), start: query.get('loc') || book.progress?.loc })
      : await openPdf(stage, blob, book, { onLocation, onTap: () => toggleChrome(), start: query.get('loc') || book.progress?.loc, onActivity: activity });
  } catch (e) {
    clearInterval(tick);
    $('#r-loading', root).innerHTML = `⚠️ Kitap açılamadı<br><span class="small">${esc(e.message || '')}</span><br><a class="btn" style="margin-top:12px" href="#/book/${encodeURIComponent(book.id)}">Geri dön</a>`;
    return () => {};
  }
  $('#r-loading', root).remove();
  $('#r-range', root).max = ctrl.rangeMax();

  // ---------- Üst/alt çubuklar ----------
  let chromeT;
  function toggleChrome(show) {
    const on = show ?? !root.classList.contains('chrome');
    root.classList.toggle('chrome', on);
    clearTimeout(chromeT);
  }
  function tap(zone) {
    activity();
    if (zone === 'left') ctrl.prev();
    else if (zone === 'right') ctrl.next();
    else toggleChrome();
  }
  toggleChrome(true);
  chromeT = setTimeout(() => toggleChrome(false), 2500);

  const tapLayer = $('#r-tap', root);
  if (tapLayer) {
    let t0 = null, swiped = false, wheelAt = 0;
    tapLayer.addEventListener('touchstart', e => { const t = e.changedTouches[0]; t0 = { x: t.clientX, y: t.clientY }; swiped = false; }, { passive: true });
    tapLayer.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
    tapLayer.addEventListener('touchend', e => {
      if (!t0) return;
      const t = e.changedTouches[0], dx = t.clientX - t0.x, dy = t.clientY - t0.y;
      t0 = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { swiped = true; activity(); dx < 0 ? ctrl.next() : ctrl.prev(); }
      else if (Math.abs(dy) > 60) { swiped = true; activity(); dy < 0 ? ctrl.next() : ctrl.prev(); }
    });
    tapLayer.addEventListener('click', e => {
      if (swiped) { swiped = false; return; }
      const r = tapLayer.getBoundingClientRect(), x = (e.clientX - r.left) / r.width;
      tap(x < 0.3 ? 'left' : x > 0.7 ? 'right' : 'center');
    });
    tapLayer.addEventListener('wheel', e => {
      e.preventDefault();
      if (Date.now() - wheelAt < 450 || Math.abs(e.deltaY) + Math.abs(e.deltaX) < 8) return;
      wheelAt = Date.now(); activity();
      (e.deltaY || e.deltaX) > 0 ? ctrl.next() : ctrl.prev();
    }, { passive: false });
    $('#r-prev', root).addEventListener('click', () => { activity(); ctrl.prev(); });
    $('#r-next', root).addEventListener('click', () => { activity(); ctrl.next(); });
  }

  const range = $('#r-range', root);
  if (book.file.type === 'pdf') range.min = 1;
  range.value = ctrl.rangeValue();
  range.addEventListener('input', () => { dragging = true; $('#r-label', root).textContent = ctrl.previewLabel(Number(range.value)); });
  range.addEventListener('change', async () => { dragging = false; await ctrl.gotoRange(Number(range.value)); });

  // ---------- Yer imleri ----------
  function updateBookmarkBtn() {
    const on = !!ctrl && ctrl.isBookmarked(book.bookmarks || []);
    $('#r-bm', root).classList.toggle('on', on);
  }
  $('#r-bm', root).addEventListener('click', () => {
    book.bookmarks ||= [];
    const existing = ctrl.isBookmarked(book.bookmarks);
    if (existing) { book.bookmarks = book.bookmarks.filter(b => b !== existing); toast('Yer imi kaldırıldı'); }
    else {
      const p = book.progress || {};
      book.bookmarks.push({ loc: p.loc, percent: p.percent ?? null, label: [p.chapter, p.label].filter(Boolean).join(' · '), createdAt: Date.now() });
      toast('🔖 Yer imi eklendi');
    }
    updateBookmarkBtn(); persist();
  });

  // ---------- İçindekiler + yer imleri ----------
  $('#r-toc', root).addEventListener('click', async () => {
    const toc = await ctrl.toc();
    const bms = [...(book.bookmarks || [])].sort((a, b) => (a.percent ?? 0) - (b.percent ?? 0));
    sheet({
      title: displayTitle(book),
      body: `<div class="seg"><button class="on" data-tab="toc">İçindekiler</button><button data-tab="bm">Yer imleri · ${bms.length}</button></div>
        <div data-pane="toc">${toc.length ? `<div class="list">${toc.map((t, i) => `<button class="row" data-toc="${i}" style="width:100%;border:0;background:none;text-align:left;padding-left:${14 + t.depth * 16}px"><div class="body"><div class="t" style="font-weight:${t.depth ? 400 : 600}">${esc(t.label)}</div></div>${t.page ? `<span class="end">${t.page}</span>` : ''}</button>`).join('')}</div>` : '<div class="empty">Bu dosyada içindekiler listesi yok.</div>'}</div>
        <div data-pane="bm" class="hidden">${bms.length ? `<div class="list">${bms.map((b, i) => `<div class="row"><button data-bm="${i}" class="body" style="border:0;background:none;text-align:left;padding:0"><div class="t">🔖 ${esc(b.label || 'Yer imi')}</div><div class="s">${b.percent != null ? `%${Math.floor(b.percent)} · ` : ''}${new Date(b.createdAt).toLocaleDateString('tr-TR')}</div></button><button class="icon-btn" data-bmdel="${i}" aria-label="Sil" style="color:var(--text-3)">✕</button></div>`).join('')}</div>` : '<div class="empty">Henüz yer imi yok. Okurken üstteki 🔖 düğmesine dokun.</div>'}</div>`,
      onMount: (el, close) => {
        $$('[data-tab]', el).forEach(t => t.addEventListener('click', () => {
          $$('[data-tab]', el).forEach(x => x.classList.toggle('on', x === t));
          $$('[data-pane]', el).forEach(p => p.classList.toggle('hidden', p.dataset.pane !== t.dataset.tab));
        }));
        $$('[data-toc]', el).forEach(b => b.addEventListener('click', async () => { close(); await ctrl.gotoToc(toc[Number(b.dataset.toc)]); toggleChrome(false); }));
        $$('[data-bm]', el).forEach(b => b.addEventListener('click', async () => { close(); await ctrl.goto(bms[Number(b.dataset.bm)].loc); toggleChrome(false); }));
        $$('[data-bmdel]', el).forEach(b => b.addEventListener('click', () => {
          const bm = bms[Number(b.dataset.bmdel)];
          book.bookmarks = book.bookmarks.filter(x => x !== bm);
          b.closest('.row').remove(); updateBookmarkBtn(); persist();
        }));
      },
    });
  });

  // ---------- Görünüm ayarları ----------
  $('#r-set', root).addEventListener('click', () => {
    const isEpub = book.file.type === 'epub';
    sheet({
      title: 'Görünüm',
      body: `<div class="f-block"><h3>Arka plan</h3><div class="r-themes">${Object.entries(THEMES).map(([k, t]) => `<button data-th="${k}" class="${s.theme === k ? 'on' : ''}" style="background:${t.bg};color:${t.fg}">${t.label}</button>`).join('')}</div></div>
        ${isEpub ? `<div class="f-block"><h3>Yazı boyutu</h3><div class="range-row"><button class="btn" data-fs="-10">A−</button><b id="fs-val" style="flex:1;text-align:center">%${s.fontSize}</b><button class="btn" data-fs="10">A+</button></div></div>
        <div class="f-block"><h3>Yazı tipi</h3><div class="chip-wrap">${Object.entries(FONTS).map(([k, [l]]) => `<button class="chip ${s.font === k ? 'on' : ''}" data-ff="${k}">${l}</button>`).join('')}</div></div>`
        : `<div class="f-block"><h3>Yakınlaştırma</h3><div class="chip-wrap">${[1, 1.25, 1.5, 2].map(z => `<button class="chip ${s.pdfZoom === z ? 'on' : ''}" data-zoom="${z}">%${z * 100}</button>`).join('')}</div></div>
        <div class="f-block"><h3>Sayfaya git</h3><div class="range-row"><input id="goto-p" type="number" inputmode="numeric" min="1" max="${ctrl.rangeMax()}" placeholder="1–${ctrl.rangeMax()}" style="flex:1;height:44px;border-radius:10px;border:1px solid var(--line);padding:0 12px;background:var(--surface)"><button class="btn primary" id="goto-go">Git</button></div></div>`}`,
      onMount: (el, close) => {
        $$('[data-th]', el).forEach(b => b.addEventListener('click', () => {
          s.theme = b.dataset.th; root.dataset.rtheme = s.theme; ctrl.applyStyle();
          $$('[data-th]', el).forEach(x => x.classList.toggle('on', x === b)); saveSettings();
        }));
        $$('[data-fs]', el).forEach(b => b.addEventListener('click', () => {
          s.fontSize = Math.max(70, Math.min(200, s.fontSize + Number(b.dataset.fs)));
          $('#fs-val', el).textContent = `%${s.fontSize}`; ctrl.applyStyle(); saveSettings();
        }));
        $$('[data-ff]', el).forEach(b => b.addEventListener('click', () => {
          s.font = b.dataset.ff; $$('[data-ff]', el).forEach(x => x.classList.toggle('on', x === b)); ctrl.applyStyle(); saveSettings();
        }));
        $$('[data-zoom]', el).forEach(b => b.addEventListener('click', () => {
          s.pdfZoom = Number(b.dataset.zoom); $$('[data-zoom]', el).forEach(x => x.classList.toggle('on', x === b)); ctrl.applyStyle(); saveSettings();
        }));
        $('#goto-go', el)?.addEventListener('click', () => { const n = Number($('#goto-p', el).value); if (n) { ctrl.goto(n); close(); } });
      },
    });
  });

  // ---------- Yapay zekâya gönder (önce ilerlemeyi kaydet ki "okuduğum yere kadar" güncel olsun) ----------
  $('#r-ai', root).addEventListener('click', async () => {
    await persist();
    (await import('./sendbook.js')).openSendBook(book);
  });

  // ---------- Bitirme ----------
  $('#r-fin-no', root).addEventListener('click', () => { finishDismissed = true; $('#r-finish', root).classList.add('hidden'); });
  $('#r-fin-yes', root).addEventListener('click', async () => {
    book.status = 'Okundu'; $('#r-finish', root).classList.add('hidden'); finishDismissed = true;
    await saveBook(book); toast('✅ Okundu! Tebrikler 🎉');
  });

  // ---------- Kapatma ----------
  const onKey = e => { if (e.key === 'ArrowRight') ctrl.next(); if (e.key === 'ArrowLeft') ctrl.prev(); };
  document.addEventListener('keyup', onKey);
  const onHide = () => { if (document.visibilityState === 'hidden') { saveBook(book); saveSettings(); } };
  document.addEventListener('visibilitychange', onHide);
  $('#r-close', root).addEventListener('click', () => { location.hash = `#/book/${encodeURIComponent(book.id)}`; });

  // Sayfadan çıkınca çağrılır
  return async () => {
    clearInterval(tick); clearTimeout(saveT); clearTimeout(chromeT);
    document.removeEventListener('keyup', onKey);
    document.removeEventListener('visibilitychange', onHide);
    ctrl.destroy();
    await saveBook(book);
    await saveSettings();
  };
}

// =====================================================================
// EPUB
// =====================================================================
async function openEpub(stage, blob, book, { onLocation, onTap, start }) {
  await loadScript('vendor/jszip.min.js');
  await loadScript('vendor/epub.min.js');
  const ePub = window.ePub;
  const buf = await blob.arrayBuffer();
  await checkEpub(buf);
  const eb = ePub(buf);
  const rendition = eb.renderTo(stage, { width: '100%', height: '100%', flow: 'paginated', spread: 'none', allowScriptedContent: false });
  const locKey = `loc:${book.file.key}`;
  let locationsReady = false;
  let last = null;

  function applyStyle() {
    const s = rs(), t = THEMES[s.theme];
    rendition.themes.register(s.theme, {
      body: { background: `${t.bg} !important`, color: `${t.fg} !important` },
      'p, div, span, li, h1, h2, h3, h4, h5, h6, blockquote, td': { color: `${t.fg} !important`, 'background-color': 'transparent !important' },
      a: { color: `${s.theme === 'dark' ? '#d68fb4' : '#7b3f61'} !important` },
    });
    rendition.themes.select(s.theme);
    rendition.themes.fontSize(`${s.fontSize}%`);
    if (FONTS[s.font][1]) rendition.themes.override('font-family', FONTS[s.font][1], true);
    else rendition.themes.removeOverride('font-family');
  }

  await eb.ready;
  applyStyle();
  // Kapak gibi linear="no" işaretli bölümlerde epub.js ileri/geri gidemiyor (kapakta takılma).
  // Bu bölümlerden en yakın okunur bölüme geçilsin.
  const items = eb.spine.spineItems;
  for (const sec of items) {
    if (sec.linear) continue;
    sec.next = () => items.slice(sec.index + 1).find(x => x.linear) || items[sec.index + 1];
    sec.prev = () => items.slice(0, sec.index).reverse().find(x => x.linear) || items[sec.index - 1];
  }
  // Yedek: sayfa çevirme konumu değiştirmediyse sonraki/önceki bölümü doğrudan aç.
  let turning = false;
  async function turn(dir) {
    if (turning) return;
    turning = true;
    const before = last?.start?.cfi;
    try {
      // Konum bildirimi (relocated) sayfa çevrildikten biraz sonra gelir; onu bekle.
      const moved = new Promise(res => { const h = () => { rendition.off('relocated', h); res(true); }; rendition.on('relocated', h); setTimeout(() => { rendition.off('relocated', h); res(false); }, 1500); });
      try { await (dir > 0 ? rendition.next() : rendition.prev()); } catch (e) { console.warn('sayfa çevirme', e); }
      await moved;
      if (last?.start?.cfi === before && !(dir > 0 ? last?.atEnd : last?.atStart)) {
        const cur = last?.start?.index ?? rendition.location?.start?.index;
        const target = cur == null ? null : items[cur + dir];
        if (target) {
          try { await rendition.display(target.href); }
          catch (e) { toast(`⚠️ ${cur + dir + 1}. bölüm açılamadı: ${e?.message || e}`); }
        }
      }
    } finally { turning = false; }
  }
  const nav = await eb.loaded.navigation;
  const flat = [];
  (function walk(items, depth) { for (const it of items || []) { flat.push({ label: (it.label || '').trim(), href: it.href, depth }); walk(it.subitems, depth + 1); } })(nav.toc, 0);
  const chapterOf = href => {
    const base = (href || '').split('#')[0];
    let found = null;
    for (const t of flat) if (t.href.split('#')[0].endsWith(base) || base.endsWith(t.href.split('#')[0])) { found = t; break; }
    return found?.label || '';
  };

  function report(loc) {
    if (!loc?.start) return;
    last = loc;
    const percent = loc.atEnd ? 100 : locationsReady ? eb.locations.percentageFromCfi(loc.start.cfi) * 100 : null;
    const d = loc.start.displayed || {};
    onLocation({
      loc: loc.start.cfi,
      percent: percent ?? book.progress?.percent ?? null,
      chapter: chapterOf(loc.start.href),
      label: d.total ? `Bölümde ${d.page}/${d.total}. sayfa` : '',
      atEnd: !!loc.atEnd,
    });
  }
  rendition.on('relocated', report);

  rendition.on('keyup', e => { if (e.key === 'ArrowRight') turn(1); if (e.key === 'ArrowLeft') turn(-1); });

  try { await rendition.display(start || undefined); } catch { await rendition.display(); }

  // Yüzde için konum haritası (ilk açışta hesaplanır, sonra hatırlanır)
  const cached = await db.getMeta(locKey);
  const ready = () => { locationsReady = true; if (last) report(last); };
  if (cached) { eb.locations.load(cached); ready(); }
  else {
    setTimeout(() => eb.locations.generate(1200).then(() => { db.putMeta(locKey, eb.locations.save()); ready(); }).catch(() => {}), 300);
  }

  return {
    next: () => turn(1),
    prev: () => turn(-1),
    goto: loc => rendition.display(loc),
    gotoToc: t => rendition.display(t.href),
    toc: async () => flat,
    rangeMax: () => 1000,
    rangeValue: () => (locationsReady && last ? Math.round(eb.locations.percentageFromCfi(last.start.cfi) * 1000) : 0),
    previewLabel: v => `%${Math.floor(v / 10)}`,
    gotoRange: async v => {
      if (!locationsReady) { toast('Konum haritası hazırlanıyor, birazdan tekrar dene'); return; }
      await rendition.display(eb.locations.cfiFromPercentage(v / 1000));
      // En sona çekildiyse (yazı boyutu değişmiş olabilir) gerçekten son sayfaya kadar git
      if (v >= 1000) for (let i = 0; i < 80 && !last?.atEnd; i++) await rendition.next();
    },
    isBookmarked: bms => {
      if (!last) return null;
      const CFI = new ePub.CFI();
      return bms.find(b => { try { return CFI.compare(b.loc, last.start.cfi) >= 0 && CFI.compare(b.loc, last.end.cfi) <= 0; } catch { return b.loc === last.start.cfi; } }) || null;
    },
    applyStyle,
    destroy: () => { try { rendition.destroy(); eb.destroy(); } catch { /* yok */ } },
  };
}

// =====================================================================
// PDF
// =====================================================================
async function openPdf(stage, blob, book, { onLocation, onTap, start, onActivity }) {
  const base = new URL('../../vendor/pdfjs/', import.meta.url).href;
  const pdfjs = await import('../../vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs';
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false, standardFontDataUrl: base + 'standard_fonts/' }).promise;
  const pages = doc.numPages;
  const first = (await doc.getPage(1)).getViewport({ scale: 1 });

  stage.innerHTML = `<div class="pdf-inner" id="pdf-inner">${Array.from({ length: pages }, (_, i) => `<div class="pdf-page" data-n="${i + 1}" style="aspect-ratio:${first.width}/${first.height}"><span class="pdf-num">${i + 1}</span></div>`).join('')}</div>`;
  const inner = stage.firstElementChild;
  const pageEls = [...inner.children];
  const rendered = new Map(); // n → { canvas, task }

  function applyStyle() {
    inner.style.width = `${rs().pdfZoom * 100}%`;
    const cur = current;
    for (const n of [...rendered.keys()]) release(n);
    requestAnimationFrame(() => { goto(cur, true); pageEls.forEach(el => { io.unobserve(el); io.observe(el); }); });
  }

  async function render(n) {
    if (rendered.has(n)) return;
    const el = pageEls[n - 1];
    const entry = { canvas: null, task: null };
    rendered.set(n, entry);
    const page = await doc.getPage(n);
    if (rendered.get(n) !== entry) return;
    const vp1 = page.getViewport({ scale: 1 });
    el.style.aspectRatio = `${vp1.width}/${vp1.height}`;
    const cssW = el.clientWidth || stage.clientWidth;
    let scale = (cssW / vp1.width) * Math.min(window.devicePixelRatio || 1, 2);
    const maxPixels = 4.5e6; // iPhone'da bellek sınırı
    if (vp1.width * vp1.height * scale * scale > maxPixels) scale = Math.sqrt(maxPixels / (vp1.width * vp1.height));
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
    entry.canvas = canvas;
    entry.task = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp });
    try { await entry.task.promise; } catch { return; }
    if (rendered.get(n) === entry) el.appendChild(canvas);
  }
  function release(n) {
    const e = rendered.get(n);
    if (!e) return;
    try { e.task?.cancel(); } catch { /* yok */ }
    if (e.canvas) { e.canvas.remove(); e.canvas.width = e.canvas.height = 0; }
    rendered.delete(n);
  }

  const io = new IntersectionObserver(entries => {
    for (const en of entries) {
      const n = Number(en.target.dataset.n);
      if (en.isIntersecting) render(n); else release(n);
    }
  }, { root: stage, rootMargin: '120% 0px' });
  pageEls.forEach(el => io.observe(el));

  let current = 1, raf = 0;
  function detect() {
    raf = 0;
    const mid = stage.getBoundingClientRect().top + stage.clientHeight * 0.4;
    let n = current;
    for (const el of pageEls) { const r = el.getBoundingClientRect(); if (r.top <= mid && r.bottom >= mid) { n = Number(el.dataset.n); break; } }
    const atBottom = stage.scrollTop + stage.clientHeight >= stage.scrollHeight - 4;
    if (atBottom) n = pages;
    current = n;
    onLocation({ loc: n, page: n, pages, percent: (n / pages) * 100, label: `Sayfa ${n} / ${pages}`, chapter: '', atEnd: n === pages });
  }
  stage.addEventListener('scroll', () => { onActivity(); if (!raf) raf = requestAnimationFrame(detect); }, { passive: true });
  stage.addEventListener('click', () => onTap());

  function goto(n, silent) {
    n = Math.max(1, Math.min(pages, Number(n) || 1));
    pageEls[n - 1].scrollIntoView({ block: 'start' });
    current = n;
    if (!silent) detect();
  }

  applyStyleInit();
  function applyStyleInit() { inner.style.width = `${rs().pdfZoom * 100}%`; }
  await new Promise(r => requestAnimationFrame(r));
  goto(start || 1);

  let outline = null;
  return {
    next: () => stage.scrollBy({ top: stage.clientHeight * 0.9, behavior: 'smooth' }),
    prev: () => stage.scrollBy({ top: -stage.clientHeight * 0.9, behavior: 'smooth' }),
    goto: loc => goto(loc),
    gotoToc: t => goto(t.page),
    toc: async () => {
      if (outline) return outline;
      outline = [];
      const items = await doc.getOutline().catch(() => null);
      async function walk(list, depth) {
        for (const it of list || []) {
          let page = null;
          try {
            const dest = typeof it.dest === 'string' ? await doc.getDestination(it.dest) : it.dest;
            if (dest?.[0]) page = (typeof dest[0] === 'number' ? dest[0] : await doc.getPageIndex(dest[0])) + 1;
          } catch { /* yok */ }
          if (page) outline.push({ label: it.title, page, depth });
          await walk(it.items, depth + 1);
        }
      }
      await walk(items, 0);
      return outline;
    },
    rangeMax: () => pages,
    rangeValue: () => current,
    previewLabel: v => `Sayfa ${v} / ${pages}`,
    gotoRange: async v => goto(v),
    isBookmarked: bms => bms.find(b => Number(b.loc) === current) || null,
    applyStyle,
    destroy: () => { io.disconnect(); for (const n of [...rendered.keys()]) release(n); doc.destroy(); },
  };
}

// DRM'li (mağazadan alınmış, şifreli) EPUB'ları baştan tanı: kapak açılır ama metin şifreli olduğu için okunamaz.
async function checkEpub(buf) {
  let zip;
  try { zip = await window.JSZip.loadAsync(buf); } catch { throw new Error('Dosya geçerli bir EPUB değil (zip açılamadı)'); }
  const enc = zip.file('META-INF/encryption.xml');
  if (!enc) return;
  const xml = await enc.async('string');
  const algs = [...xml.matchAll(/Algorithm="([^"]+)"/g)].map(m => m[1]);
  const fontOnly = algs.every(a => /idpf\.org\/2008\/embedding|ns\.adobe\.com\/pdf\/enc#RC/.test(a));
  if (!fontOnly || zip.file('META-INF/rights.xml')) throw new Error('Bu EPUB DRM ile korumalı (şifreli). Kapak açılır ama metin okunamaz. DRM\'siz bir EPUB kopyası gerekiyor.');
}
