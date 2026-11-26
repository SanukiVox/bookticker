// Yenilikler: GitHub veri deposundaki yenilikler.json (ayda bir GitHub Actions üretir; tools/yenilikler.py).
// Seri yenilikleri: listedeki serilerin yeni çıkan / duyurulan ana kitapları.
// Türkçe baskılar: Türkçesi "yok" bilinen kitapların Goodreads'te görünen Türkçe baskıları.
import { state, saveSettings, saveBooks, addBooks, newBook, getBook, displayTitle } from './store.js';
import { db } from './db.js';

let news = null; // { updatedAt, items }
const listeners = new Set();
export const onNews = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach(f => { try { f(); } catch { /* yok */ } });

const seen = () => new Set(state.settings.newsSeen || []);
export const newsInfo = () => news;
export function newsItems() {
  if (!news) return [];
  const s = seen();
  return news.items.filter(i => !s.has(i.key) && (i.type !== 'tr' || (getBook(i.bookId) && getBook(i.bookId).translation !== 'Var')));
}

// Önce cihazdaki kopya, sonra GitHub'dan güncel hâli
export async function loadNews({ remote = true } = {}) {
  if (!news) { news = (await db.getMeta('news')) || null; if (news) emit(); }
  if (!remote) return news;
  try {
    const { fetchRepoJSON } = await import('./sync.js');
    const fresh = await fetchRepoJSON('yenilikler.json');
    if (fresh && Array.isArray(fresh.items)) { news = fresh; await db.putMeta('news', fresh); emit(); }
  } catch { /* çevrimdışı ya da GitHub bağlı değil */ }
  return news;
}

export async function dismiss(key) {
  state.settings.newsSeen = [...new Set([...(state.settings.newsSeen || []), key])];
  await saveSettings(); emit();
}

const cleanTitle = t => String(t || '').replace(/\s*\([^()]*#[\d.]+\)\s*$/, '').replace(/\s*\((Paperback|Hardcover|Kindle Edition|ebook)\)\s*$/i, '').trim();
const bigImg = u => (u ? u.replace(/\._S[XY]\d+_\./, '.') : null);
const MON = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
function isoDate(s) {
  const y = String(s || '').match(/(\d{4})/); if (!y) return '';
  const m = String(s).toLowerCase().match(/^([a-z]+)/); const d = String(s).match(/\b(\d{1,2})(st|nd|rd|th)\b/);
  if (!m || !MON[m[1]]) return y[1];
  return `${y[1]}-${String(MON[m[1]]).padStart(2, '0')}${d ? `-${d[1].padStart(2, '0')}` : ''}`;
}
export const newsDate = isoDate;
export const newsTitle = cleanTitle;

// Seri yeniliğini listeye ekle (serideki öbür kitaplardan tür ve yazar alınır)
export async function addSeriesItem(i) {
  const mates = state.books.filter(b => b.series === i.series);
  const ref = mates[0] || {};
  const title = cleanTitle(i.title);
  const b = newBook({
    title, originalTitle: title, author: i.author || ref.author || '', series: i.series, seriesOrder: i.order,
    genre: ref.genre || '', translation: 'Yok / doğrulanamadı', pubYear: Number(String(i.date || '').match(/\d{4}/)?.[0]) || null,
    goodreads: i.avg ? Number(i.avg) : null, goodreadsVotes: i.n || null, coverOrig: bigImg(i.img), tags: ['Yenilik'],
    notes: `Yenilik denetimi buldu (${i.found}) · ${i.url}`,
  });
  await addBooks([b]);
  await dismiss(i.key);
  return b;
}

// Türkçe baskıyı kitaba işle: çeviri "Var"; boş alanlar (Türkçe ad, yayınevi, tarih, kapak) doldurulur
export async function applyTrItem(i) {
  const b = getBook(i.bookId); if (!b) return null;
  b.translation = 'Var';
  const tt = cleanTitle(i.title);
  if (tt && (!b.title || b.title === b.originalTitle)) { if (!b.originalTitle) b.originalTitle = b.title; b.title = tt; }
  if (!b.publisher && i.publisher) b.publisher = i.publisher;
  if (!b.trDate && i.date) b.trDate = isoDate(i.date);
  if (!b.coverTr && i.img) b.coverTr = bigImg(i.img);
  await saveBooks([b]);
  await dismiss(i.key);
  return b;
}

// Açılışta: yeni gelen yenilik varsa bir kez haber ver
export async function checkNews(toast) {
  await loadNews();
  const items = newsItems();
  const told = new Set(state.settings.newsTold || []);
  const fresh = items.filter(i => !told.has(i.key));
  if (!fresh.length) return;
  state.settings.newsTold = [...told, ...fresh.map(i => i.key)].slice(-500);
  await saveSettings();
  const s = fresh.filter(i => i.type === 'series').length, t = fresh.length - s;
  toast(`🆕 ${[s ? `${s} yeni seri kitabı` : '', t ? `${t} Türkçe baskı` : ''].filter(Boolean).join(' · ')} bulundu · Okuma → Çıkış takvimi`);
}
export const titleOfBook = id => (getBook(id) ? displayTitle(getBook(id)) : '');
