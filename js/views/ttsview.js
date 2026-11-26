// "EPUB'dan sesli kitap oluştur" penceresi ve kitap sayfasındaki ilerleme satırı
import { esc, toast, sheet, $, $$ } from '../ui.js';
import * as T from '../tts.js';

const REGIONS = ['westeurope', 'northeurope', 'germanywestcentral', 'francecentral', 'uksouth', 'eastus', 'westus2', 'swedencentral'];
const fmtH = m => (m >= 60 ? `${Math.floor(m / 60)} sa ${Math.round(m % 60)} dk` : `${Math.round(m)} dk`);
const usd = v => (v < 0.01 ? '0 $' : `${v.toFixed(v < 10 ? 2 : 0).replace('.', ',')} $`);

export async function openTts(b) {
  const c = { ...(await T.ttsConfig()) };
  const pending = await T.pendingJob(b.id);
  let chars = null, sampleUrl = null;
  const body = () => {
    const P = T.PROVIDERS[c.provider];
    const voice = c.provider === 'azure' ? c.azureVoice : c.openaiVoice;
    const est = chars ? T.estimate(chars) : null;
    return `
      <div class="muted small" style="margin-bottom:10px">Kitabın metni bölüm bölüm yapay zekâ sesine çevrilir ve bu kitaba sesli kitap olarak eklenir. Önce bir örnek dinle, beğenirsen tamamını oluştur.</div>
      <div class="f-block"><h3>Ses servisi</h3><div class="chip-wrap">${Object.entries(T.PROVIDERS).map(([k, p]) => `<button class="chip ${c.provider === k ? 'on' : ''}" data-prov="${k}">${p.label}</button>`).join('')}</div>
        <p class="small muted" style="margin-top:6px">${esc(P.note)}</p></div>
      <div class="field"><label for="tts-key">${c.provider === 'azure' ? 'Azure Speech anahtarı (Key 1)' : 'OpenAI API anahtarı'}</label>
        <input id="tts-key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${c.provider === 'azure' ? '32 karakterlik anahtar' : 'sk-…'}" value="${esc(c.provider === 'azure' ? c.azureKey : c.openaiKey)}">
        <p class="small muted" style="margin-top:4px">Anahtar yalnızca bu cihazda saklanır, GitHub'a gönderilmez.</p></div>
      ${c.provider === 'azure' ? `<div class="field"><label for="tts-region">Bölge (Azure'da kaynağı oluştururken seçtiğin)</label><select id="tts-region">${REGIONS.map(r => `<option ${r === c.azureRegion ? 'selected' : ''}>${r}</option>`).join('')}</select></div>` : ''}
      <div class="field"><label for="tts-voice">Ses</label><select id="tts-voice">${P.voices.map(([k, l]) => `<option value="${k}" ${k === voice ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      <div class="f-block"><h3>Okuma hızı</h3><div class="chip-wrap">${[[-10, 'Yavaş'], [0, 'Normal'], [10, 'Biraz hızlı'], [20, 'Hızlı']].map(([v, l]) => `<button class="chip ${c.rate === v ? 'on' : ''}" data-rate="${v}">${l}</button>`).join('')}</div></div>
      ${c.provider === 'openai' ? `<div class="field"><label for="tts-style">Okuma tarzı (yönerge)</label><textarea id="tts-style" rows="3">${esc(c.style)}</textarea></div>` : ''}
      <div class="btn-row"><button class="btn" id="tts-sample">▶︎ Örnek dinle (≈1 dk)</button></div>
      <div id="tts-out" class="small" style="margin-top:8px">${sampleUrl ? `<audio controls src="${sampleUrl}" style="width:100%"></audio>` : ''}</div>
      ${est ? `<div class="tts-est small"><b>Bu kitap:</b> ${chars.toLocaleString('tr-TR')} karakter · yaklaşık ${fmtH(est.minutes)} ses<br>
        Azure: ${usd(est.azure.paid)} (ilk ay ücretsiz kotayla ${usd(est.azure.withFree)}) · OpenAI: yaklaşık ${usd(est.openai)}</div>` : ''}
      ${pending?.done ? `<div class="warn" style="margin-top:8px">⏸ Bu kitabın seslendirmesi yarıda kalmış (${pending.done}. bölüme kadar hazır). "Tamamını oluştur" kaldığı yerden devam eder.</div>` : ''}`;
  };
  sheet({
    title: '🗣️ EPUB\'dan sesli kitap',
    body: `<div id="tts-body">${body()}</div>`,
    foot: '<button class="btn" data-close>Kapat</button><button class="btn primary" id="tts-go">🎧 Tamamını oluştur</button>',
    onMount: (el, close) => {
      const read = () => {
        const k = $('#tts-key', el)?.value.trim() || '';
        if (c.provider === 'azure') { c.azureKey = k; c.azureRegion = $('#tts-region', el)?.value || c.azureRegion; c.azureVoice = $('#tts-voice', el).value; }
        else { c.openaiKey = k; c.openaiVoice = $('#tts-voice', el).value; c.style = $('#tts-style', el)?.value || c.style; }
      };
      const redraw = () => { $('#tts-body', el).innerHTML = body(); wire(); };
      const wire = () => {
        $$('[data-prov]', el).forEach(x => x.addEventListener('click', () => { read(); c.provider = x.dataset.prov; redraw(); }));
        $$('[data-rate]', el).forEach(x => x.addEventListener('click', () => { read(); c.rate = Number(x.dataset.rate); redraw(); }));
        $('#tts-sample', el).addEventListener('click', async e => {
          const btn = e.currentTarget; // await'ten önce al (sonra null olur)
          read(); await T.saveTtsConfig(c);
          btn.disabled = true; btn.textContent = '⏳ Örnek hazırlanıyor…';
          try {
            const s = await T.sample(b, c);
            chars = s.chars;
            if (sampleUrl) URL.revokeObjectURL(sampleUrl);
            sampleUrl = URL.createObjectURL(s.blob);
            redraw();
            $('#tts-out audio', el)?.play().catch(() => {});
          } catch (err) { btn.disabled = false; btn.textContent = '▶︎ Örnek dinle (≈1 dk)'; $('#tts-out', el).innerHTML = `<div class="warn">${esc(err.message)}</div>`; }
        });
      };
      wire();
      $('#tts-go', el).addEventListener('click', async () => {
        read();
        if (!(c.provider === 'azure' ? c.azureKey : c.openaiKey)) { toast('Önce API anahtarını gir'); return; }
        await T.saveTtsConfig(c);
        close();
        toast('🗣️ Seslendirme başladı · uygulama açık kaldıkça bölüm bölüm ilerler');
        T.convertBook(b.id);
      });
    },
    onClose: () => { if (sampleUrl) URL.revokeObjectURL(sampleUrl); },
  });
}

// Kitap sayfasında: süren/yarım kalan iş satırı
export function ttsStatusHTML(b) {
  const j = T.jobOf(b.id);
  if (!j) return '<div id="tts-status"></div>';
  return `<div id="tts-status">${statusInner(j)}</div>`;
}
function statusInner(j) {
  const pct = j.total ? Math.floor(((j.done + (j.sub || 0)) / j.total) * 100) : 0;
  if (j.running) return `<div class="tts-run"><div class="small"><b>🗣️ Seslendiriliyor · %${pct}</b> · ${esc(j.label)}</div><div class="progress" style="height:6px"><span style="width:${pct}%"></span></div><button class="mini-btn" id="tts-stop">⏹ Durdur</button></div>`;
  if (j.error) return `<div class="warn">🗣️ ${esc(j.error)} <button class="mini-btn" id="tts-resume">▶︎ Devam et</button></div>`;
  return '<div class="small muted">🗣️ Seslendirme tamamlandı.</div>';
}
export function wireTtsStatus(view, b) {
  const box = $('#tts-status', view);
  if (!box) return;
  const w = () => {
    $('#tts-stop', box)?.addEventListener('click', () => T.stopJob(b.id));
    $('#tts-resume', box)?.addEventListener('click', () => T.convertBook(b.id));
  };
  w();
  const off = T.onJob(() => {
    if (!box.isConnected) { off(); return; }
    const j = T.jobOf(b.id);
    if (j) { box.innerHTML = statusInner(j); w(); }
  });
}
