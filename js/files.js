// Kitap dosyaları (PDF/EPUB): sadece bu telefonda saklanır, GitHub'a gönderilmez.
// Kitapta yalnızca bilgisi tutulur: book.file = { key, hash, name, type, size, addedAt }
// Dosya içeriğine göre tanınır (SHA-256): aynı PDF hangi cihaza eklenirse eklensin aynı anahtarı alır.
import { state, saveBook, saveSettings, today } from './store.js';
import { db } from './db.js';

// İki dosya yuvası: 1 = book.file/progress/bookmarks, 2 = book.file2/progress2/bookmarks2.
// Her dosyada lang: 'orig' (orijinal metin) | 'tr' (çeviri). Okuma süresi kitap için ortaktır.
export const LANGS = { orig: '🌐 Orijinal', tr: '🇹🇷 Çeviri' };
export const langLabel = f => LANGS[f?.lang] || '📄 Kitap dosyası';
const SLOT2 = { file: 'file2', progress: 'progress2', bookmarks: 'bookmarks2', bookmarksDel: 'bookmarksDel2', highlights: 'highlights2', highlightsDel: 'highlightsDel2' };
// 2. yuvayı, okuyucu ve diğer kodun book.file/progress/bookmarks olarak görebileceği bir görünüme çevirir.
export function slotBook(book, slot) {
  if (!book || slot !== 2) return book;
  return new Proxy(book, {
    get: (t, k) => (k === '__real' ? t : k === '__slot' ? 2 : t[SLOT2[k] || k]),
    set: (t, k, v) => { t[SLOT2[k] || k] = v; return true; },
  });
}
export const realBook = b => b?.__real || b;
export const slotOf = b => b?.__slot || 1;
export const slotFile = (b, slot) => (slot === 2 ? b.file2 : b.file);
export const slotProgress = (b, slot) => (slot === 2 ? b.progress2 : b.progress);
// En son okunan yuva (ilerleme çubukları ve "Devam" için)
export function latestSlot(b) {
  const p1 = b.progress, p2 = b.progress2;
  if (p2 && (!p1 || (p2.updatedAt || 0) > (p1.updatedAt || 0))) return 2;
  if (!p1 && !b.file && b.file2) return 2;
  return 1;
}
// Bir dil için hangi yuva kullanılır?
export function slotForLang(b, lang) {
  if (b.file?.lang === lang) return 1;
  if (b.file2?.lang === lang) return 2;
  if (!b.file) return 1;
  if (!b.file2) return 2;
  return b.file.lang ? 2 : 1;
}

export function detectType(file) {
  const n = (file.name || '').toLowerCase();
  if (file.type === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (file.type === 'application/epub+zip' || n.endsWith('.epub')) return 'epub';
  return null;
}

export async function attachFile(book, file, lang) {
  const real = realBook(book), slot = slotOf(book);
  const other = slotFile(real, slot === 2 ? 1 : 2);
  const type = detectType(file);
  if (!type) throw new Error('Sadece PDF veya EPUB dosyası eklenebilir');
  // Dosyanın imzasını kontrol et (yanlış uzantılı dosyalara karşı)
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  const sig = String.fromCharCode(...head);
  if (type === 'pdf' && !sig.startsWith('%PDF')) throw new Error('Bu dosya geçerli bir PDF değil');
  if (type === 'epub' && !(head[0] === 0x50 && head[1] === 0x4b)) throw new Error('Bu dosya geçerli bir EPUB değil');
  const blob = new Blob([await file.arrayBuffer()], { type: type === 'pdf' ? 'application/pdf' : 'application/epub+zip' });
  const hash = await sha256(blob);
  const key = `h-${hash.slice(0, 32)}`;
  // Aynı dosya mı? (başka cihazda eklenmiş ya da yeniden eklenen) → ilerleme, yer imleri korunur
  const prev = book.file;
  const sameFile = !!prev && (prev.hash ? prev.hash === hash : (prev.size === blob.size && prev.type === type));
  await db.putFile(key, blob);
  // Bu kitap için bu cihazdaki eski kopyaları temizle
  for (const k of await db.allFileKeys()) {
    if (k !== key && k !== other?.key && ((slot === 1 && k.startsWith(`${book.id}-`)) || k === prev?.key)) await removeFileData(k);
  }
  book.file = { key, hash, name: file.name, type, size: blob.size, addedAt: sameFile ? (prev.addedAt || Date.now()) : Date.now(), lang: lang || prev?.lang || undefined };
  if (!book.file.lang) delete book.file.lang;
  if (!sameFile) {
    // Farklı dosya = farklı sayfa düzeni: konum bilgisi sıfırlanır
    book.progress = book.progress && book.progress.manual ? book.progress : null;
    book.bookmarks = [];
  }
  await saveBook(book);
  return { sameFile };
}

async function removeFileData(key) {
  await db.deleteFile(key);
  await db.putMeta(`loc:${key}`, null);
}

async function sha256(blob) {
  const buf = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Bu cihazda kitabın dosyası hangi anahtarda? (eşitlemeden gelen anahtar, içerik özeti ya da eski kayıt)
export async function resolveLocalKey(book) {
  if (!book.file) return null;
  const keys = await db.allFileKeys();
  if (book.file.key && keys.includes(book.file.key)) return book.file.key;
  if (book.file.hash && keys.includes(`h-${book.file.hash.slice(0, 32)}`)) return `h-${book.file.hash.slice(0, 32)}`;
  // Eski sürümde eklenen dosyalar: anahtar kitabın kimliğiyle başlar (sadece 1. yuva)
  if (slotOf(book) === 2) return null;
  const legacy = keys.filter(k => k.startsWith(`${book.id}-`)).sort();
  return legacy.length ? legacy[legacy.length - 1] : null;
}

export async function detachFile(book) {
  const local = await resolveLocalKey(book);
  const other = slotFile(realBook(book), slotOf(book) === 2 ? 1 : 2);
  if (local && local !== other?.key) await removeFileData(local);
  if (book.file?.key && book.file.key !== local && book.file.key !== other?.key) await removeFileData(book.file.key);
  book.file = null;
  await saveBook(book);
}

export async function hasLocalFile(book) {
  return !!(await resolveLocalKey(book));
}

export async function getFileBlob(book) {
  const k = await resolveLocalKey(book);
  return k ? db.getFile(k) : null;
}

export async function filesUsage() {
  const keys = new Set(await db.allFileKeys());
  const files = state.books.flatMap(b => [b.file, b.file2]).filter(f => f?.key && keys.has(f.key));
  return { count: files.length, bytes: files.reduce((t, f) => t + (f.size || 0), 0) };
}

export function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function formatDuration(sec) {
  sec = Math.round(sec || 0);
  if (sec < 60) return sec ? '1 dk\'dan az' : '0 dk';
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h ? `${h} sa ${m} dk` : `${m} dk`;
}

// ---------- Okuma süresi kaydı (günlük toplamlar; GitHub ile eşitlenir) ----------
export function addReadingTime(book, seconds) {
  if (seconds <= 0) return;
  book.readingSeconds = (book.readingSeconds || 0) + seconds;
  const log = (state.settings.readLog ||= {});
  const d = today();
  log[d] = (log[d] || 0) + seconds;
}
export const saveReadLog = () => saveSettings();

export function readingStats() {
  const log = state.settings.readLog || {};
  // Günlük hedef varsa seri, hedefin tamamlandığı günlerle sayılır; yoksa en az 1 dakika okunan günlerle
  const goalSec = (Number(state.settings.dailyGoalMin) || 0) * 60;
  const counts = sec => (sec || 0) >= (goalSec || 60);
  const now = new Date();
  const dayStr = d => today(d);
  const todaySec = log[dayStr(now)] || 0;
  let weekSec = 0;
  for (let i = 0; i < 7; i++) { const d = new Date(now); d.setDate(now.getDate() - i); weekSec += log[dayStr(d)] || 0; }
  const monthPrefix = dayStr(now).slice(0, 7);
  const monthSec = Object.entries(log).filter(([k]) => k.startsWith(monthPrefix)).reduce((t, [, v]) => t + v, 0);
  const totalSec = Object.values(log).reduce((t, v) => t + v, 0);
  // Art arda okunan gün sayısı
  let streak = 0;
  for (let i = 0; ; i++) {
    const d = new Date(now); d.setDate(now.getDate() - i);
    if (counts(log[dayStr(d)])) streak++;
    else if (i > 0) break;
    if (i > 3650) break;
  }
  // En uzun seri
  let best = 0, run = 0, prev = null;
  for (const k of Object.keys(log).filter(k => counts(log[k])).sort()) {
    const d = new Date(`${k}T12:00:00`);
    run = prev && Math.round((d - prev) / 86400000) === 1 ? run + 1 : 1;
    best = Math.max(best, run); prev = d;
  }
  const monthDays = Object.keys(log).filter(k => k.startsWith(monthPrefix) && (log[k] || 0) >= 60).length;
  const last7 = Array.from({ length: 7 }, (_, i) => { const d = new Date(now); d.setDate(now.getDate() - (6 - i)); return { d, sec: log[dayStr(d)] || 0 }; });
  return { todaySec, weekSec, monthSec, totalSec, streak, best: Math.max(best, streak), last7, goalSec, monthDays };
}

// İlerleme yüzdesi: yuva verilmezse en son okunan dosyanınki
export const progressOf = (b, slot = latestSlot(b)) => {
  const p = slotProgress(b, slot);
  return p && typeof p.percent === 'number' ? Math.max(0, Math.min(100, p.percent)) : null;
};
