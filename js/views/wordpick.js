// EPUB okurken kelime/ifade seçip çevirme.
// Sayfa sayfa modunda sayfanın üstünde dokunma katmanı olduğu için tarayıcının kendi seçimi çalışmaz:
// basılı tutunca altındaki kelimeyi biz seçeriz, parmak kaldırılmadan sürüklenirse seçim genişler.
import { esc, sheet, toast, $ } from '../ui.js';

const LONG_MS = 450;
const WORD = /[\p{L}\p{N}'’\-]/u;

// Katmanın altındaki iframe ve o noktadaki metin konumu
function caretAt(stage, x, y) {
  for (const f of stage.querySelectorAll('iframe')) {
    const r = f.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
    const doc = f.contentDocument;
    if (!doc) continue;
    const cx = x - r.left, cy = y - r.top;
    let node = null, offset = 0;
    if (doc.caretRangeFromPoint) { const rg = doc.caretRangeFromPoint(cx, cy); if (rg) { node = rg.startContainer; offset = rg.startOffset; } }
    else if (doc.caretPositionFromPoint) { const p = doc.caretPositionFromPoint(cx, cy); if (p) { node = p.offsetNode; offset = p.offset; } }
    if (!node || node.nodeType !== 3) return null;
    return { doc, frame: f, node, offset };
  }
  return null;
}

function wordRange(c) {
  const t = c.node.data;
  let s = Math.min(c.offset, t.length);
  // Parmak kelimenin hemen yanına (boşluk, noktalama) bastıysa en yakın kelimeyi al
  if (!WORD.test(t[s] || '')) {
    const back = [1, 2, 3].find(k => WORD.test(t[s - k] || ''));
    const fwd = [1, 2].find(k => WORD.test(t[s + k] || ''));
    if (back != null && (fwd == null || back <= fwd)) s -= back; else if (fwd != null) s += fwd; else return null;
  }
  let e = s;
  while (s > 0 && WORD.test(t[s - 1])) s--;
  while (e < t.length && WORD.test(t[e])) e++;
  const r = c.doc.createRange();
  r.setStart(c.node, s); r.setEnd(c.node, e);
  return r;
}

// İki uç arasındaki aralığı, kelime sınırlarına genişleterek kur
function spanRange(a, b) {
  const doc = a.startContainer.ownerDocument;
  const r = doc.createRange();
  const cmp = a.compareBoundaryPoints(Range.START_TO_START, b);
  const [first, last] = cmp <= 0 ? [a, b] : [b, a];
  r.setStart(first.startContainer, first.startOffset);
  r.setEnd(last.endContainer, last.endOffset);
  return r;
}

const clean = s => String(s || '').replace(/\s+/g, ' ').replace(/^[\s"“”'‘’(]+|[\s"“”'‘’),.;:!?]+$/g, '').trim();

// Katmana basılı tut → seç → çeviri paneli. active() true iken diğer dokunma işleyicileri çalışmamalı.
export function attachWordPicker(layer, stage, { lang = () => 'orig' } = {}) {
  let timer = null, start = null, anchor = null, range = null, picking = false;
  const marks = document.createElement('div');
  marks.className = 'wp-marks';
  layer.appendChild(marks);

  const draw = () => {
    marks.innerHTML = '';
    if (!range) return;
    const lr = layer.getBoundingClientRect();
    const fr = range.startContainer.ownerDocument.defaultView.frameElement.getBoundingClientRect();
    for (const q of range.getClientRects()) {
      const d = document.createElement('i');
      d.style.cssText = `left:${q.left + fr.left - lr.left}px;top:${q.top + fr.top - lr.top}px;width:${q.width}px;height:${q.height}px`;
      marks.appendChild(d);
    }
  };
  const reset = () => { clearTimeout(timer); timer = null; picking = false; anchor = null; range = null; marks.innerHTML = ''; };

  layer.addEventListener('touchstart', e => {
    if (e.touches.length > 1) { reset(); return; }
    const t = e.touches[0];
    start = { x: t.clientX, y: t.clientY };
    clearTimeout(timer);
    timer = setTimeout(() => {
      const c = caretAt(stage, start.x, start.y);
      const w = c && wordRange(c);
      if (!w) return;
      picking = true; anchor = w; range = w; draw();
      navigator.vibrate?.(10);
    }, LONG_MS);
  }, { passive: true });

  layer.addEventListener('touchmove', e => {
    const t = e.touches[0];
    if (!picking) {
      if (start && Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10) { clearTimeout(timer); timer = null; }
      return;
    }
    e.stopImmediatePropagation();
    const c = caretAt(stage, t.clientX, t.clientY);
    const w = c && (wordRange(c) || (() => { const r = c.doc.createRange(); r.setStart(c.node, c.offset); r.setEnd(c.node, c.offset); return r; })());
    if (w && w.startContainer.ownerDocument === anchor.startContainer.ownerDocument) { range = spanRange(anchor, w); draw(); }
  }, { passive: true });

  layer.addEventListener('touchend', e => {
    clearTimeout(timer); timer = null;
    if (!picking) return;
    e.stopImmediatePropagation();
    e.preventDefault(); // parmak kalkınca oluşan tıklama yeni açılan paneli kapatmasın / sayfa çevirmesin
    const text = clean(range?.toString());
    picking = false;
    if (text) setTimeout(() => openTranslate(text, { lang: lang(), onClose: () => { range = null; marks.innerHTML = ''; } }), 60);
    else reset();
  });
  layer.addEventListener('touchcancel', reset);
  // Fareyle (tablet + fare / bilgisayar): sağ tık ya da çift tık kelimeyi çevirir
  layer.addEventListener('dblclick', e => {
    const c = caretAt(stage, e.clientX, e.clientY);
    const w = c && wordRange(c);
    if (!w) return;
    e.stopImmediatePropagation();
    range = w; draw();
    openTranslate(clean(w.toString()), { lang: lang(), onClose: () => { range = null; marks.innerHTML = ''; } });
  });
  return { active: () => picking };
}

// ---------- Çeviri ----------
const cache = new Map();
async function fetchTranslation(text, to) {
  const key = `${to}|${text}`;
  if (cache.has(key)) return cache.get(key);
  let out = null;
  try {
    const r = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${to}&dt=t&dt=bd&q=${encodeURIComponent(text)}`);
    if (r.ok) {
      const j = await r.json();
      const main = (j[0] || []).map(x => x?.[0] || '').join('').trim();
      const alts = (j[1] || []).map(d => ({ pos: d[0], words: (d[1] || []).slice(0, 6) })).filter(d => d.words.length);
      if (main) out = { main, alts, src: j[2] };
    }
  } catch { /* yedek kaynağa geç */ }
  if (!out) {
    try {
      const from = to === 'tr' ? 'en' : 'tr';
      const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${from}|${to}`);
      const j = await r.json();
      const main = j?.responseData?.translatedText;
      if (main && !/MYMEMORY WARNING/i.test(main)) out = { main, alts: [] };
    } catch { /* yok */ }
  }
  if (out) cache.set(key, out);
  return out;
}

const POS = { noun: 'isim', verb: 'fiil', adjective: 'sıfat', adverb: 'zarf', preposition: 'edat', pronoun: 'zamir', conjunction: 'bağlaç', interjection: 'ünlem', isim: 'isim', fiil: 'fiil', sıfat: 'sıfat', zarf: 'zarf' };

export function openTranslate(text, { lang = 'orig', onClose } = {}) {
  text = clean(text);
  if (!text) return;
  // Orijinali okurken Türkçeye, çeviriyi okurken İngilizceye
  const to = lang === 'tr' ? 'en' : 'tr';
  const from = to === 'tr' ? 'en' : 'tr';
  const single = !/\s/.test(text) && text.length < 40;
  const q = encodeURIComponent(text);
  const links = [
    ['DeepL', `https://www.deepl.com/translator#${from}/${to}/${q}`],
    ['Google Çeviri', `https://translate.google.com/?sl=auto&tl=${to}&text=${q}&op=translate`],
    ...(single ? [['Tureng', `https://tureng.com/tr/${to === 'tr' ? 'turkce-ingilizce' : 'ingilizce-turkce'}/${q}`]] : []),
  ];
  sheet({
    title: to === 'tr' ? '🔤 Türkçesi' : '🔤 İngilizcesi',
    body: `<div class="wp-src">${esc(text)}</div>
      <div class="wp-out" id="wp-out"><span class="muted">Çevriliyor…</span></div>
      <div class="chip-wrap" style="margin-top:12px">${links.map(([l, u]) => `<a class="chip" href="${esc(u)}" target="_blank" rel="noopener">${l} ↗</a>`).join('')}<button class="chip" id="wp-copy">📋 Kopyala</button></div>`,
    onClose,
    onMount: async el => {
      $('#wp-copy', el).addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(text); toast('Kopyalandı'); } catch { toast('Kopyalanamadı'); }
      });
      const res = await fetchTranslation(text, to);
      const out = $('#wp-out', el);
      if (!out) return;
      if (!res) { out.innerHTML = '<span class="muted">Çeviri alınamadı (internet yok mu?). Yukarıdaki düğmelerle DeepL ya da Google Çeviri\'de açabilirsin.</span>'; return; }
      out.innerHTML = `<div class="wp-main">${esc(res.main)}</div>${res.alts.length && single ? res.alts.map(a => `<div class="small" style="margin-top:6px"><b>${esc(POS[a.pos] || a.pos)}:</b> ${esc(a.words.join(', '))}</div>`).join('') : ''}`;
    },
  });
}

// ---------- iPhone'un kendi seçimiyle çalışan otomatik çeviri kartı ----------
// Kitap sayfası korumalı bir çerçevede olduğundan iPhone seçim olaylarını bildirmez; seçimi biz yoklarız.
// Kart ekranı karartmaz, seçimi bozmaz; iPhone'un kendi menüsü (Kopyala, Çeviri → DeepL) çalışmaya devam eder.
function currentSelection(stage) {
  for (const f of stage.querySelectorAll('iframe')) {
    try {
      const sel = f.contentDocument?.getSelection?.();
      const t = String(sel || '');
      if (t.trim()) return { text: t, ctx: sentenceAround(sel, t) };
    } catch { /* yok */ }
  }
  return { text: '', ctx: '' };
}

// Seçimin geçtiği cümle (kelime defteri için)
function sentenceAround(sel, text) {
  try {
    let n = sel.getRangeAt(0).commonAncestorContainer;
    if (n.nodeType === 3) n = n.parentElement;
    const block = n.closest('p, li, blockquote, div') || n;
    const all = block.textContent.replace(/\s+/g, ' ').trim();
    const t = text.replace(/\s+/g, ' ').trim();
    const i = all.indexOf(t);
    if (i < 0) return all.slice(0, 240);
    const before = all.slice(0, i), after = all.slice(i + t.length);
    const s = Math.max(before.search(/[^.!?…]*$/), 0);
    const m = after.match(/^[^.!?…]*[.!?…”"’]*/);
    return (before.slice(s) + t + (m ? m[0] : '')).trim().slice(0, 400);
  } catch { return ''; }
}

export function watchSelection(stage, mount, { lang = () => 'orig', onSave, isSaved, onHighlight } = {}) {
  const card = document.createElement('div');
  card.className = 'sel-card hidden';
  mount.appendChild(card);
  let last = '', pending = '', shownFor = '', dismissed = '', ctxNow = '', trNow = '';
  const hide = () => { card.classList.add('hidden'); shownFor = ''; };
  const show = async text => {
    shownFor = text;
    const to = lang() === 'tr' ? 'en' : 'tr', from = to === 'tr' ? 'en' : 'tr';
    const single = !/\s/.test(text) && text.length < 40;
    const q = encodeURIComponent(text);
    trNow = '';
    const ctx = ctxNow;
    card.innerHTML = `<div class="sel-row"><div class="sel-src">${esc(text)}</div><button class="sel-x" aria-label="Kapat">✕</button></div>
      <div class="sel-out"><span class="muted">Çevriliyor…</span></div>
      <div class="sel-links"><a href="https://www.deepl.com/translator#${from}/${to}/${q}" target="_blank" rel="noopener">DeepL ↗</a><a href="https://translate.google.com/?sl=auto&tl=${to}&text=${q}&op=translate" target="_blank" rel="noopener">Google ↗</a>${single ? `<a href="https://tureng.com/tr/${to === 'tr' ? 'turkce-ingilizce' : 'ingilizce-turkce'}/${q}" target="_blank" rel="noopener">Tureng ↗</a>` : ''}${onSave && text.length <= 80 ? `<button class="sel-save">${isSaved?.(text) ? '✓ Defterde' : '📒 Deftere ekle'}</button>` : ''}</div>
      ${onHighlight ? `<div class="sel-acts"><button data-hl="yellow"><i style="background:#ffd84d"></i>Vurgula</button><button data-hl="green"><i style="background:#8fdc8f"></i></button><button data-hl="blue"><i style="background:#8cc8ff"></i></button><button data-hl="pink"><i style="background:#ffa3c4"></i></button><button data-note>📝 Not</button></div>` : ''}`;
    card.classList.remove('hidden');
    card.querySelector('.sel-x').addEventListener('click', () => { dismissed = text; hide(); });
    card.querySelectorAll('[data-hl]').forEach(b => b.addEventListener('click', async () => {
      if (await onHighlight({ color: b.dataset.hl })) { dismissed = text; hide(); }
    }));
    card.querySelector('[data-note]')?.addEventListener('click', async () => {
      if (await onHighlight({ color: 'yellow', askNote: true })) { dismissed = text; hide(); }
    });
    card.querySelector('.sel-save')?.addEventListener('click', async e => {
      const btn = e.currentTarget;
      if (isSaved?.(text)) return;
      await onSave({ w: text, t: trNow, ctx, lang: lang() });
      btn.textContent = '✓ Defterde';
      toast('📒 Deftere eklendi');
    });
    const res = await fetchTranslation(text, to);
    if (shownFor !== text) return;
    trNow = res?.main || '';
    const out = card.querySelector('.sel-out');
    out.innerHTML = res
      ? `<b>${esc(res.main)}</b>${single && res.alts.length ? `<div class="small muted">${res.alts.slice(0, 2).map(a => `${esc(POS[a.pos] || a.pos)}: ${esc(a.words.slice(0, 4).join(', '))}`).join(' · ')}</div>` : ''}`
      : '<span class="muted">Çeviri alınamadı; DeepL ya da Google düğmesini kullan.</span>';
  };
  const timer = setInterval(() => {
    const cur = currentSelection(stage);
    const t = clean(cur.text);
    if (t) ctxNow = cur.ctx;
    if (!t) { last = pending = ''; dismissed = ''; if (shownFor) hide(); return; }
    // Seçim parmakla genişletilirken her adımda çevirmesin: iki yoklamada aynı kalınca göster
    if (t !== pending) { pending = t; return; }
    if (t === last || t === dismissed) return;
    last = t;
    show(t);
  }, 450);
  return () => { clearInterval(timer); card.remove(); };
}
