// Kitap dosyaları (PDF/EPUB): sadece bu telefonda saklanır, GitHub'a gönderilmez.
// Kitapta yalnızca bilgisi tutulur: book.file = { key, hash, name, type, size, addedAt }
// Dosya içeriğine göre tanınır (SHA-256): aynı PDF hangi cihaza eklenirse eklensin aynı anahtarı alır.
import { state, saveBook, saveSettings, today } from './store.js';
import { db } from './db.js';

export function detectType(file) {
  const n = (file.name || '').toLowerCase();
  if (file.type === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (file.type === 'application/epub+zip' || n.endsWith('.epub')) return 'epub';
  return null;
}

export async function attachFile(book, file) {
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
    if (k !== key && (k.startsWith(`${book.id}-`) || k === prev?.key)) await removeFileData(k);
  }
  book.file = { key, hash, name: file.name, type, size: blob.size, addedAt: sameFile ? (prev.addedAt || Date.now()) : Date.now() };
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
  // Eski sürümde eklenen dosyalar: anahtar kitabın kimliğiyle başlar
  const legacy = keys.filter(k => k.startsWith(`${book.id}-`)).sort();
  return legacy.length ? legacy[legacy.length - 1] : null;
}

export async function detachFile(book) {
  const local = await resolveLocalKey(book);
  if (local) await removeFileData(local);
  if (book.file?.key && book.file.key !== local) await removeFileData(book.file.key);
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
  const books = state.books.filter(b => b.file?.key && keys.has(b.file.key));
  return { count: books.length, bytes: books.reduce((t, b) => t + (b.file.size || 0), 0) };
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
    if (log[dayStr(d)] >= 60) streak++;
    else if (i > 0) break;
    if (i > 3650) break;
  }
  const last7 = Array.from({ length: 7 }, (_, i) => { const d = new Date(now); d.setDate(now.getDate() - (6 - i)); return { d, sec: log[dayStr(d)] || 0 }; });
  return { todaySec, weekSec, monthSec, totalSec, streak, last7 };
}

export const progressOf = b => (b.progress && typeof b.progress.percent === 'number' ? Math.max(0, Math.min(100, b.progress.percent)) : null);
