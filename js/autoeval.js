// Ücretsiz metin değerlendirmesi: dosya eklenince boş alanları doldurur; "Yeniden değerlendir" önerileri gösterir,
// yalnızca seçilen kriterleri değiştirir. Hiçbir şey internete gönderilmez.
import { getBook, saveBook, SPICY_LABELS, CRITERIA } from './store.js';
import { slotBook, slotFile, fileWhere } from './files.js';
import { esc, toast, sheet, $, $$, fmtScore } from './ui.js';

const empty = v => v === null || v === undefined || v === '';
const AUTO = [ // değerlendirmenin dolduracağı alanlar
  { key: 'spicy', label: '🌶️ Spicy', get: b => b.spicy },
  { key: 'pace', label: CRITERIA.find(c => c.key === 'pace')?.title || 'Sürükleyicilik', get: b => b.scores?.pace },
  { key: 'romance', label: CRITERIA.find(c => c.key === 'romance')?.title || 'Romantizm', get: b => b.scores?.romance },
  { key: 'action', label: CRITERIA.find(c => c.key === 'action')?.title || 'Aksiyon', get: b => b.scores?.action },
];

// Bu cihazda açılabilen dosyası olan yuva (önce orijinal metin)
function localSlot(b) {
  const slots = [1, 2].filter(s => slotFile(b, s) && fileWhere(b, s) === 'local');
  return slots.find(s => slotFile(b, s).lang === 'orig') || slots[0] || null;
}
export const canEvaluate = b => !!localSlot(b);

const running = new Map();
export function analyzeBook(b, onProgress) {
  if (running.has(b.id)) return running.get(b.id);
  const p = (async () => {
    const slot = localSlot(b);
    if (!slot) throw new Error('Kitap dosyası bu cihazda yok');
    const { extractText } = await import('./booktext.js');
    const { text } = await extractText(slotBook(b, slot), { upToProgress: false, onProgress });
    if (!text || text.length < 5000) throw new Error('Dosyadan yeterli metin çıkarılamadı (taranmış PDF olabilir)');
    const { analyzeText } = await import('./analyze.js');
    return analyzeText(text);
  })().finally(() => running.delete(b.id));
  running.set(b.id, p);
  return p;
}

const apply = (b, key, v) => { if (key === 'spicy') { b.spicy = v; b.spicyNote = 'Metin'; } else { b.scores ||= {}; b.scores[key] = v; } };

// Dosya eklenince arka planda: yalnızca BOŞ alanlar doldurulur
export async function autoEvalAfterAttach(bookId) {
  await new Promise(r => setTimeout(r, 1500));
  let b = getBook(bookId);
  if (!b || b.autoEval) return;
  if (!AUTO.some(f => empty(f.get(b)))) return;
  let r;
  try { r = await analyzeBook(b); } catch { return; }
  b = getBook(bookId);
  if (!b) return;
  const filled = [];
  for (const f of AUTO) if (empty(f.get(b))) { apply(b, f.key, r[f.key]); filled.push(f.key); }
  b.autoEval = { at: Date.now(), ...r.stats };
  if (filled.some(k => k !== 'spicy') && empty(b.scoreNote)) b.scoreNote = 'Otomatik';
  await saveBook(b);
  if (filled.length) toast(`🔎 Metin incelendi · ${filled.includes('spicy') ? `Spicy ${fmtScore(r.spicy)}` : `${filled.length} kriter dolduruldu`}`);
}

// 🔎 Yeniden değerlendir: öneriler gösterilir, yalnızca seçilenler uygulanır
export function openReEvaluate(bookId) {
  sheet({
    title: '🔎 Metinden değerlendir',
    body: '<div id="re-body"><p class="muted">Metin inceleniyor… <b id="re-pct">%0</b></p><p class="muted small">Ücretsizdir, internet kullanmaz; kitabın uzunluğuna göre biraz sürebilir.</p></div>',
    foot: '<button class="btn" data-close>Vazgeç</button><button class="btn primary" id="re-apply" disabled>Seçilenleri uygula</button>',
    onMount: async (el, close) => {
      let b = getBook(bookId), r;
      try { r = await analyzeBook(b, f => { const p = $('#re-pct', el); if (p) p.textContent = `%${Math.round(f * 100)}`; }); }
      catch (e) { $('#re-body', el).innerHTML = `<div class="warn">${esc(e.message)}</div>`; return; }
      b = getBook(bookId);
      const s = r.stats;
      $('#re-body', el).innerHTML = `
        <p class="muted small">Değiştirmek istediğin kriterleri seç. Seçmediklerin olduğu gibi kalır.</p>
        <table class="re-table"><tr><th></th><th>Kriter</th><th>Şimdiki</th><th>Öneri</th></tr>
        ${AUTO.map(f => { const cur = f.get(b), same = !empty(cur) && Number(cur) === r[f.key];
          return `<tr${same ? ' class="same"' : ''}><td><input type="checkbox" data-k="${f.key}" ${same ? 'disabled' : ''}></td><td>${esc(f.label)}</td><td>${empty(cur) ? '—' : fmtScore(cur)}</td><td><b>${fmtScore(r[f.key])}</b></td></tr>`; }).join('')}
        </table>
        <div class="small muted" style="margin-top:6px">${esc(SPICY_LABELS[Math.floor(r.spicy)] || '')}</div>
        <div class="re-stats small"><b>Metinden</b> · ${s.scenes} açık sahne (${s.detailedScenes} detaylı) · diyalog %${s.dialogRatio} · ${Math.round(s.words / 1000)} bin kelime</div>
        <p class="muted small">Kimya, karakterler, edebî derinlik gibi kriterler metni anlamayı gerektirdiği için önerilmez.</p>`;
      const btn = $('#re-apply', el);
      const sync = () => { btn.disabled = !$$('input[data-k]:checked', el).length; };
      $$('input[data-k]', el).forEach(c => c.addEventListener('change', sync));
      btn.addEventListener('click', async () => {
        const keys = $$('input[data-k]:checked', el).map(c => c.dataset.k);
        b = getBook(bookId);
        for (const k of keys) apply(b, k, r[k]);
        b.autoEval = { at: Date.now(), ...s };
        await saveBook(b);
        close();
        toast(`✅ ${keys.length} kriter güncellendi`);
      });
    },
  });
}
