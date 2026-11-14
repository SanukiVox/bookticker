// Uygulamanın hafızadaki durumu: kitaplar, seçenek listeleri ve ayarlar.
import { db } from './db.js';

// Değerlendirme sistemi: DEGERLENDIRME_SISTEMI.md. label = Excel sütun adı (değiştirme), title/desc = rehber.
export const CRITERIA = [
  { key: 'chemistry', label: 'Romantik kimya', title: 'Romantik kimya', weight: 30,
    desc: 'Ana karakterler arasındaki çekim ve elektrik; duygusal ve fiziksel uyum, ilişkinin doğal gelişimi, karşılıklı etkileşim ve gerilim, okura romantik heyecan hissettirme.' },
  { key: 'male', label: 'Erkek karakter', title: 'Erkek karakter', weight: 10,
    desc: 'Kişilik ve özgünlük, karizma ve çekicilik, duygusal derinlik, gelişim ve geçmiş hikâyesi, davranış tutarlılığı, romantik ilişkideki tutumu.' },
  { key: 'female', label: 'Kadın karakter', title: 'Kadın karakter', weight: 10,
    desc: 'Karakter derinliği, güçlü ve zayıf yönlerin dengesi, bağımsızlık ve karar verme, gelişim, hikâyeye katkı ve tutarlılık, okurla duygusal bağ.' },
  { key: 'world', label: 'Fantastik dünya', title: 'Fantastik dünya ve evren', weight: 5,
    desc: 'Dünya inşası, büyü/güç sistemleri, ırklar ve mitolojik unsurlar, evrenin kuralları ve tutarlılığı, atmosfer ve mekân. Fantastik olmayan kitaplarda: geçtiği dünyanın ve atmosferin inandırıcılığı.' },
  { key: 'action', label: 'Aksiyon', title: 'Aksiyon ve olay örgüsü', weight: 5,
    desc: 'Olay örgüsünün tutarlılığı, çatışma ve gerilim, aksiyon sahneleri, beklenmedik gelişmeler, tempo, ana hikâyenin okuru içine çekmesi.' },
  { key: 'romance', label: 'Romantizm', title: 'Romantizm', weight: 20,
    desc: 'Romantizmin hikâyedeki ağırlığı, ilişkinin gelişim süreci, duygusal yakınlaşma, aşkın hikâyeye etkisi, romantik sahneler. (Kimya çekimi; romantizm ilişkinin gelişimini ve derinliğini ölçer.)' },
  { key: 'literary', label: 'Edebi derinlik', title: 'Edebî derinlik', weight: 5,
    desc: 'Yazım ve anlatım kalitesi, karakterlerin psikolojik derinliği, diyalogların doğallığı, betimlemeler, temaların işlenişi, duygusal ve düşünsel derinlik.' },
  { key: 'pace', label: 'Sürükleyicilik', title: 'Sürükleyicilik ve okunabilirlik', weight: 15,
    desc: 'Akıcı anlatım, bölüm uzunluğu ve tempo, gereksiz uzatma olmaması, anlaşılır dil, okuma isteğini canlı tutması, hikâyeye kolay adapte olma.' },
];

// Spicy yalnızca açık yetişkin içeriğin yoğunluğunu ölçer; ilişkinin kalitesini göstermez.
export const SPICY_LABELS = [
  'Açık yetişkin sahnesi bulunmaz',
  'Çok hafif, örtük veya ima edilen yetişkin içerik',
  'Az sayıda, sınırlı detay içeren açık sahne',
  'Orta yoğunlukta, belirgin ve detaylı yetişkin sahneler',
  'Sık karşılaşılan, açık ve detaylı yetişkin sahneler',
  'Çok yoğun, sık ve oldukça açık yetişkin içerik',
];

export const GUIDE_FIT = 'Genel okuyucu uyumu: kitabın bu özellikleriyle beklentiler arasındaki uyum — güçlü romantik ilişki ve kimya, etkileyici ana karakterler, romantizmin yeterli ağırlığı, varsa fantastik dünyanın ve olay örgüsünün başarısı, akıcı anlatım ve tercih edilen yetişkin içerik yoğunluğu. Uygulamada 8 kriterin ağırlıklı ortalaması olarak hesaplanır (spicy hariç).';

// Kullanıcının düzenleyebildiği seçenek listeleri.
export const OPTION_LISTS = {
  statuses: { label: 'Okuma durumları', hasColor: true, hasEmoji: true, field: 'status' },
  genres: { label: 'Türler', hasColor: true, field: 'genre' },
  translations: { label: 'Türkçe çeviri durumları', field: 'translation' },
  publishers: { label: 'Yayınevleri', field: 'publisher' },
  confidences: { label: 'Güven etiketleri', field: 'confidence' },
  warnings: { label: 'İçerik uyarıları', field: 'warnings', multi: true },
  tags: { label: 'Etiketler', field: 'tags', multi: true },
};

export const PALETTE = ['#7b3f61', '#b0563f', '#c98a2b', '#5b8c3a', '#2f7d6f', '#2f6aa1', '#5a4fa8', '#8a3fa0', '#a33d5c', '#6b6370'];

const DEFAULT_OPTIONS = {
  statuses: [
    { name: 'Okunuyor', emoji: '📖', color: '#2f6aa1' },
    { name: 'Okunacak', emoji: '📚', color: '#7b3f61' },
    { name: 'Okundu', emoji: '✅', color: '#2f7d4f' },
    { name: 'Çeviri bekleniyor', emoji: '⏳', color: '#c98a2b' },
    { name: 'Yarım bırakıldı', emoji: '⏸️', color: '#b0563f' },
    { name: 'Elendi', emoji: '❌', color: '#6b6370' },
  ],
  genres: [
    { name: 'Romantasy / Fantastik Romantik', color: '#8a3fa0' },
    { name: 'Epik Fantastik / Bilimkurgu', color: '#2f6aa1' },
    { name: 'Çağdaş Romantik / Romantik Komedi / Spor', color: '#a33d5c' },
    { name: 'Dark Romance / Mafya', color: '#3d2b3d' },
    { name: 'Gerilim / Polisiye / Tarihî', color: '#5b6b3a' },
  ],
  translations: [{ name: 'Var' }, { name: 'Kısmen' }, { name: 'Yok / doğrulanamadı' }, { name: 'Doğrulanacak' }],
  publishers: [],
  confidences: [{ name: 'Araştırılmış' }, { name: 'Ön değerlendirme' }, { name: 'Doğrulanacak' }],
  warnings: [],
  tags: [],
};

const DEFAULT_SETTINGS = {
  weights: Object.fromEntries(CRITERIA.map(c => [c.key, c.weight])),
  theme: 'auto',
  view: 'grid',
  yearlyGoal: 24,
  savedFilters: [],
  rules: [
    'Öncelik Türkçe çevirisi yayımlanmış kitaplarda.',
    "Çevirisi olmayan kitaplar 'Çeviri bekleniyor' durumuna alınır.",
    'Serinin devamı Türkçede yoksa başka seriye geçilir; çeviri çıkınca dönülür.',
    'Başlanan seri mümkün olduğunca tamamlanır.',
  ],
};

export const state = {
  books: [],
  options: structuredClone(DEFAULT_OPTIONS),
  settings: structuredClone(DEFAULT_SETTINGS),
};

const listeners = new Set();
export const onChange = fn => listeners.add(fn);
const emit = () => listeners.forEach(fn => fn());

export async function load() {
  const [books, options, settings] = await Promise.all([db.allBooks(), db.getMeta('options'), db.getMeta('settings')]);
  state.books = books || [];
  state.options = { ...structuredClone(DEFAULT_OPTIONS), ...(options || {}) };
  state.settings = { ...structuredClone(DEFAULT_SETTINGS), ...(settings || {}) };
  state.settings.weights = { ...DEFAULT_SETTINGS.weights, ...(state.settings.weights || {}) };
  // Tek seferlik: değerlendirme notuna yazılmış yayın yılını kendi alanına taşı
  const moved = [];
  for (const b of state.books) {
    if (b.pubYear || !b.review) continue;
    const m = b.review.match(/\s*Yayın yılı: (\d{4})\.\s*/);
    if (!m) continue;
    b.pubYear = Number(m[1]);
    b.review = b.review.replace(m[0], ' ').trim();
    moved.push(b);
  }
  if (moved.length) await db.putBooks(moved);
}

export const saveOptions = () => { state.options.updatedAt = Date.now(); return db.putMeta('options', state.options).then(emit); };
export const saveSettings = () => { state.settings.updatedAt = Date.now(); return db.putMeta('settings', state.settings).then(emit); };

// ---------- Yardımcılar ----------
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// Türkçe karakter ve büyük/küçük harf duyarsız karşılaştırma için.
export function norm(s) {
  return String(s ?? '')
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // ç→c, ğ→g, ö→o, ş→s, ü→u, â→a ...
    .replace(/\s+/g, ' ').trim();
}

export const collator = new Intl.Collator('tr', { sensitivity: 'base', numeric: true });

// Genel uyum puanı: Excel'deki formülün aynısı. Boş kriterler hesaba katılmaz.
export function computeScore(book) {
  const w = state.settings.weights;
  let sum = 0, wsum = 0;
  for (const c of CRITERIA) {
    const v = book.scores?.[c.key];
    if (v === null || v === undefined || v === '') continue;
    sum += Number(v) * (Number(w[c.key]) || 0);
    wsum += Number(w[c.key]) || 0;
  }
  if (!wsum) return null;
  return Math.round((sum / wsum) * 10) / 10;
}

// "2025" ya da "2025-06-20" → okunur Türkçe tarih
export function formatPubDate(v) {
  const s = String(v ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T00:00').toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
  if (/^\d{4}-\d{2}$/.test(s)) return new Date(s + '-01T00:00').toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
  return s;
}
const upcoming = v => /^\d{4}(-\d{2}(-\d{2})?)?$/.test(String(v || '')) && String(v) > today();
export const isUpcoming = b => upcoming(b.trDate);

export const displayTitle = b => b.title || b.originalTitle || 'Adsız kitap';

export function statusInfo(name) {
  return state.options.statuses.find(s => s.name === name) || { name: name || '—', emoji: '•', color: '#6b6370' };
}
export function genreColor(name) {
  const g = state.options.genres.find(x => x.name === name);
  if (g?.color) return g.color;
  return colorFor(name || '');
}
export function colorFor(str) {
  let h = 0;
  for (const ch of str) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// Goodreads: puan otomatik çekilemez; kitap Goodreads'te aranır, kullanıcı puanı girer.
export const goodreadsUrl = b => `https://www.goodreads.com/search?q=${encodeURIComponent([b.originalTitle || b.title, b.author].filter(Boolean).join(' '))}`;
export const formatVotes = n => (!n ? '' : n >= 1e6 ? `${(n / 1e6).toFixed(1).replace('.', ',')} M oy` : n >= 1e3 ? `${Math.round(n / 1e3)} B oy` : `${n} oy`);

export const getBook = id => state.books.find(b => b.id === id);

export function newBook(partial = {}) {
  return {
    id: uid(),
    title: '', originalTitle: '', author: '', series: '', seriesOrder: null,
    genre: '', translation: '', publisher: '', status: 'Okunacak', priority: null,
    scores: {}, spicy: null, goodreads: null, goodreadsVotes: null, pubYear: null, trDate: '', confidence: '', review: '', summary: '',
    warnings: [], tags: [], inVisuals: '', favorite: false,
    coverTr: null, coverOrig: null,
    startDate: '', endDate: '', myRating: null, notes: '', quotes: '',
    createdAt: Date.now(), updatedAt: Date.now(),
    ...partial,
  };
}

export async function saveBook(book) {
  book = book?.__real || book; // 2. dosya görünümü (files.js slotBook)
  book.updatedAt = Date.now();
  if (book.status === 'Okundu' && !book.endDate) book.endDate = today();
  if (book.status === 'Okunuyor' && !book.startDate) book.startDate = today();
  await db.putBook(book);
  const i = state.books.findIndex(b => b.id === book.id);
  if (i >= 0) state.books[i] = book; else state.books.push(book);
  learnOptions([book]);
  emit();
}

export async function saveBooks(books) {
  const now = Date.now();
  books.forEach(b => { b.updatedAt = now; });
  await db.putBooks(books);
  emit();
}

export async function deleteBook(id) {
  const b = getBook(id);
  await db.deleteBook(id);
  if (b?.coverTr) await db.deleteCover(b.coverTr);
  if (b?.coverOrig) await db.deleteCover(b.coverOrig);
  for (const k of await db.allFileKeys()) {
    if (k === b?.file?.key || k === b?.file2?.key || k.startsWith(`${id}-`)) { await db.deleteFile(k); await db.putMeta(`loc:${k}`, null); }
  }
  const tomb = (await db.getMeta('deleted')) || {};
  tomb[id] = Date.now();
  await db.putMeta('deleted', tomb);
  state.books = state.books.filter(x => x.id !== id);
  emit();
}

// Yerel saate göre bugünün tarihi (YYYY-AA-GG)
export const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Kitaplarda geçen ama listede olmayan seçenekleri listeye ekle (örn. yeni yayınevi).
export function learnOptions(books) {
  let changed = false;
  for (const [key, def] of Object.entries(OPTION_LISTS)) {
    const list = state.options[key];
    const known = new Set(list.map(o => o.name));
    for (const b of books) {
      const vals = def.multi ? (b[def.field] || []) : [b[def.field]];
      for (const v of vals) {
        if (v && !known.has(v)) {
          known.add(v);
          list.push(key === 'statuses' ? { name: v, emoji: '•', color: '#6b6370' } : { name: v });
          changed = true;
        }
      }
    }
  }
  if (changed) saveOptions();
  return changed;
}

export function optionNames(key) {
  return state.options[key].map(o => o.name);
}

// Bir seçeneğin adını değiştirince kitaplardaki değerleri de güncelle.
export async function renameOption(key, oldName, newName) {
  const def = OPTION_LISTS[key];
  const changed = [];
  for (const b of state.books) {
    if (def.multi) {
      const arr = b[def.field] || [];
      if (arr.includes(oldName)) { b[def.field] = arr.map(v => (v === oldName ? newName : v)); changed.push(b); }
    } else if (b[def.field] === oldName) { b[def.field] = newName; changed.push(b); }
  }
  if (changed.length) await db.putBooks(changed);
  const o = state.options[key].find(x => x.name === oldName);
  if (o) o.name = newName;
  await saveOptions();
  return changed.length;
}

export function optionUsage(key, name) {
  const def = OPTION_LISTS[key];
  return state.books.filter(b => (def.multi ? (b[def.field] || []).includes(name) : b[def.field] === name)).length;
}

export async function replaceAll(books, options, settings) {
  await db.clearBooks();
  await db.putBooks(books);
  state.books = books;
  if (options) { state.options = { ...structuredClone(DEFAULT_OPTIONS), ...options }; await db.putMeta('options', state.options); }
  if (settings) { state.settings = { ...structuredClone(DEFAULT_SETTINGS), ...settings }; await db.putMeta('settings', state.settings); }
  emit();
}

export async function addBooks(books) {
  await db.putBooks(books);
  state.books.push(...books);
  learnOptions(books);
  emit();
}

// ---------- Gruplamalar ----------
export function authors() {
  const map = new Map();
  for (const b of state.books) {
    const name = (b.author || '').trim() || 'Yazarı bilinmiyor';
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(b);
  }
  return [...map.entries()].map(([name, books]) => ({ name, books })).sort((a, b) => collator.compare(a.name, b.name));
}

export function seriesList() {
  const map = new Map();
  for (const b of state.books) {
    const name = (b.series || '').trim();
    if (!name) continue;
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(b);
  }
  return [...map.entries()].map(([name, books]) => ({ name, books: sortSeries(books) })).sort((a, b) => collator.compare(a.name, b.name));
}

export const sortSeries = books => [...books].sort((a, b) => (a.seriesOrder ?? 999) - (b.seriesOrder ?? 999) || collator.compare(displayTitle(a), displayTitle(b)));
export const booksInSeries = name => sortSeries(state.books.filter(b => b.series && b.series === name));
export const booksByAuthor = name => state.books.filter(b => (b.author || 'Yazarı bilinmiyor') === name || (!b.author && name === 'Yazarı bilinmiyor'));
