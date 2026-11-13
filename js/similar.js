// Yapay zekâsız öneriler: tür, yazar, etiket, puan profili ve spicy benzerliği.
import { state, CRITERIA, computeScore, norm } from './store.js';

const vec = b => CRITERIA.map(c => (b.scores?.[c.key] === undefined || b.scores?.[c.key] === null || b.scores?.[c.key] === '' ? null : Number(b.scores[c.key])));

// İki puan profilinin benzerliği (0–1). Ortak puanlı kriter yoksa null.
function profileSim(a, b) {
  let n = 0, diff = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === null || b[i] === null) continue;
    n++; diff += Math.abs(a[i] - b[i]);
  }
  if (n < 3) return null;
  return 1 - diff / (n * 4); // kriter başına en fazla 4 puan fark
}

const tagSet = b => new Set([...(b.tags || [])].map(norm));

// a kitabına göre b'nin benzerlik puanı ve gerekçeleri
export function similarity(a, b) {
  let pts = 0;
  const why = [];
  if (a.genre && a.genre === b.genre) { pts += 3; why.push('aynı tür'); }
  if (a.author && a.author === b.author) { pts += 2; why.push('aynı yazar'); }
  const ta = tagSet(a), common = [...tagSet(b)].filter(t => ta.has(t));
  if (common.length) {
    pts += 1.5 * common.length;
    const names = (b.tags || []).filter(t => ta.has(norm(t)));
    why.push(names.slice(0, 2).join(', '));
  }
  const ps = profileSim(vec(a), vec(b));
  if (ps !== null) { pts += ps * 4; if (ps >= 0.85) why.push('benzer puan profili'); }
  if (a.spicy != null && b.spicy != null) {
    const d = Math.abs(a.spicy - b.spicy);
    pts -= d * 0.6;
    if (d === 0) why.push('aynı spicy seviyesi');
  }
  return { pts, why };
}

const unavailable = b => b.status === 'Elendi' || b.status === 'Okundu';

// Kitap sayfası: "Buna benzer kitaplar" (aynı seri hariç)
// Aynı yazarın kitapları kitap sayfasında ayrıca gösterildiği için varsayılan olarak hariç.
export function similarTo(book, limit = 10, { excludeAuthor = true } = {}) {
  return state.books
    .filter(b => b.id !== book.id && !(book.series && b.series === book.series) && b.status !== 'Elendi')
    .filter(b => !(excludeAuthor && book.author && b.author === book.author))
    .map(b => ({ b, ...similarity(book, b) }))
    .filter(r => r.pts >= 3)
    .sort((x, y) => (unavailable(x.b) - unavailable(y.b)) || y.pts - x.pts)
    .slice(0, limit);
}

// Zevk profili: sevdiğin kitaplar (puanın ≥4, favori ya da okundu)
export function tasteSeeds() {
  return state.books.filter(b => b.favorite || (b.myRating && b.myRating >= 4) || (b.status === 'Okundu' && !(b.myRating && b.myRating <= 2)));
}

// Okuma sekmesi: okuduklarına ve beğenilerine göre okunacaklardan öneri
export function tasteRecommendations(limit = 8) {
  const seeds = tasteSeeds();
  if (!seeds.length) return [];
  const disliked = state.books.filter(b => (b.myRating && b.myRating <= 2) || b.status === 'Yarım bırakıldı');
  const seriesStarted = new Set(state.books.filter(b => b.series && (b.status === 'Okundu' || b.status === 'Okunuyor')).map(b => b.series));
  const out = [];
  // Her seriden yalnızca sıradaki (en küçük sıralı, okunmamış) kitap önerilir.
  const firstOfSeries = new Map();
  for (const b of state.books) {
    if (!b.series || b.status !== 'Okunacak') continue;
    const cur = firstOfSeries.get(b.series);
    if (!cur || (b.seriesOrder ?? 999) < (cur.seriesOrder ?? 999)) firstOfSeries.set(b.series, b);
  }
  for (const b of state.books) {
    if (b.status !== 'Okunacak') continue;
    if (b.series && seriesStarted.has(b.series)) continue; // seri devamı zaten "Sıradaki kitap"ta
    if (b.series && firstOfSeries.get(b.series) !== b) continue;
    let best = null, total = 0;
    for (const s of seeds) {
      const r = similarity(s, b);
      const w = s.myRating ? s.myRating / 4 : 1;
      total += Math.max(0, r.pts) * w;
      if (!best || r.pts > best.pts) best = { ...r, seed: s };
    }
    let pts = total / seeds.length;
    for (const d of disliked) pts -= Math.max(0, similarity(d, b).pts) * 0.3;
    const sc = computeScore(b);
    if (sc !== null) pts += (sc - 3) * 0.8;
    if (b.translation && b.translation !== 'Var') pts -= 2;
    if (best && best.pts >= 3) out.push({ b, pts, because: best.seed, why: best.why });
  }
  return out.sort((x, y) => y.pts - x.pts).slice(0, limit);
}
