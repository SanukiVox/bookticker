// Kitap dosyasından (EPUB/PDF) düz metin çıkarma: tüm kitap ya da okunan yere kadar.
import { displayTitle } from './store.js';
import { getFileBlob } from './files.js';

const loaded = {};
const loadScript = src => (loaded[src] ||= new Promise((res, rej) => {
  const s = document.createElement('script');
  s.src = src; s.onload = res; s.onerror = () => { delete loaded[src]; rej(new Error('Kütüphane yüklenemedi')); };
  document.head.appendChild(s);
}));

const tidy = t => t.replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();

// onProgress(0..1)
export async function extractText(book, { upToProgress = true, onProgress } = {}) {
  const blob = await getFileBlob(book);
  if (!blob) throw new Error('Kitap dosyası bu cihazda yok');
  return book.file.type === 'epub' ? epubText(book, blob, upToProgress, onProgress) : pdfText(book, blob, upToProgress, onProgress);
}

async function epubText(book, blob, upTo, onProgress) {
  await loadScript('vendor/jszip.min.js');
  await loadScript('vendor/epub.min.js');
  const ePub = window.ePub;
  const { checkEpub } = await import('./views/reader.js');
  const eb = ePub(await checkEpub(await blob.arrayBuffer()));
  await eb.ready;
  const nav = await eb.loaded.navigation;
  const labels = new Map();
  (function walk(items) { for (const it of items || []) { labels.set((it.href || '').split('#')[0], (it.label || '').trim()); walk(it.subitems); } })(nav.toc);

  const cfi = upTo ? book.progress?.loc : null;
  let stopIndex = Infinity;
  let parsed = null;
  if (cfi && typeof cfi === 'string') {
    try { parsed = new ePub.CFI(cfi); stopIndex = parsed.spinePos; } catch { /* konum okunamadı: tümü */ }
  }
  const sections = [];
  eb.spine.each(s => sections.push(s));
  const parts = [];
  for (let i = 0; i < sections.length && i <= stopIndex; i++) {
    const sec = sections[i];
    let text = '';
    try {
      // section.load <html> öğesini döndürür; konum hesabı için belgenin kendisi gerekir.
      const root = await sec.load(eb.load.bind(eb));
      const doc = root.ownerDocument || root;
      const body = doc.body || root.querySelector?.('body') || doc.documentElement;
      if (i === stopIndex && parsed) {
        // Bu bölümde sadece kalınan yere kadar
        try {
          const range = parsed.toRange(doc);
          const before = doc.createRange();
          before.setStart(body, 0);
          before.setEnd(range.startContainer, range.startOffset);
          text = before.toString();
        } catch { text = ''; }
      } else {
        text = blockText(body);
      }
    } catch { /* bozuk bölüm atlanır */ }
    sec.unload?.();
    const label = labels.get(sec.href) || [...labels.entries()].find(([h]) => h && (sec.href.endsWith(h) || h.endsWith(sec.href)))?.[1];
    text = tidy(text);
    if (text) parts.push(label ? `\n\n## ${label}\n\n${text}` : `\n\n${text}`);
    onProgress?.((i + 1) / Math.min(sections.length, stopIndex + 1));
  }
  eb.destroy();
  return { text: tidy(parts.join('')), partial: Number.isFinite(stopIndex) };
}

// Paragrafları satır sonlarıyla koruyarak metin çıkar
function blockText(node) {
  const out = [];
  const walk = n => {
    if (n.nodeType === 3) { out.push(n.nodeValue); return; }
    if (n.nodeType !== 1) return;
    const tag = n.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style') return;
    const block = /^(p|div|h[1-6]|li|br|blockquote|section|tr)$/.test(tag);
    if (block) out.push('\n');
    for (const c of n.childNodes) walk(c);
    if (block) out.push('\n');
  };
  walk(node);
  return out.join('');
}

async function pdfText(book, blob, upTo, onProgress) {
  const base = new URL('../vendor/pdfjs/', import.meta.url).href;
  const pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs';
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false, standardFontDataUrl: base + 'standard_fonts/' }).promise;
  const last = upTo && book.progress?.page ? Math.min(doc.numPages, Number(book.progress.page)) : doc.numPages;
  const parts = [];
  for (let n = 1; n <= last; n++) {
    const page = await doc.getPage(n);
    const tc = await page.getTextContent();
    let s = '';
    for (const it of tc.items) { s += it.str; s += it.hasEOL ? '\n' : ' '; }
    parts.push(`\n\n[Sayfa ${n}]\n${tidy(s)}`);
    page.cleanup();
    onProgress?.(n / last);
  }
  const total = doc.numPages;
  doc.destroy();
  return { text: tidy(parts.join('')), partial: last < total, pages: last, total };
}

export function bookTextFile(book, { text, partial, pages, total }) {
  const p = book.progress || {};
  const where = !partial ? 'Kitabın tamamı.'
    : pages ? `Kitabın ${pages}. sayfasına kadar olan kısmı (toplam ${total} sayfa).`
      : `Kitabın okunan yerine kadar olan kısmı (yaklaşık %${Math.floor(p.percent || 0)}).`;
  const header = `${displayTitle(book)}${book.originalTitle && book.originalTitle !== book.title ? ` (${book.originalTitle})` : ''}${book.author ? ' — ' + book.author : ''}\n${where}\n\n`;
  const safe = displayTitle(book).replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60);
  const name = `${safe} - ${partial ? 'okuduğum yere kadar' : 'tüm kitap'}.txt`;
  return new File([header + text], name, { type: 'text/plain' });
}
