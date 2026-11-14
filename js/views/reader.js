// Kitap okuyucu: EPUB (epub.js) ve PDF (pdf.js). İlerleme, yer imleri, okuma süresi.
import { state, getBook, saveBook, saveSettings, displayTitle, statusInfo } from '../store.js';
import { db } from '../db.js';
import { esc, ICON, sheet, toast, $, $$ } from '../ui.js';
import { getFileBlob, addReadingTime, formatDuration, slotBook, slotFile, langLabel, realBook } from '../files.js';
import { watchSelection } from './wordpick.js';
import { addWord, findWord } from './vocab.js';
import { HL_COLORS, newHighlight, removeHighlight } from './highlights.js';
import { openFinished } from './finished.js';

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
// Okuyucu ince ayarları (EPUB)
const LINE_HEIGHTS = [['pub', 'Yayıncı'], ['1.4', '1,4'], ['1.6', '1,6'], ['1.8', '1,8'], ['2', '2,0']];
const MARGINS = { s: ['Dar', 0], m: ['Orta', 14], l: ['Geniş', 30] };
const ALIGNS = [['pub', 'Yayıncı'], ['left', 'Sola yaslı'], ['justify', 'İki yana']];
function typoBlocks(st) {
  const chips = (key, list, cur) => list.map(([k, l]) => `<button class="chip ${String(cur) === k ? 'on' : ''}" data-${key}="${k}">${l}</button>`).join('');
  return `<div class="f-block"><h3>Satır aralığı</h3><div class="chip-wrap">${chips('lh', LINE_HEIGHTS, st.lineHeight || 'pub')}</div></div>
    <div class="f-block"><h3>Kenar boşluğu</h3><div class="chip-wrap">${chips('mg', Object.entries(MARGINS).map(([k, [l]]) => [k, l]), st.margin || 's')}</div></div>
    <div class="f-block"><h3>Hizalama</h3><div class="chip-wrap">${chips('al', ALIGNS, st.align || 'pub')}</div></div>`;
}
function wireTypo(el, st, apply) {
  for (const [key, prop] of [['lh', 'lineHeight'], ['mg', 'margin'], ['al', 'align']]) {
    $$(`[data-${key}]`, el).forEach(b => b.addEventListener('click', () => {
      st[prop] = b.dataset[key];
      $$(`[data-${key}]`, el).forEach(x => x.classList.toggle('on', x === b));
      apply(); saveSettings();
    }));
  }
}
// Hizalamayı kitabın kendi paragraflarına uygula (başlıklar ve ortalanmış satırlar korunur)
function applyAlign(doc) {
  if (!doc?.body) return;
  const mode = rs().align || 'pub';
  for (const el of doc.body.querySelectorAll('p, div, li, blockquote')) {
    if (el.dataset.kjAlign) { el.style.removeProperty('text-align'); el.style.removeProperty('hyphens'); el.style.removeProperty('-webkit-hyphens'); delete el.dataset.kjAlign; }
  }
  if (mode === 'pub') return;
  for (const el of doc.body.querySelectorAll('p, div, li, blockquote')) {
    const ta = doc.defaultView.getComputedStyle(el).textAlign;
    const swap = mode === 'left' ? (ta === 'justify') : (ta === 'left' || ta === 'start');
    if (!swap || (mode === 'justify' && el.children.length && !el.textContent.trim())) continue;
    el.dataset.kjAlign = '1';
    el.style.setProperty('text-align', mode, 'important');
    if (mode === 'justify') { el.style.setProperty('hyphens', 'auto'); el.style.setProperty('-webkit-hyphens', 'auto'); }
  }
}

export async function renderReader(view, [id], query) {
  if (query.get('split') === '1') return renderSplit(view, id);
  // ?f=2 → kitabın ikinci dosyası (ör. çeviri); ilerleme ve yer imleri ayrı tutulur
  const slot = query.get('f') === '2' ? 2 : 1;
  const book = slotBook(getBook(id), slot);
  const otherFile = book ? slotFile(realBook(book), slot === 2 ? 1 : 2) : null;
  const slotQ = slot === 2 ? 'f=2&' : '';
  if (!book?.file?.key) { location.replace(book ? `#/book/${encodeURIComponent(id)}` : '#/'); return; }
  const blob = await getFileBlob(book);
  if (!blob) {
    view.innerHTML = `<div class="empty"><div class="big">📄</div><h2>Dosya bu telefonda yok</h2><p>Kitap dosyası sadece eklendiği telefonda saklanır. Kitap sayfasından yeniden ekleyebilirsin.</p><a class="btn primary" href="#/book/${encodeURIComponent(id)}">Kitap sayfasına dön</a></div>`;
    return;
  }

  const s = rs();
  view.innerHTML = `
    <div class="reader ${book.file.type}${book.file.type === 'epub' && s.flow === 'scroll' ? ' scroll' : ''}" id="reader" data-rtheme="${s.theme}">
      <div class="r-stage" id="stage"></div>
      ${book.file.type === 'epub' && s.flow !== 'scroll' ? '<div class="r-tap r-tap-l" data-zone="left"></div><div class="r-tap r-tap-r" data-zone="right"></div>' : ''}
      <div class="r-status" id="r-status"><span id="r-chap"></span><span id="r-pct"></span></div>
      <div class="r-top">
        <button class="icon-btn" id="r-close" aria-label="Kapat">${ICON.back}</button>
        <div class="r-title">${esc(displayTitle(book))}${otherFile ? `<div class="small muted" style="font-weight:500">${esc(langLabel(book.file))}</div>` : ''}</div>
        ${otherFile ? `<button class="icon-btn" id="r-split" aria-label="İkisini aynı anda göster" title="Orijinal ve çeviri aynı anda" style="font-size:20px">◫</button>` : ''}
        ${otherFile ? `<button class="icon-btn" id="r-swap" aria-label="Diğer dosyaya geç" title="${esc(langLabel(otherFile))} dosyasına geç" style="font-size:12px;font-weight:700;width:auto;padding:0 8px;white-space:nowrap">⇄ ${otherFile.lang === 'tr' ? 'Çeviri' : otherFile.lang === 'orig' ? 'Orijinal' : 'Diğer'}</button>` : ''}
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
      ${book.file.type === 'epub' ? '<button class="r-menu-fab" id="r-menu" aria-label="Menü">⋯</button>' : ''}
    </div>`;
  const root = $('#reader', view);
  const stage = $('#stage', root);

  // ---------- Okuma süresi ----------
  const goalCheck = () => {
    const goal = Number(state.settings.dailyGoalMin) || 0;
    const day = new Date().toDateString();
    if (!goal || state.settings.goalHitDay === day) return;
    const log = state.settings.readLog || {};
    const d = new Date(), key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if ((log[key] || 0) >= goal * 60) { state.settings.goalHitDay = day; saveSettings(); toast(`🎯 Bugünkü ${goal} dakikalık hedef tamam! 🔥`); }
  };
  let lastActivity = Date.now();
  const activity = () => { lastActivity = Date.now(); };
  const sessionStart = book.readingSeconds || 0;
  const tick = setInterval(() => {
    if (document.visibilityState === 'visible' && Date.now() - lastActivity < 5 * 60 * 1000) {
      addReadingTime(book, 10);
      goalCheck();
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
      ? await openEpub(stage, blob, book, { onLocation, onTap: zone => tap(zone), start: query.get('loc') || book.progress?.loc, onStuck: () => switchFlow('scroll', true) })
      : await openPdf(stage, blob, book, { onLocation, onTap: () => toggleChrome(), start: query.get('loc') || book.progress?.loc, onActivity: activity });
  } catch (e) {
    clearInterval(tick);
    $('#r-loading', root).innerHTML = `⚠️ Kitap açılamadı<br><span class="small">${esc(e.message || '')}</span><br><a class="btn" style="margin-top:12px" href="#/book/${encodeURIComponent(book.id)}">Geri dön</a>`;
    return () => {};
  }
  $('#r-loading', root).remove();
  $('#r-range', root).max = ctrl.rangeMax();

  // Sayfa sayfa / kaydırarak: okuyucuyu aynı yerden yeniden açar
  function switchFlow(flow, auto) {
    if ((rs().flow || 'paged') === flow) return;
    rs().flow = flow; saveSettings();
    if (auto) toast('Sayfa çevrilemedi; "Kaydırarak oku" moduna geçildi (Aa menüsünden değiştirebilirsin)', 4500);
    const loc = book.progress?.loc;
    location.replace(`#/read/${encodeURIComponent(book.id)}?${slotQ}${loc ? `loc=${encodeURIComponent(loc)}&` : ''}m=${Date.now()}`);
  }

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
  $('#r-status', root).addEventListener('click', () => toggleChrome());
  $('#r-menu', root)?.addEventListener('click', () => toggleChrome());

  // iPhone, kitabın açıldığı korumalı çerçevedeki dokunmaları bildirmiyor. Bu yüzden:
  //  - metin seçimi iPhone'un kendisine bırakılır (büyüteç, Kopyala, Çeviri → DeepL); seçimi yoklayıp çeviri kartı gösteririz
  //  - sayfa sayfa modunda sayfayı sol/sağ kenardaki şeritler çevirir; menüyü ⋯ açar
  //  - kaydırma modunda yukarı kaydırınca menü açılır, aşağı okurken kapanır
  let stopSel = null;
  if (book.file.type === 'epub') {
    stopSel = watchSelection(stage, root, { lang: () => book.file.lang, onSave: e => addWord(book, e), isSaved: w => !!findWord(book, w),
      onHighlight: async opts => { const h = await newHighlight(book, ctrl, opts); if (h) toast(h.note ? '📝 Not eklendi' : '🖍 Vurgulandı'); return !!h; } });
    $$('.r-tap', root).forEach(strip => {
      let t0 = null, swiped = false, wheelAt = 0;
      strip.addEventListener('touchstart', e => { const t = e.changedTouches[0]; t0 = { x: t.clientX, y: t.clientY }; swiped = false; }, { passive: true });
      strip.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
      strip.addEventListener('touchend', e => {
        if (!t0) return;
        const t = e.changedTouches[0], dx = t.clientX - t0.x, dy = t.clientY - t0.y;
        t0 = null;
        if (Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy)) { swiped = true; activity(); dx < 0 ? ctrl.next() : ctrl.prev(); }
        else if (Math.abs(dy) > 50) { swiped = true; activity(); dy < 0 ? ctrl.next() : ctrl.prev(); }
      });
      strip.addEventListener('click', () => { if (swiped) { swiped = false; return; } tap(strip.dataset.zone); });
      strip.addEventListener('wheel', e => {
        e.preventDefault();
        if (Date.now() - wheelAt < 450 || Math.abs(e.deltaY) + Math.abs(e.deltaX) < 8) return;
        wheelAt = Date.now(); activity();
        (e.deltaY || e.deltaX) > 0 ? ctrl.next() : ctrl.prev();
      }, { passive: false });
    });
    if (rs().flow === 'scroll') watchScrollChrome(stage, toggleChrome, () => root.classList.contains('chrome'));
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
    if (existing) { book.bookmarks = book.bookmarks.filter(b => b !== existing); (book.bookmarksDel ||= {})[`${existing.loc}|${existing.createdAt}`] = Date.now(); toast('Yer imi kaldırıldı'); }
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
    const hls = [...(book.highlights || [])].sort((a, b) => a.at - b.at);
    sheet({
      title: displayTitle(book),
      body: `<div class="seg"><button class="on" data-tab="toc">İçindekiler</button><button data-tab="bm">Yer imleri · ${bms.length}</button>${book.file.type === 'epub' ? `<button data-tab="hl">Vurgular · ${hls.length}</button>` : ''}</div>
        <div data-pane="toc">${toc.length ? `<div class="list">${toc.map((t, i) => `<button class="row" data-toc="${i}" style="width:100%;border:0;background:none;text-align:left;padding-left:${14 + t.depth * 16}px"><div class="body"><div class="t" style="font-weight:${t.depth ? 400 : 600}">${esc(t.label)}</div></div>${t.page ? `<span class="end">${t.page}</span>` : ''}</button>`).join('')}</div>` : '<div class="empty">Bu dosyada içindekiler listesi yok.</div>'}</div>
        <div data-pane="bm" class="hidden">${bms.length ? `<div class="list">${bms.map((b, i) => `<div class="row"><button data-bm="${i}" class="body" style="border:0;background:none;text-align:left;padding:0"><div class="t">🔖 ${esc(b.label || 'Yer imi')}</div><div class="s">${b.percent != null ? `%${Math.floor(b.percent)} · ` : ''}${new Date(b.createdAt).toLocaleDateString('tr-TR')}</div></button><button class="icon-btn" data-bmdel="${i}" aria-label="Sil" style="color:var(--text-3)">✕</button></div>`).join('')}</div>` : '<div class="empty">Henüz yer imi yok. Okurken üstteki 🔖 düğmesine dokun.</div>'}</div>
        <div data-pane="hl" class="hidden">${hls.length ? `<div class="list">${hls.map((h, i) => `<div class="row"><button data-hl="${i}" class="body" style="border:0;background:none;text-align:left;padding:0"><div class="t hl-quote" style="border-left-color:${HL_COLORS[h.color] || HL_COLORS.yellow}">${esc(h.text)}</div>${h.note ? `<div class="s">📝 ${esc(h.note)}</div>` : ''}</button><button class="icon-btn" data-hldel="${i}" aria-label="Sil" style="color:var(--text-3)">✕</button></div>`).join('')}</div>` : '<div class="empty">Henüz vurgu yok. Metni seç, alttaki kartta 🖍 Vurgula ya da 📝 Not\'a dokun.</div>'}</div>`,
      onMount: (el, close) => {
        $$('[data-tab]', el).forEach(t => t.addEventListener('click', () => {
          $$('[data-tab]', el).forEach(x => x.classList.toggle('on', x === t));
          $$('[data-pane]', el).forEach(p => p.classList.toggle('hidden', p.dataset.pane !== t.dataset.tab));
        }));
        $$('[data-toc]', el).forEach(b => b.addEventListener('click', async () => { close(); await ctrl.gotoToc(toc[Number(b.dataset.toc)]); toggleChrome(false); }));
        $$('[data-bm]', el).forEach(b => b.addEventListener('click', async () => { close(); await ctrl.goto(bms[Number(b.dataset.bm)].loc); toggleChrome(false); }));
        $$('[data-hl]', el).forEach(b => b.addEventListener('click', async () => { close(); await ctrl.goto(hls[Number(b.dataset.hl)].cfi); toggleChrome(false); }));
        $$('[data-hldel]', el).forEach(b => b.addEventListener('click', async () => {
          const h = hls[Number(b.dataset.hldel)];
          ctrl.unhighlight?.(h.cfi); await removeHighlight(book, h.id); b.closest('.row').remove();
        }));
        $$('[data-bmdel]', el).forEach(b => b.addEventListener('click', () => {
          const bm = bms[Number(b.dataset.bmdel)];
          book.bookmarks = book.bookmarks.filter(x => x !== bm);
          (book.bookmarksDel ||= {})[`${bm.loc}|${bm.createdAt}`] = Date.now();
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
        <div class="f-block"><h3>Okuma düzeni</h3><div class="chip-wrap"><button class="chip ${s.flow !== 'scroll' ? 'on' : ''}" data-flow="paged">📖 Sayfa sayfa</button><button class="chip ${s.flow === 'scroll' ? 'on' : ''}" data-flow="scroll">📜 Kaydırarak oku</button></div><p class="small muted" style="margin-top:6px">Sayfa çevrilemiyorsa "Kaydırarak oku"yu seç: metin web sayfası gibi parmakla aşağı kaydırılır.</p></div>
        <div class="f-block"><h3>Yazı tipi</h3><div class="chip-wrap">${Object.entries(FONTS).map(([k, [l]]) => `<button class="chip ${s.font === k ? 'on' : ''}" data-ff="${k}">${l}</button>`).join('')}</div></div>
        ${typoBlocks(s)}`
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
        wireTypo(el, s, () => ctrl.applyStyle());
        $$('[data-ff]', el).forEach(b => b.addEventListener('click', () => {
          s.font = b.dataset.ff; $$('[data-ff]', el).forEach(x => x.classList.toggle('on', x === b)); ctrl.applyStyle(); saveSettings();
        }));
        $$('[data-flow]', el).forEach(b => b.addEventListener('click', () => { close(); switchFlow(b.dataset.flow); }));
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
    const send = async () => (await import('./sendbook.js')).openSendBook(book);
    if (book.file.type === 'epub') (await import('./chapsum.js')).openAiMenu(book, { onSendBook: send });
    else send();
  });

  // ---------- Bitirme ----------
  $('#r-fin-no', root).addEventListener('click', () => { finishDismissed = true; $('#r-finish', root).classList.add('hidden'); });
  $('#r-fin-yes', root).addEventListener('click', async () => {
    book.status = 'Okundu'; $('#r-finish', root).classList.add('hidden'); finishDismissed = true;
    await saveBook(book); toast('✅ Okundu! Tebrikler 🎉');
    openFinished(book);
  });

  // ---------- Kapatma ----------
  const onKey = e => { if (e.key === 'ArrowRight') ctrl.next(); if (e.key === 'ArrowLeft') ctrl.prev(); };
  document.addEventListener('keyup', onKey);
  const onHide = () => { if (document.visibilityState === 'hidden') { saveBook(book); saveSettings(); } };
  document.addEventListener('visibilitychange', onHide);
  $('#r-close', root).addEventListener('click', () => closeReader(book.id));
  $('#r-split', root)?.addEventListener('click', async () => {
    await persist();
    location.replace(`#/read/${encodeURIComponent(book.id)}?split=1`);
  });
  // Orijinal ⇄ çeviri: diğer dosya kendi kaldığı yerden açılır
  $('#r-swap', root)?.addEventListener('click', async () => {
    await persist();
    location.replace(`#/read/${encodeURIComponent(book.id)}${slot === 2 ? '' : '?f=2'}`);
  });

  // Sayfadan çıkınca çağrılır
  return async () => {
    stopSel?.();
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
async function openEpub(stage, blob, book, { onLocation, onTap, start, onStuck }) {
  const scroll = rs().flow === 'scroll';
  await loadScript('vendor/jszip.min.js');
  await loadScript('vendor/epub.min.js');
  const ePub = window.ePub;
  const buf = await checkEpub(await blob.arrayBuffer());
  const eb = ePub(buf);
  const rendition = eb.renderTo(stage, scroll
    ? { width: '100%', height: '100%', manager: 'continuous', flow: 'scrolled', allowScriptedContent: false }
    : { width: '100%', height: '100%', flow: 'paginated', spread: 'none', allowScriptedContent: false });
  // Kaydırma modunda dokunma katmanı yok: ortaya dokunmak menüyü açsın
  {
    // Ortaya dokununca menü (Android/bilgisayar; iPhone korumalı çerçevedeki dokunmaları bildirmediği için orada ⋯ düğmesi var)
    let lastTouch = 0;
    rendition.hooks.content.register(contents => {
      const d = contents.document;
      let t0 = null;
      d.addEventListener('touchstart', e => {
        if (e.touches.length !== 1) { t0 = null; return; }
        const t = e.touches[0]; t0 = { x: t.screenX, y: t.screenY, at: Date.now() };
      }, { passive: true });
      d.addEventListener('touchend', e => {
        lastTouch = Date.now();
        if (!t0) return;
        const t = e.changedTouches[0];
        const moved = Math.hypot(t.screenX - t0.x, t.screenY - t0.y), dt = Date.now() - t0.at;
        t0 = null;
        if (moved > 10 || dt > 350) return; // kaydırma ya da basılı tutma
        if (String(d.getSelection?.() || '').length) return; // metin seçiliyor
        if (e.target?.closest?.('a[href]')) return; // bağlantı
        onTap('center');
      }, { passive: true });
    });
    // Fare / dokunmatik olmayan cihazlar için
    rendition.on('click', e => {
      if (Date.now() - lastTouch < 800) return;
      const sel = e.view?.getSelection?.();
      if (!(sel && String(sel).length)) onTap('center');
    });
  }
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
    // Satır aralığı: paragraflara (başlıklar kitabın kendi aralığında kalır)
    const lh = s.lineHeight && s.lineHeight !== 'pub' ? s.lineHeight : null;
    rendition.getContents().forEach(c => {
      const d = c.document;
      let st = d.getElementById('kj-typo');
      if (!st) { st = d.createElement('style'); st.id = 'kj-typo'; d.head.appendChild(st); }
      st.textContent = lh ? `p, li, blockquote { line-height: ${lh} !important; }` : '';
      applyAlign(d);
    });
    // Kenar boşluğu: okuma alanını daralt
    const mg = (MARGINS[s.margin || 's'] || MARGINS.s)[1];
    if (stage.dataset.mg !== String(mg)) {
      const first = stage.dataset.mg == null;
      stage.dataset.mg = String(mg);
      stage.style.marginLeft = stage.style.marginRight = `${mg}px`;
      if (!first) requestAnimationFrame(() => { try { rendition.resize(); } catch { /* yok */ } });
    }
  }
  // Yeni yüklenen bölümlere de uygula
  rendition.hooks.content.register(contents => {
    const s = rs(), lh = s.lineHeight && s.lineHeight !== 'pub' ? s.lineHeight : null;
    const st = contents.document.createElement('style'); st.id = 'kj-typo';
    st.textContent = lh ? `p, li, blockquote { line-height: ${lh} !important; }` : '';
    contents.document.head.appendChild(st);
    applyAlign(contents.document);
  });

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
  let turning = false, stuck = 0;
  const within = (p, ms) => Promise.race([p, new Promise(res => setTimeout(res, ms))]);
  async function turn(dir) {
    if (turning) return;
    turning = true;
    const before = last?.start?.cfi;
    try {
      // Konum bildirimi (relocated) sayfa çevrildikten biraz sonra gelir; onu bekle.
      const moved = new Promise(res => { const h = () => { rendition.off('relocated', h); res(true); }; rendition.on('relocated', h); setTimeout(() => { rendition.off('relocated', h); res(false); }, 1500); });
      try { await within(dir > 0 ? rendition.next() : rendition.prev(), 2500); } catch (e) { console.warn('sayfa çevirme', e); }
      await moved;
      if (last?.start?.cfi === before && !(dir > 0 ? last?.atEnd : last?.atStart)) {
        const cur = last?.start?.index ?? rendition.location?.start?.index;
        const target = cur == null ? null : items[cur + dir];
        if (target) {
          try { await within(rendition.display(target.href), 4000); }
          catch (e) { toast(`⚠️ ${cur + dir + 1}. bölüm açılamadı: ${e?.message || e}`); }
        }
        // Hiçbir şekilde ilerlenemiyorsa (bazı iPhone/EPUB birleşimleri) kaydırma moduna geç
        if (last?.start?.cfi === before && !scroll && ++stuck >= 2) onStuck?.();
      } else stuck = 0;
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
  // Vurgular (kitabın üstüne çizilir; her bölüm açıldığında epub.js yeniden çizer)
  const drawHl = h => { try { rendition.annotations.highlight(h.cfi, { id: h.id }, () => {}, 'kj-hl', { fill: HL_COLORS[h.color] || HL_COLORS.yellow, 'fill-opacity': '0.38', 'mix-blend-mode': 'multiply' }); } catch { /* yok */ } };
  (book.highlights || []).forEach(drawHl);

  // Yüzde için konum haritası (ilk açışta hesaplanır, sonra hatırlanır)
  const cached = await db.getMeta(locKey);
  const ready = () => { locationsReady = true; if (last) report(last); };
  if (cached) { eb.locations.load(cached); ready(); }
  else {
    setTimeout(() => { try { eb.locations.generate(1200).then(() => { db.putMeta(locKey, eb.locations.save()); ready(); }).catch(() => {}); } catch { /* okuyucu kapandı */ } }, 300);
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
    // Seçili metnin konumu (vurgu için) ve seçimi temizleme
    selection: () => {
      for (const c of rendition.getContents()) {
        const sel = c.document?.getSelection?.();
        if (sel && String(sel).trim() && sel.rangeCount) {
          try { return { cfi: c.cfiFromRange(sel.getRangeAt(0)), text: String(sel), clear: () => sel.removeAllRanges() }; } catch { /* yok */ }
        }
      }
      return null;
    },
    highlight: drawHl,
    unhighlight: cfi => { try { rendition.annotations.remove(cfi, 'highlight'); } catch { /* yok */ } },
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
export async function checkEpub(buf) {
  let zip;
  try { zip = await window.JSZip.loadAsync(buf); } catch { throw new Error('Dosya geçerli bir EPUB değil (zip açılamadı)'); }
  const enc = zip.file('META-INF/encryption.xml');
  if (enc) {
    const xml = await enc.async('string');
    const algs = [...xml.matchAll(/Algorithm="([^"]+)"/g)].map(m => m[1]);
    const fontOnly = algs.every(a => /idpf\.org\/2008\/embedding|ns\.adobe\.com\/pdf\/enc#RC/.test(a));
    if (!fontOnly || zip.file('META-INF/rights.xml')) throw new Error('Bu EPUB DRM ile korumalı (şifreli). Kapak açılır ama metin okunamaz. DRM\'siz bir EPUB kopyası gerekiyor.');
  }
  return (await fixMissing(zip)) || buf;
}

// Okuma sırasında olup dosyası EPUB'da bulunmayan sayfalar (ör. Calibre'nin düşürdüğü titlepage.xhtml)
// okuyucuyu takabiliyor. Eksik sayfaları yerine koy: başlık sayfasıysa kapak resmi, değilse boş sayfa.
async function fixMissing(zip) {
  try {
    const container = await zip.file('META-INF/container.xml')?.async('string');
    const opfPath = container?.match(/full-path="([^"]+)"/)?.[1];
    const opf = opfPath && await zip.file(opfPath)?.async('string');
    if (!opf) return null;
    const dir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    const attr = (tag, n) => tag.match(new RegExp(`\\s${n}\\s*=\\s*["']([^"']*)["']`))?.[1];
    const items = [...opf.matchAll(/<item\b[^>]*>/g)].map(m => ({ id: attr(m[0], 'id'), href: attr(m[0], 'href'), type: attr(m[0], 'media-type'), props: attr(m[0], 'properties') || '' }));
    const spine = [...opf.matchAll(/<itemref\b[^>]*>/g)].map(m => attr(m[0], 'idref'));
    const norm = h => { const out = []; for (const seg of (dir + decodeURIComponent(h || '')).split('/')) { if (seg === '..') out.pop(); else if (seg && seg !== '.') out.push(seg); } return out.join('/'); };
    const has = path => zip.file(path) || zip.file(encodeURI(path));
    const coverId = opf.match(/<meta\b[^>]*name=["']cover["'][^>]*content=["']([^"']+)["']/)?.[1] || opf.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*name=["']cover["']/)?.[1];
    const cover = items.find(i => /cover-image/.test(i.props)) || items.find(i => i.id === coverId && /^image\//.test(i.type || ''))
      || items.find(i => /^image\//.test(i.type || '') && /cover/i.test(i.href || ''));
    let fixed = 0;
    for (const id of spine) {
      const it = items.find(i => i.id === id);
      if (!it?.href || has(norm(it.href))) continue;
      const path = norm(it.href);
      let body = '';
      if (cover && /title|cover/i.test(it.id + it.href) && has(norm(cover.href))) {
        const from = path.split('/').slice(0, -1), to = norm(cover.href).split('/');
        let k = 0; while (k < from.length && from[k] === to[k]) k++;
        const rel = [...from.slice(k).map(() => '..'), ...to.slice(k)].join('/');
        body = `<div style="text-align:center;height:100%"><img src="${rel}" alt="" style="max-width:100%;max-height:100%"/></div>`;
      }
      zip.file(path, `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title></title></head><body>${body}</body></html>`);
      fixed++;
    }
    return fixed ? await zip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }) : null;
  } catch (e) { console.warn('EPUB onarımı', e); return null; }
}

// =====================================================================
// Bölünmüş ekran: orijinal metin ve çeviri aynı anda (telefonda üst/alt, yatayda ve tablette yan yana).
// Her bölmenin sayfası ve ilerlemesi ayrı; "Bölümü eşle" öbür bölmeyi aynı bölüme getirir.
// =====================================================================
const chapterNo = label => {
  const l = String(label || '').toLowerCase();
  const m = l.match(/(?:chapter|bölüm|bolum|kapitel|chapitre|capítulo|part|kısım)\s*(\d+)/) || l.match(/^\s*(\d+)\s*[.:\-–)]?\s*(?:bölüm|bolum)?/) || l.match(/(\d+)\.\s*(?:bölüm|bolum)/);
  return m ? Number(m[1]) : null;
};

async function renderSplit(view, id) {
  const real = getBook(id);
  if (!real?.file?.key || !real?.file2?.key) { location.replace(`#/read/${encodeURIComponent(id)}`); return () => {}; }
  // Orijinal üstte/solda
  const order = real.file2.lang === 'orig' && real.file.lang !== 'orig' ? [2, 1] : [1, 2];
  const s = rs();
  const dir = s.splitDir || 'auto';
  view.innerHTML = `
    <div class="reader split${s.flow === 'scroll' ? ' scroll' : ''}" id="reader" data-rtheme="${s.theme}" data-dir="${dir}">
      <div class="sp-top">
        <button class="icon-btn" id="sp-close" aria-label="Kapat">${ICON.back}</button>
        <div class="r-title">${esc(displayTitle(real))}</div>
        <button class="mini-btn" id="sp-sync" title="Öbür tarafı aynı bölüme getir">🔗 Bölümü eşle</button>
        <button class="icon-btn" id="sp-dir" aria-label="Bölme yönü" title="Üst-alt / yan yana">${dir === 'cols' ? '◫' : dir === 'rows' ? '⬒' : '⊞'}</button>
        <button class="icon-btn" id="sp-set" aria-label="Görünüm" style="font-weight:700;font-family:var(--serif)">Aa</button>
      </div>
      <div class="sp-panes">
        ${order.map((sl, i) => `<div class="sp-pane ${slotFile(real, sl).type}" data-i="${i}">
          <div class="sp-stage" id="sp-stage-${i}"></div>
          ${slotFile(real, sl).type === 'epub' && s.flow !== 'scroll' ? `<div class="sp-tap sp-tap-l" data-i="${i}" data-dir="-1"></div><div class="sp-tap sp-tap-r" data-i="${i}" data-dir="1"></div>` : ''}
          <div class="sp-status"><b>${esc(langLabel(slotFile(real, sl)))}</b><span class="sp-chap" id="sp-chap-${i}"></span><span id="sp-pct-${i}"></span></div>
          <div class="r-loading" id="sp-load-${i}">Açılıyor…</div>
        </div>`).join('')}
      </div>
    </div>`;
  const root = $('#reader', view);

  // Okuma süresi ve durum
  let lastActivity = Date.now();
  const activity = () => { lastActivity = Date.now(); };
  const tick = setInterval(() => {
    if (document.visibilityState === 'visible' && Date.now() - lastActivity < 5 * 60 * 1000) addReadingTime(real, 10);
  }, 10000);
  if (real.status !== 'Okunuyor' && real.status !== 'Okundu') { real.status = 'Okunuyor'; await saveBook(real); }

  let saveT = null;
  const persist = () => db.putBook(real);
  const stops = [];
  const panes = await Promise.all(order.map(async (sl, i) => {
    const book = slotBook(real, sl);
    const pane = { slot: sl, book, last: null, ctrl: null, i };
    const blob = await getFileBlob(book);
    if (!blob) { $(`#sp-load-${i}`, root).innerHTML = `📄 ${esc(langLabel(book.file))} dosyası bu cihazda yok.<br><span class="small">Kitap sayfasından yeniden ekleyebilirsin.</span>`; return pane; }
    const onLocation = p => {
      activity();
      pane.last = p;
      book.progress = { ...p, updatedAt: Date.now() };
      $(`#sp-chap-${i}`, root).textContent = p.chapter || p.label || '';
      $(`#sp-pct-${i}`, root).textContent = p.percent != null ? `%${Math.floor(p.percent)}` : '';
      clearTimeout(saveT); saveT = setTimeout(persist, 1500);
    };
    try {
      const stage = $(`#sp-stage-${i}`, root);
      pane.ctrl = book.file.type === 'epub'
        ? await openEpub(stage, blob, book, { onLocation, onTap: () => {}, start: book.progress?.loc, onStuck: () => toast('Sayfa çevrilemedi: Aa → "Kaydırarak oku"yu dene') })
        : await openPdf(stage, blob, book, { onLocation, onTap: () => {}, start: book.progress?.loc, onActivity: activity });
      $(`#sp-load-${i}`, root).remove();
      if (book.file.type === 'epub') stops.push(watchSelection(stage, root, { lang: () => book.file.lang, onSave: e => addWord(book, e), isSaved: w => !!findWord(book, w),
        onHighlight: async opts => { const h = await newHighlight(book, pane.ctrl, opts); if (h) toast(h.note ? '📝 Not eklendi' : '🖍 Vurgulandı'); return !!h; } }));
    } catch (e) {
      $(`#sp-load-${i}`, root).innerHTML = `⚠️ Açılamadı<br><span class="small">${esc(e.message || '')}</span>`;
    }
    return pane;
  }));

  // Bölme başına dokunma: sol kenar geri, sağ kenar ileri, kaydırma da çevirir
  $$('.sp-tap', root).forEach(layer => {
    const pane = panes[Number(layer.dataset.i)];
    let t0 = null, swiped = false;
    const go = d => { activity(); if (pane.ctrl) (d > 0 ? pane.ctrl.next() : pane.ctrl.prev()); };
    layer.addEventListener('touchstart', e => { const t = e.changedTouches[0]; t0 = { x: t.clientX, y: t.clientY }; swiped = false; }, { passive: true });
    layer.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
    layer.addEventListener('touchend', e => {
      if (!t0) return;
      const t = e.changedTouches[0], dx = t.clientX - t0.x, dy = t.clientY - t0.y;
      t0 = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { swiped = true; go(dx < 0 ? 1 : -1); }
      else if (Math.abs(dy) > 50) { swiped = true; go(dy < 0 ? 1 : -1); }
    });
    layer.addEventListener('click', e => {
      if (swiped) { swiped = false; return; }
      go(Number(layer.dataset.dir));
    });
    let wheelAt = 0;
    layer.addEventListener('wheel', e => {
      e.preventDefault();
      if (Date.now() - wheelAt < 450 || Math.abs(e.deltaY) + Math.abs(e.deltaX) < 8) return;
      wheelAt = Date.now(); go((e.deltaY || e.deltaX) > 0 ? 1 : -1);
    }, { passive: false });
  });

  // Bölümü eşle: en son okunan bölmenin bölümünü öbürüne uygula
  let active = 0;
  $$('.sp-pane', root).forEach(el => el.addEventListener('pointerdown', () => { active = Number(el.dataset.i); }, true));
  async function syncChapter() {
    const from = panes[active], to = panes[1 - active];
    if (!from?.ctrl || !to?.ctrl || !from.last) { toast('Önce bir tarafta biraz oku'); return; }
    const [ta, tb] = await Promise.all([from.ctrl.toc(), to.ctrl.toc()]);
    const label = from.last.chapter || '';
    const n = chapterNo(label);
    let target = null;
    if (n != null) target = tb.find(t => chapterNo(t.label) === n);
    if (!target) {
      // Numara yoksa içindekilerdeki sırasına göre (ön sayfalar farklı olabilir: sondan hizala)
      const ia = ta.findIndex(t => t.label === label);
      if (ia >= 0 && ta.length && tb.length) target = tb[Math.max(0, Math.min(tb.length - 1, ia - (ta.length - tb.length)))];
    }
    if (target && to.last?.chapter === target.label) { toast('Öbür taraf zaten aynı bölümde'); return; }
    if (target) { await to.ctrl.gotoToc(target); toast(`🔗 ${target.label}`); return; }
    // İçindekiler yoksa: yüzdeye göre
    if (from.last.percent != null) {
      const v = to.book.file.type === 'pdf' ? Math.max(1, Math.round((from.last.percent / 100) * to.ctrl.rangeMax())) : Math.round(from.last.percent * 10);
      await to.ctrl.gotoRange(v);
      toast(`🔗 %${Math.floor(from.last.percent)} konumuna getirildi`);
    } else toast('Eşlenecek bölüm bulunamadı');
  }
  $('#sp-sync', root).addEventListener('click', syncChapter);

  $('#sp-dir', root).addEventListener('click', () => {
    const next = { auto: 'rows', rows: 'cols', cols: 'auto' }[rs().splitDir || 'auto'];
    rs().splitDir = next; saveSettings();
    toast(next === 'rows' ? '⬒ Üst-alt' : next === 'cols' ? '◫ Yan yana' : '⊞ Otomatik (dik: üst-alt, yatay: yan yana)');
    location.replace(`#/read/${encodeURIComponent(id)}?split=1&m=${Date.now()}`);
  });
  $('#sp-set', root).addEventListener('click', () => {
    const st = rs();
    sheet({
      title: 'Görünüm',
      body: `<div class="f-block"><h3>Arka plan</h3><div class="r-themes">${Object.entries(THEMES).map(([k, t]) => `<button data-th="${k}" class="${st.theme === k ? 'on' : ''}" style="background:${t.bg};color:${t.fg}">${t.label}</button>`).join('')}</div></div>
        <div class="f-block"><h3>Yazı boyutu</h3><div class="range-row"><button class="btn" data-fs="-10">A−</button><b id="fs-val" style="flex:1;text-align:center">%${st.fontSize}</b><button class="btn" data-fs="10">A+</button></div></div>
        <div class="f-block"><h3>Okuma düzeni</h3><div class="chip-wrap"><button class="chip ${st.flow !== 'scroll' ? 'on' : ''}" data-flow="paged">📖 Sayfa sayfa</button><button class="chip ${st.flow === 'scroll' ? 'on' : ''}" data-flow="scroll">📜 Kaydırarak oku</button></div></div>
        ${typoBlocks(st)}
        <div class="f-block"><button class="btn block" id="sp-exit">Tek ekrana dön</button></div>`,
      onMount: (el, close) => {
        $$('[data-th]', el).forEach(b => b.addEventListener('click', () => {
          st.theme = b.dataset.th; root.dataset.rtheme = st.theme; panes.forEach(p => p.ctrl?.applyStyle());
          $$('[data-th]', el).forEach(x => x.classList.toggle('on', x === b)); saveSettings();
        }));
        $$('[data-fs]', el).forEach(b => b.addEventListener('click', () => {
          st.fontSize = Math.max(70, Math.min(200, st.fontSize + Number(b.dataset.fs)));
          $('#fs-val', el).textContent = `%${st.fontSize}`; panes.forEach(p => p.book.file.type === 'epub' && p.ctrl?.applyStyle()); saveSettings();
        }));
        wireTypo(el, st, () => panes.forEach(p => p.book.file.type === 'epub' && p.ctrl?.applyStyle()));
        $$('[data-flow]', el).forEach(b => b.addEventListener('click', () => {
          close();
          if ((st.flow || 'paged') === b.dataset.flow) return;
          st.flow = b.dataset.flow; saveSettings();
          location.replace(`#/read/${encodeURIComponent(id)}?split=1&m=${Date.now()}`);
        }));
        $('#sp-exit', el).addEventListener('click', () => { close(); location.replace(`#/read/${encodeURIComponent(id)}${panes[active]?.slot === 2 ? '?f=2' : ''}`); });
      },
    });
  });
  $('#sp-close', root).addEventListener('click', () => closeReader(id));
  const onHide = () => { if (document.visibilityState === 'hidden') { saveBook(real); saveSettings(); } };
  document.addEventListener('visibilitychange', onHide);

  return async () => {
    stops.forEach(f => f());
    clearInterval(tick); clearTimeout(saveT);
    document.removeEventListener('visibilitychange', onHide);
    panes.forEach(p => { try { p.ctrl?.destroy(); } catch { /* yok */ } });
    await saveBook(real);
    await saveSettings();
  };
}

// Okuyucudan kitap sayfasına dönüş: kitap sayfasından gelindiyse geçmişte geri git
// (yoksa kitap sayfasındaki "geri" tekrar okuyucuya döner).
function closeReader(id) {
  const target = `#/book/${encodeURIComponent(id)}`;
  if (window.__lastNonRead === target && (window.__navCount || 0) > 1) history.back();
  else location.replace(target);
}

// Kaydırma modunda menü: geri (yukarı) kaydırınca açılır, okumaya devam edince (aşağı) kapanır.
function watchScrollChrome(stage, toggleChrome, isOpen) {
  let box = null, lastTop = 0, acc = 0;
  const onScroll = () => {
    const top = box.scrollTop, d = top - lastTop;
    lastTop = top;
    acc = Math.sign(d) === Math.sign(acc) ? acc + d : d;
    if (acc < -60 && !isOpen()) { toggleChrome(true); acc = 0; }
    else if (acc > 120 && isOpen()) { toggleChrome(false); acc = 0; }
  };
  const attach = () => {
    box = stage.querySelector('.epub-container');
    if (!box) { setTimeout(attach, 300); return; }
    lastTop = box.scrollTop;
    box.addEventListener('scroll', onScroll, { passive: true });
  };
  attach();
}
