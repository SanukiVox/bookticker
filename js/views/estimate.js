// Yeni kitap değerlendirme asistanı: kitap adı/yazarından, kullanıcının değerlendirme sistemine göre
// tahmini 8 kriter + spicy + kısa değerlendirme önerir. Claude anahtarı varsa uygulama içinde,
// yoksa ücretsiz yol: istem kopyalanır, Claude/ChatGPT'ye yapıştırılır, yanıt geri yapıştırılır.
import { state, CRITERIA, SPICY_LABELS, GUIDE_FIT, displayTitle } from '../store.js';
import { esc, sheet, toast, fmtScore, $, $$ } from '../ui.js';

const FIELDS = ['originalTitle', 'author', 'genre', 'series', 'seriesOrder', 'pubYear', 'confidence', 'review', 'summary'];
const LABELS = { originalTitle: 'Orijinal adı', author: 'Yazar', genre: 'Tür', series: 'Seri', seriesOrder: 'Seri sırası', pubYear: 'Yayın yılı', confidence: 'Güven', review: 'Kısa değerlendirme', summary: 'Özet', warnings: 'İçerik uyarıları' };

function calibration() {
  // Zevki tanıtmak için puanlı kitaplardan örnekler (en çok okunmuş ve kendi puanı olanlar önce)
  const pick = state.books.filter(b => Object.keys(b.scores || {}).length >= 5)
    .sort((a, b) => (typeof b.myRating === 'number') - (typeof a.myRating === 'number') || (b.status === 'Okundu') - (a.status === 'Okundu'))
    .slice(0, 25);
  return pick.map(b => `- ${displayTitle(b)} (${b.author || '?'}): ${CRITERIA.map(c => `${c.label} ${b.scores[c.key] ?? '-'}`).join(', ')}, spicy ${b.spicy ?? '-'}${typeof b.myRating === 'number' ? `, okuduktan sonra puanım ${b.myRating}` : ''}`).join('\n');
}

export function estimatePrompt(b) {
  const opts = k => (state.options[k] || []).map(o => o.name).join(', ');
  return [
    'Bir kitap okuma listesi için yeni bir kitabı benim değerlendirme sistemime göre puanlamanı istiyorum.',
    '',
    'DEĞERLENDİRME SİSTEMİM (her kriter 1–5, buçuklu olabilir; kriterler birbirinden bağımsız):',
    ...CRITERIA.map((c, i) => `${i + 1}. ${c.title || c.label} [${c.key}]: ${c.desc}`),
    `Spicy (0–5, tam sayı; yalnızca açık yetişkin içerik yoğunluğu, ilişkinin kalitesini ölçmez): ${SPICY_LABELS.map((l, i) => `${i} = ${l}`).join('; ')}.`,
    GUIDE_FIT,
    '',
    'Zevkimi tanıman için daha önce puanladığım bazı kitaplar:',
    calibration() || '(henüz yok)',
    '',
    `PUANLANACAK KİTAP: "${b.title || b.originalTitle}"${b.originalTitle && b.title ? ` (orijinal adı: ${b.originalTitle})` : ''}${b.author ? `, yazar: ${b.author}` : ''}${b.series ? `, seri: ${b.series}${b.seriesOrder ? ` #${b.seriesOrder}` : ''}` : ''}.`,
    '',
    'Kurallar:',
    '- Kitabı gerçekten biliyorsan puanla. Emin değilsen uydurma: confidence "Düşük" yaz ve bilmediğin puanları null bırak.',
    '- Fantastik olmayan kitaplarda world kriterini geçtiği dünyanın ve atmosferin inandırıcılığına göre ver.',
    '- review: Türkçe, 2-3 cümle, spoiler yok; neden bana uygun ya da değil.',
    '- summary: Türkçe, spoilersız 3-4 cümle konu özeti.',
    `- genre şu seçeneklerden biri olsun (uygun değilse en yakın): ${opts('genres')}.`,
    `- confidence şu seçeneklerden biri: ${opts('confidences') || 'Yüksek, Orta, Düşük'}.`,
    `- warnings için uygun olanları şu listeden seç: ${opts('warnings')}.`,
    '',
    'Yanıtını YALNIZCA şu biçimde bir JSON olarak ver (başka metin yazma):',
    `{"originalTitle": "...", "author": "...", "genre": "...", "series": "...", "seriesOrder": 1, "pubYear": 2024, "scores": {${CRITERIA.map(c => `"${c.key}": 4`).join(', ')}}, "spicy": 2, "confidence": "Orta", "warnings": ["..."], "review": "...", "summary": "..."}`,
  ].join('\n');
}

export function parseEstimate(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j;
  try { j = JSON.parse(m[0]); } catch { try { j = JSON.parse(m[0].replace(/,\s*([}\]])/g, '$1')); } catch { return null; } }
  const clamp = (v, lo, hi, step) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Math.max(lo, Math.min(hi, Math.round(Number(v) / step) * step)));
  const out = { scores: {} };
  for (const c of CRITERIA) { const v = clamp(j.scores?.[c.key], 1, 5, 0.5); if (v !== null) out.scores[c.key] = v; }
  out.spicy = clamp(j.spicy, 0, 5, 1);
  for (const f of FIELDS) if (j[f] !== undefined && j[f] !== null && String(j[f]).trim() !== '') out[f] = typeof j[f] === 'string' ? j[f].trim() : j[f];
  if (Array.isArray(j.warnings)) out.warnings = j.warnings.map(String).filter(Boolean);
  return out;
}

// est: parseEstimate sonucu; apply(est, onlyEmpty) formu doldurur
function preview(el, b, est, apply, close) {
  const rows = [
    ...CRITERIA.filter(c => est.scores[c.key] != null).map(c => [c.title || c.label, fmtScore(est.scores[c.key]), b.scores?.[c.key] != null ? fmtScore(b.scores[c.key]) : null]),
    ...(est.spicy != null ? [['🌶️ Spicy', String(est.spicy), b.spicy != null ? String(b.spicy) : null]] : []),
    ...FIELDS.filter(f => est[f] != null).map(f => [LABELS[f], String(est[f]), b[f] ? String(b[f]) : null]),
    ...(est.warnings?.length ? [[LABELS.warnings, est.warnings.join(', '), (b.warnings || []).length ? b.warnings.join(', ') : null]] : []),
  ];
  if (!rows.length) { $('#est-body', el).innerHTML = '<div class="warn">Yanıtta kullanılabilir bir tahmin yok. Model kitabı tanımıyor olabilir.</div>'; return; }
  $('#est-body', el).innerHTML = `${est.confidence ? `<div class="small muted" style="margin-bottom:6px">Güven: <b>${esc(est.confidence)}</b></div>` : ''}
    <div class="est-table">${rows.map(([l, v, cur]) => `<div class="est-row"><span class="est-l">${esc(l)}</span><span class="est-v">${esc(v.length > 160 ? `${v.slice(0, 160)}…` : v)}${cur != null ? `<span class="est-cur">şu an: ${esc(cur.length > 40 ? `${cur.slice(0, 40)}…` : cur)}</span>` : ''}</span></div>`).join('')}</div>
    <div class="btn-row" style="margin-top:12px"><button class="btn" id="est-empty">Yalnızca boşları doldur</button><button class="btn primary" id="est-all">Tümünü uygula</button></div>
    <div class="small muted" style="margin-top:6px">Tahmindir; kaydetmeden önce formda düzeltebilirsin.</div>`;
  $('#est-empty', el).addEventListener('click', () => { apply(est, true); close(); toast('🤖 Boş alanlar dolduruldu'); });
  $('#est-all', el).addEventListener('click', () => { apply(est, false); close(); toast('🤖 Tahmin uygulandı'); });
}

export async function openEstimate(b, apply) {
  if (!b.title && !b.originalTitle) { toast('Önce kitap adını yaz'); return; }
  const { hasKey, chat } = await import('../ai.js');
  const keyed = await hasKey();
  const prompt = estimatePrompt(b);
  sheet({
    title: '🤖 Puanları tahmin et',
    body: `<div class="muted small" style="margin-bottom:10px">"${esc(b.title || b.originalTitle)}" için değerlendirme sistemine göre tahmini puan, spicy, kısa değerlendirme ve özet.</div>
      <div id="est-body">
        ${keyed ? '<button class="btn primary block" id="est-run">🤖 Claude ile tahmin et</button><div class="small muted" style="margin:6px 0 14px">Anahtarındaki bakiyeden kısa bir istek harcar.</div>' : ''}
        <details ${keyed ? '' : 'open'}><summary class="small" style="margin-bottom:8px">Ücretsiz yol: istemi kopyala, Claude ya da ChatGPT'ye yapıştır</summary>
          <div class="btn-row"><button class="btn" id="est-copy">📋 İstemi kopyala</button><a class="btn" href="https://claude.ai/new" target="_blank" rel="noopener">Claude ↗</a><a class="btn" href="https://chatgpt.com/" target="_blank" rel="noopener">ChatGPT ↗</a></div>
          <textarea id="est-paste" rows="4" placeholder="Gelen yanıtı (JSON) buraya yapıştır" style="width:100%;margin-top:10px;border-radius:12px;border:1px solid var(--line);padding:10px;background:var(--surface);color:var(--text);font:inherit;font-size:14px"></textarea>
          <button class="btn block" id="est-parse" style="margin-top:8px">Yanıtı oku</button></details>
      </div>`,
    onMount: (el, close) => {
      $('#est-copy', el)?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(prompt); toast('📋 İstem kopyalandı'); } catch { toast('Kopyalanamadı'); } });
      $('#est-parse', el)?.addEventListener('click', () => {
        const est = parseEstimate($('#est-paste', el).value);
        if (!est) { toast('Yanıtta JSON bulunamadı'); return; }
        preview(el, b, est, apply, close);
      });
      $('#est-run', el)?.addEventListener('click', async e => {
        const btn = e.currentTarget; btn.disabled = true; btn.textContent = '🤖 Düşünüyor…';
        try {
          const res = await chat({ system: 'Kitapları kullanıcının kendi değerlendirme sistemine göre puanlayan bir asistansın. Yalnızca istenen JSON\'u döndür.', messages: [{ role: 'user', content: prompt }] });
          const est = parseEstimate(res.text);
          if (!est) { btn.disabled = false; btn.textContent = '🤖 Tekrar dene'; toast('Yanıt okunamadı'); return; }
          preview(el, b, est, apply, close);
        } catch (err) { btn.disabled = false; btn.textContent = '🤖 Claude ile tahmin et'; toast(err.message || 'İstek başarısız'); }
      });
    },
  });
}
