// Kitap dosyaları (PDF/EPUB): sadece bu telefonda saklanır, GitHub'a gönderilmez.
// Kitapta yalnızca bilgisi tutulur: book.file = { key, name, type, size, addedAt }
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
  const key = `${book.id}-${Date.now().toString(36)}`;
  await db.putFile(key, blob);
  if (book.file?.key) await removeFileData(book.file.key);
  book.file = { key, name: file.name, type, size: blob.size, addedAt: Date.now() };
  // Yeni dosya = yeni konum bilgisi
  book.progress = book.progress && book.progress.manual ? book.progress : null;
  book.bookmarks = [];
  await saveBook(book);
}

async function removeFileData(key) {
  await db.deleteFile(key);
  await db.putMeta(`loc:${key}`, null);
}

export async function detachFile(book) {
  if (book.file?.key) await removeFileData(book.file.key);
  book.file = null;
  await saveBook(book);
}

export async function hasLocalFile(book) {
  if (!book.file?.key) return false;
  const keys = await db.allFileKeys();
  return keys.includes(book.file.key);
}

export const getFileBlob = book => db.getFile(book.file.key);

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
