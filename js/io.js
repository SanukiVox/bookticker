// Excel içe/dışa aktarma ve yedekleme.
import { state, CRITERIA, newBook, norm, computeScore, replaceAll, addBooks, learnOptions, saveSettings } from './store.js';
import { db } from './db.js';

let xlsxP = null;
function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  xlsxP ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'vendor/xlsx.full.min.js';
    s.onload = () => res(window.XLSX);
    s.onerror = () => { xlsxP = null; rej(new Error('Excel kütüphanesi yüklenemedi')); };
    document.head.appendChild(s);
  });
  return xlsxP;
}

// Excel sütun başlığı → kitap alanı
const COLUMNS = [
  ['priority', 'Öncelik'],
  ['title', 'Kitap adı'],
  ['originalTitle', 'Orijinal adı (farklıysa)'],
  ['author', 'Yazar'],
  ['series', 'Seri'],
  ['seriesOrder', 'Seri sırası'],
  ['genre', 'Tür'],
  ['translation', 'Türkçe çeviri'],
  ['publisher', 'Türkçe yayınevi'],
  ['status', 'Okuma durumu'],
  ...CRITERIA.map(c => [`score:${c.key}`, c.label]),
  ['spicy', 'Spicy / +18'],
  ['goodreads', 'Goodreads puanı'],
  ['goodreadsVotes', 'Goodreads oy sayısı'],
  ['_score', 'Genel uyum puanı'],
  ['confidence', 'Güven'],
  ['review', 'Kısa değerlendirme'],
  ['warnings', 'İçerik uyarıları'],
  ['inVisuals', 'Görsellerde var mı'],
  ['summary', 'Özet'],
  ['tags', 'Etiketler'],
  ['favorite', 'Favori'],
  ['startDate', 'Başlama tarihi'],
  ['endDate', 'Bitirme tarihi'],
  ['myRating', 'Benim puanım'],
  ['notes', 'Notlarım'],
  ['quotes', 'Alıntılar'],
];

function matchColumn(header) {
  const h = norm(header);
  if (!h) return null;
  const exact = COLUMNS.find(([, l]) => norm(l) === h);
  if (exact) return exact[0];
  if (h.startsWith('orijinal')) return 'originalTitle';
  if (h.startsWith('spicy')) return 'spicy';
  if (h.includes('yayinevi')) return 'publisher';
  return null;
}

const num = v => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v));
const list = v => String(v ?? '').split(/[,;]\s*/).map(s => s.trim()).filter(Boolean);
const dateStr = v => {
  if (!v) return '';
  if (v instanceof Date) return new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

// Excel dosyasını oku → { books, weights, rules }
export async function readExcel(file) {
  const XLSX = await loadXLSX();
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const sheetName = wb.SheetNames.find(n => norm(n) === 'kitaplar') || wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null, raw: true });
  const headerIdx = rows.findIndex(r => r.some(c => matchColumn(c) === 'title'));
  if (headerIdx < 0) throw new Error('"Kitap adı" sütunu bulunamadı');
  const map = rows[headerIdx].map(matchColumn);
  const books = [];
  const now = Date.now();
  rows.slice(headerIdx + 1).forEach((r, i) => {
    const b = newBook({ status: '', createdAt: now - i, updatedAt: now });
    map.forEach((field, c) => {
      if (!field || field === '_score') return;
      const v = r[c];
      if (v === null || v === undefined || v === '') return;
      if (field.startsWith('score:')) { const n = num(v); if (n !== null) b.scores[field.slice(6)] = n; }
      else if (['priority', 'seriesOrder', 'spicy', 'myRating', 'goodreadsVotes'].includes(field)) b[field] = num(v);
      else if (field === 'goodreads') b.goodreads = num(String(v).replace(',', '.'));
      else if (field === 'warnings' || field === 'tags') b[field] = list(v);
      else if (field === 'favorite') b.favorite = ['evet', 'true', '1', 'x', '❤️'].includes(norm(v));
      else if (field === 'startDate' || field === 'endDate') b[field] = dateStr(v);
      else b[field] = String(v).trim();
    });
    if (!b.title && !b.originalTitle) return;
    if (!b.status) b.status = 'Okunacak';
    books.push(b);
  });

  // Ağırlıklar (Ayarlar sayfası) ve okuma kuralları
  let weights = null;
  const ay = wb.SheetNames.find(n => norm(n) === 'ayarlar');
  if (ay) {
    const ar = XLSX.utils.sheet_to_json(wb.Sheets[ay], { header: 1, defval: null });
    const hi = ar.findIndex(r => norm(r[0]) === 'kriter');
    if (hi >= 0 && ar[hi + 1]) {
      weights = {};
      ar[hi].forEach((h, c) => { const crit = CRITERIA.find(x => norm(x.label) === norm(h)); if (crit && num(ar[hi + 1][c]) !== null) weights[crit.key] = num(ar[hi + 1][c]); });
      if (!Object.keys(weights).length) weights = null;
    }
  }
  let rules = null;
  for (const n of wb.SheetNames) {
    const rr = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: null });
    const start = rr.findIndex(r => norm(r[0]).startsWith('okuma kurallarimiz') || norm(r[0]).startsWith('okuma kurallarim'));
    if (start >= 0) {
      rules = [];
      for (const r of rr.slice(start + 1)) { const t = String(r[0] ?? '').trim(); if (!/^\d+\./.test(t)) break; rules.push(t.replace(/^\d+\.\s*/, '')); }
      break;
    }
  }
  return { books, weights, rules };
}

export async function importExcel(parsed, mode) {
  let books = parsed.books;
  let skipped = 0;
  if (mode === 'merge') {
    const key = b => norm(b.title || b.originalTitle) + '|' + norm(b.author);
    const have = new Set(state.books.map(key));
    books = books.filter(b => { if (have.has(key(b))) { skipped++; return false; } have.add(key(b)); return true; });
    await addBooks(books);
  } else {
    await db.clearCovers();
    await replaceAll(books);
    learnOptions(books);
  }
  if (parsed.weights) state.settings.weights = { ...state.settings.weights, ...parsed.weights };
  if (parsed.rules?.length) state.settings.rules = parsed.rules;
  await saveSettings();
  return { added: books.length, skipped };
}

export async function exportExcel() {
  const XLSX = await loadXLSX();
  const header = COLUMNS.map(([, l]) => l);
  const rows = state.books.map(b => COLUMNS.map(([f]) => {
    if (f === '_score') return computeScore(b);
    if (f.startsWith('score:')) return b.scores?.[f.slice(6)] ?? null;
    if (f === 'warnings' || f === 'tags') return (b[f] || []).join(', ');
    if (f === 'favorite') return b.favorite ? 'Evet' : '';
    return b[f] ?? null;
  }));
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws['!cols'] = header.map((h, i) => ({ wch: [1, 2, 3, 4, 6, 18, 19].includes(i) ? 28 : Math.max(10, h.length + 2) }));
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: header.length - 1 } }) };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Kitaplar');
  const w = state.settings.weights;
  const ayar = XLSX.utils.aoa_to_sheet([
    ['Genel uyum puanı ağırlıkları'], [],
    ['Kriter', ...CRITERIA.map(c => c.label)],
    ['Ağırlık', ...CRITERIA.map(c => w[c.key])],
    [], ['Okuma kurallarım'], ...state.settings.rules.map((r, i) => [`${i + 1}. ${r}`]),
  ]);
  XLSX.utils.book_append_sheet(wb, ayar, 'Ayarlar');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  await saveFile(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `Kitapligim_${stamp()}.xlsx`);
}

// ---------- Yedekleme (kapaklar dahil) ----------
const blobToDataURL = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
const dataURLToBlob = async url => (await fetch(url)).blob();

export async function backup() {
  const covers = {};
  for (const key of await db.allCoverKeys()) {
    const blob = await db.getCover(key);
    if (blob) covers[key] = await blobToDataURL(blob);
  }
  const data = { app: 'kitapligim', version: 1, createdAt: new Date().toISOString(), books: state.books, options: state.options, settings: state.settings, covers };
  await saveFile(new Blob([JSON.stringify(data)], { type: 'application/json' }), `Kitapligim_yedek_${stamp()}.json`);
  state.settings.lastBackup = Date.now();
  await saveSettings();
}

export async function restore(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { throw new Error('Yedek dosyası okunamadı'); }
  if (data?.app !== 'kitapligim' || !Array.isArray(data.books)) throw new Error('Bu bir Kitaplığım yedeği değil');
  await db.clearCovers();
  for (const [key, url] of Object.entries(data.covers || {})) await db.putCover(key, await dataURLToBlob(url));
  await replaceAll(data.books, data.options, data.settings);
  return data.books.length;
}

function stamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// iPhone'da paylaşım menüsü açılır → "Dosyalar'a Kaydet" seçilebilir.
async function saveFile(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
