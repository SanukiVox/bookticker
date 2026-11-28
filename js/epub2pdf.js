// EPUB → PDF (gerçek metinli, kitap gibi dizilmiş; küçük dosya).
// Metin Literata yazı tipiyle iki yana yaslı dizilir, Türkçe metinde satır sonunda heceden bölünür.
// Her bölüm yeni sayfada başlar; içindekiler PDF yer imi (outline) olarak eklenir; resimler yerinde kalır.
// Yazı tipi yalnızca kullanılan harflerle gömülür, içerik akışları sıkıştırılır.

const loaded = {};
const loadScript = src => (loaded[src] ||= new Promise((res, rej) => {
  const s = document.createElement('script');
  s.src = src; s.onload = res; s.onerror = () => { delete loaded[src]; rej(new Error(`${src} yüklenemedi (internet bağlantısını kontrol et)`)); };
  document.head.appendChild(s);
}));

export const SIZES = {
  phone: { label: '📱 Telefona uygun', w: 312, h: 540, m: [34, 24, 36, 24] }, // üst, sağ, alt, sol (pt)
  a5: { label: '📖 Kitap (A5)', w: 420, h: 595, m: [52, 46, 56, 46] },
};
export const FONT_SIZES = { s: ['Küçük', 10.5], m: ['Orta', 11.5], l: ['Büyük', 12.75] };

const BLOCK = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'li', 'ul', 'ol', 'section', 'article', 'aside', 'header', 'footer', 'figure', 'figcaption', 'pre', 'table', 'tbody', 'thead', 'tr', 'td', 'th', 'dl', 'dt', 'dd', 'center', 'nav', 'main', 'body', 'address', 'hgroup']);
const SKIP = new Set(['script', 'style', 'head', 'title', 'noscript', 'audio', 'video', 'iframe', 'object']);
const VOWELS = new Set([...'aeıioöuüâîûAEIİOÖUÜÂÎÛ']);
const LETTER = /\p{L}/u;

const tick = () => new Promise(r => setTimeout(r, 0));
const dirOf = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');
function resolve(base, href) {
  const clean = decodeURIComponent(String(href || '').split('#')[0]);
  if (!clean) return '';
  const parts = (clean.startsWith('/') ? clean.slice(1) : dirOf(base) + clean).split('/');
  const out = [];
  for (const p of parts) { if (p === '..') out.pop(); else if (p !== '.' && p !== '') out.push(p); }
  return out.join('/');
}
function parseXml(str, type = 'application/xhtml+xml') {
  let doc = new DOMParser().parseFromString(str, type);
  if (doc.getElementsByTagName('parsererror').length) doc = new DOMParser().parseFromString(str, 'text/html');
  return doc;
}
const els = (root, name) => [...root.getElementsByTagName('*')].filter(e => e.localName === name);

// ---------- EPUB'ı oku ----------
async function readEpub(zip) {
  const file = p => zip.file(p) || zip.file(Object.keys(zip.files).find(k => k.toLowerCase() === p.toLowerCase()) || '');
  const container = parseXml(await file('META-INF/container.xml').async('string'), 'application/xml');
  const opfPath = els(container, 'rootfile')[0]?.getAttribute('full-path');
  if (!opfPath) throw new Error('EPUB içinde kitap tanımı (OPF) bulunamadı');
  const opf = parseXml(await file(opfPath).async('string'), 'application/xml');
  const manifest = new Map();
  for (const it of els(opf, 'item')) manifest.set(it.getAttribute('id'), { href: resolve(opfPath, it.getAttribute('href')), type: it.getAttribute('media-type') || '', props: it.getAttribute('properties') || '' });
  const spineEl = els(opf, 'spine')[0];
  const spine = els(opf, 'itemref').map(r => ({ ...manifest.get(r.getAttribute('idref')), linear: r.getAttribute('linear') !== 'no' })).filter(x => x.href);
  const meta = { title: els(opf, 'title')[0]?.textContent?.trim() || '', author: els(opf, 'creator')[0]?.textContent?.trim() || '', lang: els(opf, 'language')[0]?.textContent?.trim() || '' };

  // İçindekiler: EPUB3 nav ya da EPUB2 NCX → dosya yolu → başlık (sırayla)
  const toc = [];
  const nav = [...manifest.values()].find(m => /\bnav\b/.test(m.props));
  try {
    if (nav && file(nav.href)) {
      const d = parseXml(await file(nav.href).async('string'));
      const navEl = els(d, 'nav').find(n => /toc/.test(n.getAttribute('epub:type') || n.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || '')) || els(d, 'nav')[0];
      for (const a of navEl ? els(navEl, 'a') : []) { const t = a.textContent.replace(/\s+/g, ' ').trim(); if (t) toc.push({ path: resolve(nav.href, a.getAttribute('href')), label: t }); }
    }
    if (!toc.length) {
      const ncxId = spineEl?.getAttribute('toc');
      const ncx = manifest.get(ncxId) || [...manifest.values()].find(m => m.type === 'application/x-dtbncx+xml');
      if (ncx && file(ncx.href)) {
        const d = parseXml(await file(ncx.href).async('string'), 'application/xml');
        for (const np of els(d, 'navPoint')) {
          const t = els(np, 'text')[0]?.textContent?.replace(/\s+/g, ' ').trim();
          const src = els(np, 'content')[0]?.getAttribute('src');
          if (t && src) toc.push({ path: resolve(ncx.href, src), label: t });
        }
      }
    }
  } catch { /* içindekiler olmadan da olur */ }
  return { file, spine, meta, toc };
}

// ---------- XHTML → bloklar ----------
function extractBlocks(doc, base) {
  const blocks = [];
  let cur = null;
  const flush = () => {
    if (cur) {
      const text = cur.runs.map(r => r.t).join('');
      if (text.replace(/[\s\u00a0]/g, '')) blocks.push(cur);
    }
    cur = null;
  };
  const ensure = st => (cur ||= { kind: 'p', runs: [], align: st.align, head: st.head, quote: st.quote, li: st.li });
  const styleOf = el => `${el.getAttribute('style') || ''} ${el.getAttribute('class') || ''}`.toLowerCase();
  function walk(node, st) {
    for (const ch of node.childNodes) {
      if (ch.nodeType === 3) { if (ch.nodeValue) ensure(st).runs.push({ t: ch.nodeValue, i: st.i, b: st.b }); continue; }
      if (ch.nodeType !== 1) continue;
      const tag = ch.localName.toLowerCase();
      if (SKIP.has(tag)) continue;
      if (tag === 'br') { ensure(st).runs.push({ t: '\n', i: st.i, b: st.b }); continue; }
      if (tag === 'img' || tag === 'image') {
        const src = ch.getAttribute('src') || ch.getAttribute('href') || ch.getAttribute('xlink:href') || ch.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
        if (src) { flush(); blocks.push({ kind: 'img', src: resolve(base, src), w: Number(ch.getAttribute('width')) || 0 }); }
        continue;
      }
      if (tag === 'svg') { walk(ch, st); continue; }
      if (tag === 'hr') { flush(); blocks.push({ kind: 'break', text: '' }); continue; }
      const sty = styleOf(ch);
      const nst = { ...st };
      if (['em', 'i', 'cite', 'var', 'dfn'].includes(tag) || /font-style:\s*italic|\bital(ic)?\b|\bitalics?\b|\bemph/.test(sty)) nst.i = true;
      if (['b', 'strong'].includes(tag) || /font-weight:\s*(bold|[6-9]00)|\bbold\b|\bstrong\b/.test(sty)) nst.b = true;
      if (tag === 'center' || /text-align:\s*center|\b(center|centre|centered|centred|aligncenter|text-center|ce|cent)\b/.test(sty)) nst.align = 'center';
      else if (/text-align:\s*right|\b(right|alignright|text-right)\b/.test(sty)) nst.align = 'right';
      if (/^h[1-6]$/.test(tag)) nst.head = Number(tag[1]);
      if (tag === 'blockquote') nst.quote = true;
      if (tag === 'li') nst.li = true;
      if (BLOCK.has(tag)) { flush(); walk(ch, nst); flush(); } else walk(ch, nst);
    }
  }
  walk(doc.body || doc.documentElement, { i: false, b: false, align: null, head: 0, quote: false, li: false });
  flush();
  // Sahne ayırıcıları (*** gibi)
  for (const b of blocks) {
    if (b.kind !== 'p' || b.head) continue;
    const t = b.runs.map(r => r.t).join('').replace(/\s+/g, ' ').trim();
    if (t.length <= 12 && /^[*•·◆◇✦✧❖~#§\-–—=+oO0\s]+$/.test(t) && !/^[oO0]+$/.test(t)) { b.kind = 'break'; b.text = t; }
  }
  return blocks;
}

// ---------- Türkçe heceleme (satır sonu bölme noktaları) ----------
function hyphenPoints(word) {
  const pts = [];
  const chars = [...word];
  const vow = chars.map(c => VOWELS.has(c));
  let last = -1;
  for (let k = 0; k < chars.length; k++) {
    if (!vow[k]) continue;
    if (last >= 0) {
      const between = k - last - 1;
      const at = between === 0 ? k : k - 1; // tek ünsüz ya da ünsüz kümesinin sonuncusu sonraki heceye geçer
      if (chars.slice(last + 1, k).every(c => LETTER.test(c))) pts.push(at);
    }
    last = k;
  }
  return pts.filter(p => p >= 2 && chars.length - p >= 2);
}

// ---------- Ana çevirici ----------
export async function epubToPdf(epubBlob, { size = 'phone', fontSize = 'm', lang = 'tr', title = '', author = '', onProgress = () => {} } = {}) {
  await loadScript('vendor/jszip.min.js');
  const { checkEpub } = await import('./views/reader.js');
  const buf = await checkEpub(await epubBlob.arrayBuffer()); // DRM'li dosyaları reddeder
  onProgress(0.02, 'Kütüphaneler yükleniyor…');
  await Promise.all([loadScript('vendor/pdf-lib.min.js'), loadScript('vendor/fontkit.umd.min.js')]);
  const { PDFDocument, PDFName, PDFNumber, PDFHexString, PDFOperator, rgb, StandardFonts } = window.PDFLib;
  void StandardFonts;
  const zip = await window.JSZip.loadAsync(buf);
  const book = await readEpub(zip);

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(window.fontkit);
  const fontBytes = async n => new Uint8Array(await (await fetch(`vendor/fonts/Literata-${n}.ttf`)).arrayBuffer());
  const [fR, fI, fB] = await Promise.all(['Regular', 'Italic', 'Bold'].map(fontBytes));
  const R = await pdf.embedFont(fR, { subset: true });
  const I = await pdf.embedFont(fI, { subset: true });
  const B = await pdf.embedFont(fB, { subset: true });
  const fontOf = r => (r.b ? B : r.i ? I : R);

  const S = SIZES[size] || SIZES.phone;
  const base = FONT_SIZES[fontSize]?.[1] || 11.5;
  const [mt, mr, mb, ml] = S.m;
  const W = S.w - ml - mr, top = S.h - mt, bottom = mb;
  const tr = book.meta.lang ? /^tr/i.test(book.meta.lang) : /^tr/i.test(lang || '');

  const wcache = new Map();
  const widthOf = (font, text, sz) => {
    const k = `${font === B ? 'B' : font === I ? 'I' : 'R'}${sz}|${text}`;
    let v = wcache.get(k);
    if (v == null) { v = font.widthOfTextAtSize(text, sz); wcache.set(k, v); }
    return v;
  };
  const clean = s => s.replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/g, '').replace(/[\u2028\u2029]/g, '\n');

  // Sayfa ve yazım durumu
  let page = null, y = 0, pageHasContent = false;
  const pages = [];
  const fontKeys = new Map();
  function newPage() {
    page = pdf.addPage([S.w, S.h]);
    pages.push(page);
    fontKeys.clear();
    y = top; pageHasContent = false;
  }
  const keyOf = font => {
    let k = fontKeys.get(font);
    if (!k) { k = page.node.newFontDictionary(font.name, font.ref); fontKeys.set(font, k); }
    return k;
  };
  const ensureSpace = h => { if (!page || y - h < bottom) newPage(); };

  // Bir satırı tek metin nesnesi olarak çiz: kelimeler arası boşluk TJ kaydırmalarıyla (iki yana yaslama)
  function drawLine(items, x, baseline, sz, gaps) {
    const ops = [PDFOperator.of('BT'), PDFOperator.of('Tm', [1, 0, 0, 1, x, baseline].map(n => PDFNumber.of(Number(n.toFixed(2)))))];
    let curFont = null, arr = [], pendingGap = 0;
    const flushArr = () => { if (arr.length) { ops.push(PDFOperator.of('TJ', [pdf.context.obj(arr)])); arr = []; } };
    items.forEach((it, idx) => {
      if (idx > 0) pendingGap += gaps[idx - 1];
      for (const seg of it.segs) {
        if (seg.font !== curFont) { flushArr(); ops.push(PDFOperator.of('Tf', [keyOf(seg.font), PDFNumber.of(sz)])); curFont = seg.font; }
        if (pendingGap) { arr.push(PDFNumber.of(Number((-pendingGap * 1000 / sz).toFixed(1)))); pendingGap = 0; }
        arr.push(seg.font.encodeText(seg.text));
      }
    });
    flushArr();
    ops.push(PDFOperator.of('ET'));
    page.pushOperators(...ops);
  }

  // Paragrafı satırlara böl ve çiz
  function layoutParagraph(blk, opts) {
    const sz = opts.size, lh = sz * opts.lead;
    const left = ml + (opts.inset || 0), maxW = W - (opts.inset || 0) * 2;
    // Kelimelere ayır (stil sınırları kelimenin içinde olabilir)
    const words = []; let curW = null;
    const pushWord = (nl) => { if (curW && curW.segs.length) words.push(curW); curW = null; if (nl) words.push({ nl: true }); };
    const runs = opts.prefix ? [{ t: opts.prefix, i: false, b: false }, ...blk.runs] : blk.runs;
    for (const r of runs) {
      const font = opts.font || fontOf(r);
      const text = clean(r.t);
      let buf = '';
      const emit = () => { if (buf) { (curW ||= { segs: [] }).segs.push({ font, text: buf }); buf = ''; } };
      for (const c of text) {
        if (c === '\n') { emit(); pushWord(true); }
        else if (/[\s]/.test(c) && c !== '\u00a0') { emit(); pushWord(false); }
        else buf += c;
      }
      emit();
    }
    pushWord(false);
    while (words.length && words[words.length - 1].nl) words.pop();
    for (const w of words) if (!w.nl) w.width = w.segs.reduce((s, g) => s + widthOf(g.font, g.text, sz), 0);
    const spaceW = widthOf(R, ' ', sz);
    const hyW = widthOf(R, '-', sz);

    const lines = [];
    let line = { items: [], width: 0, indent: opts.indent || 0 };
    const avail = l => maxW - l.indent;
    const endLine = (last) => { line.last = last; lines.push(line); line = { items: [], width: 0, indent: 0 }; };
    for (let i = 0; i < words.length; i++) {
      let w = words[i];
      if (w.nl) { if (line.items.length) endLine(true); continue; }
      for (;;) {
        const need = line.items.length ? line.width + spaceW + w.width : w.width;
        if (need <= avail(line) + 0.01) { line.items.push(w); line.width = need; break; }
        // Bölmeyi dene: Türkçe heceleme, yalnızca tek stilli kelimelerde
        let split = null;
        if (opts.hyphenate && w.segs.length === 1) {
          const t = w.segs[0].text, f = w.segs[0].font;
          const m = t.match(/^([\p{L}]+)([^\p{L}]*)$/u);
          if (m && m[1].length >= 5) {
            const room = avail(line) - (line.items.length ? line.width + spaceW : 0) - hyW;
            const chars = [...m[1]];
            const pts = hyphenPoints(m[1]).reverse();
            for (const p of pts) {
              const pre = chars.slice(0, p).join('');
              if (widthOf(f, pre, sz) <= room) {
                const post = chars.slice(p).join('') + m[2];
                split = [{ segs: [{ font: f, text: `${pre}-` }], width: widthOf(f, `${pre}-`, sz) }, { segs: [{ font: f, text: post }], width: widthOf(f, post, sz) }];
                break;
              }
            }
          }
        }
        if (split && (line.items.length || true)) { line.items.push(split[0]); line.width += (line.items.length > 1 ? spaceW : 0) + split[0].width; endLine(false); w = split[1]; continue; }
        if (!line.items.length) {
          // Tek başına sığmayan çok uzun kelime: harf harf böl
          const seg = w.segs[0]; const cs = [...seg.text]; let k = cs.length - 1;
          while (k > 1 && widthOf(seg.font, cs.slice(0, k).join(''), sz) > avail(line)) k--;
          const a = { segs: [{ font: seg.font, text: cs.slice(0, k).join('') }] }; a.width = widthOf(seg.font, a.segs[0].text, sz);
          const b = { segs: [{ font: seg.font, text: cs.slice(k).join('') }, ...w.segs.slice(1)] }; b.width = b.segs.reduce((s, g) => s + widthOf(g.font, g.text, sz), 0);
          line.items.push(a); line.width = a.width; endLine(false); w = b; continue;
        }
        endLine(false);
      }
    }
    if (line.items.length) endLine(true);

    // Çiz
    if (opts.keepWithNext) ensureSpace(lh * Math.min(lines.length + 3, 6));
    for (const ln of lines) {
      ensureSpace(lh);
      const baseline = y - sz;
      const n = ln.items.length;
      let x = left + ln.indent;
      const gaps = new Array(Math.max(0, n - 1)).fill(spaceW);
      const slack = maxW - ln.indent - ln.width;
      if (opts.align === 'center') x += slack / 2;
      else if (opts.align === 'right') x += slack;
      else if (!ln.last && n > 1 && opts.justify && slack < maxW * 0.35) gaps.fill(spaceW + slack / (n - 1));
      drawLine(ln.items, x, baseline, sz, gaps);
      y -= lh; pageHasContent = true;
    }
    return lines.length;
  }

  // Resim
  const imgCache = new Map();
  async function embedImage(path) {
    if (imgCache.has(path)) return imgCache.get(path);
    const p = (async () => {
      const f = book.file(path);
      if (!f) return null;
      const bytes = await f.async('uint8array');
      const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8, isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
      let bmp;
      try { bmp = await createImageBitmap(new Blob([bytes])); } catch { return null; }
      const nat = { w: bmp.width, h: bmp.height };
      // Kalite: sayfa genişliğinin ~2,2 katı piksel yeterli (telefon ekranı için keskin)
      const maxPx = Math.round(Math.max(W, top - bottom) * 2.2);
      const big = Math.max(nat.w, nat.h) > maxPx;
      let img;
      try {
        if (isJpg && !big) img = await pdf.embedJpg(bytes); // olduğu gibi
        else if (isPng && !big && bytes.length < 150000) img = await pdf.embedPng(bytes); // küçük süsler, şeffaflık korunur
        else {
          const k = big ? maxPx / Math.max(nat.w, nat.h) : 1;
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(nat.w * k)); c.height = Math.max(1, Math.round(nat.h * k));
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(bmp, 0, 0, c.width, c.height);
          const jb = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
          c.width = c.height = 0;
          img = await pdf.embedJpg(new Uint8Array(await jb.arrayBuffer()));
        }
      } catch { img = null; }
      bmp.close?.();
      return img ? { img, nat } : null;
    })();
    imgCache.set(path, p);
    return p;
  }
  async function placeImage(blk, fullPage) {
    const r = await embedImage(blk.src);
    if (!r) return;
    const { img, nat } = r;
    const boxH = top - bottom;
    let w, h;
    if (fullPage) { const k = Math.min(W / nat.w, boxH / nat.h); w = nat.w * k; h = nat.h * k; }
    else {
      // Küçük resimler (süs, simge) doğal boyutuna yakın; büyükler sayfa genişliğine
      const natPt = (blk.w || nat.w) * 0.75;
      w = Math.min(W, natPt);
      h = w * nat.h / nat.w;
      if (h > boxH) { h = boxH; w = h * nat.w / nat.h; }
    }
    if (fullPage) { if (pageHasContent || !page) newPage(); }
    else if (!page || y - h < bottom) newPage();
    const x = ml + (W - w) / 2;
    const yy = fullPage ? bottom + (boxH - h) / 2 : y - h;
    page.drawImage(img, { x, y: yy, width: w, height: h });
    y = yy - base * 0.6; pageHasContent = true;
    if (fullPage) y = bottom - 1; // sonraki içerik yeni sayfada
  }

  // Bölümler
  const outline = [];
  const tocByPath = new Map();
  for (const t of book.toc) if (!tocByPath.has(t.path)) tocByPath.set(t.path, t.label);
  const total = book.spine.length;
  for (let si = 0; si < total; si++) {
    const it = book.spine[si];
    onProgress(0.05 + 0.85 * (si / total), `Bölüm ${si + 1} / ${total}`);
    await tick();
    if (!/html|xml/.test(it.type) && !/\.x?html?$/i.test(it.href)) continue;
    const f = book.file(it.href);
    if (!f) continue;
    let blocks;
    try { blocks = extractBlocks(parseXml(await f.async('string')), it.href); } catch { continue; }
    if (!blocks.length) continue;
    // Yeni bölüm yeni sayfada
    if (!page || pageHasContent) newPage();
    const startPage = pages.length - 1;
    const label = tocByPath.get(it.href);
    if (label) outline.push({ label, page: startPage });
    const onlyImage = blocks.every(b => b.kind === 'img');
    if (!onlyImage) y -= base * 1.45 * (blocks[0].head ? 2 : 1);
    let afterBreak = true;
    for (const blk of blocks) {
      if (blk.kind === 'img') { await placeImage(blk, onlyImage && blocks.length === 1); afterBreak = true; continue; }
      if (blk.kind === 'break') {
        const t = blk.text || '⁂';
        y -= base * 0.5;
        layoutParagraph({ runs: [{ t, i: false, b: false }] }, { size: base, lead: 1.45, align: 'center', font: R });
        y -= base * 0.5; afterBreak = true; continue;
      }
      if (blk.head) {
        const sz = base * ({ 1: 1.55, 2: 1.4, 3: 1.22 }[blk.head] || 1.1);
        if (pageHasContent) y -= base * 1.2;
        layoutParagraph(blk, { size: sz, lead: 1.3, align: 'center', font: B, keepWithNext: true, hyphenate: false });
        y -= base * 0.9; afterBreak = true; continue;
      }
      const center = blk.align === 'center' || blk.align === 'right';
      layoutParagraph(blk, {
        size: base, lead: 1.45,
        align: blk.align || 'justify', justify: !center,
        indent: !center && !afterBreak && !blk.li ? base * 1.3 : 0,
        inset: blk.quote ? base * 1.4 : 0,
        prefix: blk.li ? '• ' : '',
        hyphenate: tr && !center,
      });
      if (center) y -= base * 0.25;
      afterBreak = false;
    }
  }
  if (!pages.length) throw new Error('EPUB içinde metin bulunamadı');

  // Sayfa numaraları (kapak hariç)
  onProgress(0.92, 'Sayfa numaraları…');
  pages.forEach((p, i) => {
    if (i === 0) return;
    const t = String(i + 1), sz = base * 0.72;
    p.drawText(t, { x: (S.w - R.widthOfTextAtSize(t, sz)) / 2, y: mb / 2 - sz / 2, size: sz, font: R, color: rgb(0.45, 0.45, 0.45) });
  });

  // İçindekiler (PDF yer imleri)
  if (outline.length) {
    const ctx = pdf.context;
    const rootRef = ctx.nextRef();
    const refs = outline.map(() => ctx.nextRef());
    outline.forEach((o, i) => {
      const d = new Map();
      d.set(PDFName.of('Title'), PDFHexString.fromText(o.label));
      d.set(PDFName.of('Parent'), rootRef);
      if (i > 0) d.set(PDFName.of('Prev'), refs[i - 1]);
      if (i < refs.length - 1) d.set(PDFName.of('Next'), refs[i + 1]);
      d.set(PDFName.of('Dest'), ctx.obj([pages[o.page].ref, PDFName.of('Fit')]));
      ctx.assign(refs[i], ctx.obj(Object.fromEntries([...d].map(([k, v]) => [k.asString().slice(1), v]))));
    });
    ctx.assign(rootRef, ctx.obj({ Type: 'Outlines', First: refs[0], Last: refs[refs.length - 1], Count: refs.length }));
    pdf.catalog.set(PDFName.of('Outlines'), rootRef);
  }

  pdf.setTitle(title || book.meta.title || 'Kitap');
  if (author || book.meta.author) pdf.setAuthor(author || book.meta.author);
  pdf.setLanguage(tr ? 'tr' : (book.meta.lang || 'en'));
  pdf.setCreator('Kitaplığım');
  pdf.setProducer('Kitaplığım');

  onProgress(0.95, 'PDF kaydediliyor…');
  await tick();
  const bytes = await pdf.save({ useObjectStreams: true });
  onProgress(1, 'Bitti');
  return { blob: new Blob([bytes], { type: 'application/pdf' }), pages: pages.length };
}
