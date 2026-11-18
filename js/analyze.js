// Ücretsiz, çevrimdışı metin çözümleyici (yapay zekâ değil, kural tabanlı).
// Kitabın düz metninden spicy (açık sahne sayısı ve yoğunluğu), tempo, romantizm ağırlığı ve aksiyon için
// tahmini puan ve istatistik üretir. Türkçe ve İngilizce metinlerde çalışır. DOM kullanmaz (test edilebilir).

const low = s => s.toLocaleLowerCase('tr');
// \b Türkçe harflerde çalışmaz; kelime başı için harf olmayan bir önceki karakter aranır
const rx = list => new RegExp(list.map(w => '(?<![\\p{L}])' + w.replace(/^\\b/, '').replace(/\\b$/, '(?![\\p{L}])')).join('|'), 'gu');

// Açık (explicit) ifadeler: sahnenin gerçekten yetişkin içerikli olduğunu gösterir
const EXPLICIT = rx([
  '\\bcock\\b', '\\bclit', '\\bpussy\\b', '\\borgasm', '\\bcum\\b', '\\bcumming\\b', 'inside me\\b', 'inside her\\b', 'inside you\\b',
  'fuck me\\b', 'fucks? her\\b', 'his length\\b', 'my core\\b', 'her core\\b', '\\bshaft\\b', 'my sex\\b', 'her sex\\b', '\\bslick\\b',
  'wetness', 'my entrance', 'her entrance', 'come for me', 'made me come', 'make you come', 'my clit',
  'aleti', 'aletin', '\\bpenis', 'klitoris', 'içime (gir|sok|it)', 'içime doğru', 'boşal', 'ıslaklığ', 'ıslaklık', 'kadınlığ', 'erkekliğ',
  'seviş', 'orgazm', 'kasıklar', 'parmağını içime', 'parmaklarını içime', 'içimde hareket', 'içeri soktum', 'içime soktu', 'kendime dokun', 'kendimi okşa',
]);
// Duyusal ifadeler: yakınlaşma sahnelerinde sık geçer, tek başına açık içerik sayılmaz
const SENSUAL = rx([
  '\\bnipples?\\b', '\\bbreasts?\\b', '\\btits\\b', '\\bmoan', '\\bnaked\\b', '\\bthrust', '\\bhips\\b', '\\bgroan', 'between my legs', 'between her legs',
  '\\bundress', '\\bshirtless\\b', '\\barousal\\b', '\\baroused\\b',
  'göğüs uç', 'meme', 'inle', 'çıplak', 'kalça', 'bacaklarımın arası', 'bacaklarının arası', 'sertleş', 'arzuyla', 'soyun',
]);
const ROMANCE = rx([
  '\\bkiss', '\\blove\\b', '\\bloved\\b', '\\bheart\\b', '\\btouch', '\\bblush', '\\bdesire', '\\blips\\b', '\\bembrace',
  'öp', 'aşk', 'sev(gi|dim|iyor)', 'kalbim', 'dudak', 'dokun', 'sarıl', 'arzu',
]);
const ACTION = rx([
  '\\bsword', '\\bdagger', '\\bblade', '\\bblood', '\\bfight', '\\battack', '\\bkill', '\\bscream', '\\brun\\b', '\\bran\\b', '\\bweapon', '\\bbattle', '\\bexplo',
  'kılıç', 'hançer', '\\bkan\\b', 'kanı', 'dövüş', 'saldır', 'öldür', 'çığlık', 'koş', 'silah', 'savaş', 'patla',
]);

const count = (re, s) => { re.lastIndex = 0; let n = 0; while (re.exec(s)) n++; return n; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const half = v => Math.round(v * 2) / 2;

export function analyzeText(raw) {
  const text = String(raw || '');
  const paras = text.split(/\n+/).map(p => p.trim()).filter(p => p.length > 1);
  const words = (text.match(/[\p{L}']+/gu) || []).length || 1;
  const w10k = words / 10000;

  // Paragraf bazında puan
  const ex = [], se = [];
  let rom = 0, act = 0, dialog = 0;
  for (const p of paras) {
    const l = low(p);
    ex.push(count(EXPLICIT, l));
    se.push(count(SENSUAL, l));
    rom += count(ROMANCE, l);
    act += count(ACTION, l);
    if (/^["“”«'‘’—–-]/.test(p)) dialog++;
  }

  // Açık sahneler: açık ifade geçen paragraflar 12 paragraftan kısa aralıklarla kümelenir
  const scenes = [];
  let cur = null;
  ex.forEach((n, i) => {
    if (!n) return;
    if (cur && i - cur.end <= 12) { cur.end = i; cur.hits += n; }
    else { if (cur) scenes.push(cur); cur = { start: i, end: i, hits: n }; }
  });
  if (cur) scenes.push(cur);
  for (const s of scenes) for (let i = s.start; i <= s.end; i++) s.sens = (s.sens || 0) + se[i];
  const real = scenes.filter(s => s.hits >= 3 || (s.hits >= 2 && s.sens >= 4)); // tek kelimelik geçişler sahne sayılmaz
  const detailed = real.filter(s => s.hits >= 6 || s.end - s.start >= 15);
  const exTotal = ex.reduce((a, b) => a + b, 0);
  const seTotal = se.reduce((a, b) => a + b, 0);

  // Spicy (0–5): sahne sayısı + detay + yoğunluk
  let spicy;
  const exDensity = exTotal / w10k; // 10 bin kelimede açık ifade
  const seD = seTotal / w10k;
  if (!real.length) spicy = seD > 12 ? 2 : seD > 6 ? 1.5 : seD > 2 ? 1 : seD > 0.5 ? 0.5 : 0;
  else {
    spicy = 1.5 + Math.min(real.length, 8) * 0.2 + Math.min(detailed.length, 6) * 0.4 + Math.min(exDensity, 12) * 0.05;
    if (!detailed.length) spicy = Math.min(spicy, 2.5);
  }
  spicy = clamp(half(spicy), 0, 5);

  // Tempo: diyalog oranı ve paragraf uzunluğu (kısa paragraf + çok diyalog = hızlı okunur)
  const avgPara = words / Math.max(paras.length, 1);
  const dialogRatio = dialog / Math.max(paras.length, 1);
  const pace = clamp(half(2.5 + dialogRatio * 3 + (avgPara < 40 ? 0.5 : avgPara > 70 ? -0.5 : 0)), 1, 5);
  // Romantizmin ağırlığı ve aksiyon: 10 bin kelimedeki ilgili kelime yoğunluğu
  // Türkçe eklemeli dil: aynı metin daha az kelimeyle yazılır, yoğunluklar şişer → ölçeğe çek
  const tr = ((text.match(/[ıİşŞğĞ]/g) || []).length / Math.max(text.length, 1)) > 0.004;
  const k = tr ? 0.65 : 1;
  const romD = (rom / w10k) * k, actD = (act / w10k) * k;
  const romance = clamp(half(1.2 + romD / 10), 1, 5);
  const action = clamp(half(1 + actD / 18), 1, 5);

  return {
    spicy, pace, romance, action,
    stats: {
      sensualPer10k: Math.round(seTotal / w10k * 10) / 10, words, scenes: real.length, detailedScenes: detailed.length, explicitPer10k: Math.round(exDensity * 10) / 10,
      dialogRatio: Math.round(dialogRatio * 100), avgParagraph: Math.round(avgPara), romancePer10k: Math.round(romD), actionPer10k: Math.round(actD), lang: tr ? 'tr' : 'en',
    },
  };
}
