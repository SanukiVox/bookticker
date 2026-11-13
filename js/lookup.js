// İnternetten kapak ve özet bulma (Google Books + Open Library). Telefonun interneti kullanılır.
import { norm } from './store.js';
import { db } from './db.js';

let googleBlocked = false; // Google günlük sınırı dolarsa bu oturumda Open Library'ye geç

const lastName = a => (a || '').split(/[,&]/)[0].trim().split(/\s+/).pop() || '';
const authorMatches = (wanted, list) => {
  if (!wanted) return true;
  const ln = norm(lastName(wanted));
  return (list || []).some(a => norm(a).includes(ln));
};

function googleImg(links) {
  const u = links?.thumbnail || links?.smallThumbnail;
  if (!u) return null;
  return u.replace(/^http:/, 'https:').replace('&edge=curl', '') + '&fife=w480-h720';
}

async function google(title, author, lang) {
  if (googleBlocked || !title) return [];
  const q = `intitle:${title}${author ? ` inauthor:${lastName(author)}` : ''}`;
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=12&printType=books${lang ? `&langRestrict=${lang}` : ''}`;
  const res = await fetch(url);
  if (res.status === 429 || res.status === 403) { googleBlocked = true; return []; }
  if (!res.ok) return [];
  const data = await res.json();
  return (data.items || []).map(it => {
    const v = it.volumeInfo || {};
    return { source: 'Google Books', title: v.title, authors: v.authors || [], lang: v.language, year: (v.publishedDate || '').slice(0, 4), publisher: v.publisher || '', img: googleImg(v.imageLinks), description: v.description || '' };
  }).filter(r => authorMatches(author, r.authors));
}

async function openLibrary(title, author, lang) {
  if (!title) return [];
  const url = `https://openlibrary.org/search.json?title=${encodeURIComponent(title)}${author ? `&author=${encodeURIComponent(lastName(author))}` : ''}&limit=12&fields=title,author_name,cover_i,language,first_publish_year,publisher,edition_count`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  // Kapağı olmayan kayıtlar da alınır (yayın yılı için); kapak seçiminde img olmayanlar zaten atlanır.
  return (data.docs || []).filter(d => !lang || !d.language || d.language.includes(lang === 'tr' ? 'tur' : 'eng'))
    .map(d => ({ source: 'Open Library', title: d.title, authors: d.author_name || [], lang: (d.language || [])[0], year: d.first_publish_year || '', editions: d.edition_count || 0, publisher: (d.publisher || [])[0] || '', img: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg?default=false` : null, description: '' }));
}

// Kapak / özet adayları. which: 'tr' (Türkçe baskı) | 'orig' (orijinal baskı)
export async function candidates(book, which, { title, author } = {}) {
  const t = title ?? (which === 'tr' ? book.title : (book.originalTitle || book.title));
  const a = author ?? book.author;
  const lang = which === 'tr' ? 'tr' : (book.originalTitle ? 'en' : '');
  const [g, o] = await Promise.all([google(t, a, lang).catch(() => []), openLibrary(t, a, lang).catch(() => [])]);
  let all = [...g, ...o];
  // Türkçe sonuç çıkmazsa dil kısıtı olmadan dene
  if (!all.length && lang) {
    const [g2, o2] = await Promise.all([google(t, a, '').catch(() => []), openLibrary(t, a, '').catch(() => [])]);
    all = [...g2, ...o2];
  }
  // Başlığı en çok benzeyenleri öne al
  const nt = norm(t);
  const scoreOf = r => (norm(r.title) === nt ? 3 : norm(r.title).includes(nt) || nt.includes(norm(r.title)) ? 2 : 0) + (r.img ? 1 : 0) + (r.description ? 0.5 : 0);
  return all.sort((x, y) => scoreOf(y) - scoreOf(x));
}

export const summaryCandidates = async book => {
  const [tr, orig] = await Promise.all([candidates(book, 'tr'), book.originalTitle ? candidates(book, 'orig') : Promise.resolve([])]);
  const seen = new Set();
  return [...tr, ...orig].filter(r => r.description && !seen.has(r.description.slice(0, 80)) && seen.add(r.description.slice(0, 80)));
};

// Görseli indirip telefona kaydetmeyi dene; site izin vermezse adresini sakla (çevrimdışı için önbelleğe alınır).
export async function storeCover(url, keyPrefix, shrink) {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error();
    const raw = await res.blob();
    if (!raw.type.startsWith('image/') || raw.size < 1500) throw new Error('görsel değil'); // Google'ın "görsel yok" yer tutucusu çok küçük
    const blob = await shrink(raw);
    const key = `${keyPrefix}-${Date.now().toString(36)}`;
    await db.putCover(key, blob);
    return key;
  } catch {
    return url;
  }
}

export const isUrl = v => typeof v === 'string' && /^https?:\/\//.test(v);

// Google'ın "kapak yok" görseli ve kırık görselleri ayıkla.
export function imageOk(url) {
  return new Promise(res => {
    const i = new Image();
    i.onload = () => res(i.naturalWidth > 40 && i.naturalHeight > 60);
    i.onerror = () => res(false);
    i.src = url;
  });
}
