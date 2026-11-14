// Kitap dosyalarını (PDF/EPUB) yedekleme: cihazdaki tüm dosyalar tek bir ZIP'e konur; iPhone'da paylaşım
// menüsünden "Dosyalar'a Kaydet" ile iCloud Drive'a ya da Google Drive'a kaydedilir. Geri yüklerken dosyalar
// içerik özetine (hash) göre doğru kitaba ve doğru yuvaya (orijinal/çeviri) yerleşir; ilerlemeler korunur.
import { state, displayTitle } from './store.js';
import { db } from './db.js';
import { resolveLocalKey, slotBook, formatSize } from './files.js';

let zipP = null;
const loadZip = () => (zipP ||= window.JSZip ? Promise.resolve(window.JSZip) : new Promise((res, rej) => {
  const s = document.createElement('script');
  s.src = 'vendor/jszip.min.js'; s.onload = () => res(window.JSZip); s.onerror = () => { zipP = null; rej(new Error('ZIP kütüphanesi yüklenemedi')); };
  document.head.appendChild(s);
}));

const safe = s => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'kitap';
const LANG = { orig: 'orijinal', tr: 'ceviri' };

// Cihazda gerçekten bulunan dosyalar
export async function localFiles() {
  const out = [];
  for (const b of state.books) {
    for (const slot of [1, 2]) {
      const f = slot === 2 ? b.file2 : b.file;
      if (!f) continue;
      const key = await resolveLocalKey(slotBook(b, slot));
      if (key) out.push({ book: b, slot, file: f, key });
    }
  }
  return out;
}

export async function backupFiles(onProgress) {
  const JSZip = await loadZip();
  const list = await localFiles();
  if (!list.length) throw new Error('Bu cihazda yedeklenecek kitap dosyası yok');
  const zip = new JSZip();
  const manifest = { app: 'kitapligim-files', version: 1, createdAt: new Date().toISOString(), files: [] };
  const used = new Set();
  for (const [i, x] of list.entries()) {
    const blob = await db.getFile(x.key);
    if (!blob) continue;
    let name = `${safe(displayTitle(x.book))}${x.file.lang ? ` - ${LANG[x.file.lang]}` : x.slot === 2 ? ' - 2' : ''}.${x.file.type}`;
    for (let n = 2; used.has(name); n++) name = name.replace(/( \(\d+\))?\.(\w+)$/, ` (${n}).$2`);
    used.add(name);
    zip.file(`kitaplar/${name}`, blob, { binary: true });
    manifest.files.push({ path: `kitaplar/${name}`, bookId: x.book.id, title: displayTitle(x.book), slot: x.slot, hash: x.file.hash || null, key: x.key, type: x.file.type, size: blob.size, lang: x.file.lang || null });
    onProgress?.((i + 1) / list.length * 0.5);
  }
  zip.file('kitapligim-dosyalar.json', JSON.stringify(manifest, null, 1));
  // EPUB/PDF zaten sıkıştırılmış: STORE ile hızlı ve az bellekle
  const out = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, m => onProgress?.(0.5 + m.percent / 200));
  const d = new Date();
  const name = `Kitapligim_dosyalar_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.zip`;
  return { file: new File([out], name, { type: 'application/zip' }), count: manifest.files.length, bytes: out.size };
}

export async function restoreFiles(file, onProgress) {
  const JSZip = await loadZip();
  let zip;
  try { zip = await JSZip.loadAsync(file); } catch { throw new Error('ZIP dosyası açılamadı'); }
  const mf = zip.file('kitapligim-dosyalar.json');
  if (!mf) throw new Error('Bu bir Kitaplığım dosya yedeği değil');
  const manifest = JSON.parse(await mf.async('string'));
  let restored = 0, skipped = 0, already = 0;
  const have = new Set(await db.allFileKeys());
  for (const [i, e] of manifest.files.entries()) {
    onProgress?.((i + 1) / manifest.files.length);
    // Önce aynı kitap ve yuva; yoksa aynı içerik özetini taşıyan herhangi bir kitap
    let target = null;
    const b = state.books.find(x => x.id === e.bookId);
    const f = b && (e.slot === 2 ? b.file2 : b.file);
    if (f && (!e.hash || !f.hash || f.hash === e.hash)) target = f;
    if (!target && e.hash) for (const x of state.books) for (const ff of [x.file, x.file2]) if (ff?.hash === e.hash) target ||= ff;
    if (!target) { skipped++; continue; }
    const key = target.key || e.key;
    if (have.has(key)) { already++; continue; }
    const entry = zip.file(e.path);
    if (!entry) { skipped++; continue; }
    const type = e.type === 'pdf' ? 'application/pdf' : 'application/epub+zip';
    await db.putFile(key, new Blob([await entry.async('arraybuffer')], { type }));
    have.add(key); restored++;
  }
  return { restored, skipped, already, total: manifest.files.length };
}

export async function saveOrShare(file) {
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: file.name }); return 'shared'; } catch (e) { if (e.name === 'AbortError') return 'cancel'; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  return 'downloaded';
}

export { formatSize };
