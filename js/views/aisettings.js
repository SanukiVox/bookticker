// Ayarlar → Asistan (Claude API anahtarı, model, yanıt derinliği, harcama).
import { esc, toast, sheet, confirmSheet, $ } from '../ui.js';
import { aiConfig, saveAiConfig, testKey, MODELS, DEPTHS } from '../ai.js';

const CONSOLE_KEYS = 'https://console.anthropic.com/settings/keys';
const fmt$ = v => `$${(v || 0).toFixed(2).replace('.', ',')}`;

export async function fillAiSection(view) {
  const box = $('#ai-sec', view);
  if (!box) return;
  const c = await aiConfig();
  if (!c.key) {
    box.innerHTML = `
      <button class="set-row" id="ai-add" style="width:100%;border:0;background:none;text-align:left">🔑 Claude API anahtarı ekle<span class="muted small" style="margin-left:auto">kurulmadı</span><span class="chev"></span></button>
      <div class="set-row muted small" style="display:block">Anahtar eklersen kitaplığını ve notlarını bilen asistanla uygulamanın içinde sohbet edebilirsin. Anahtarı <a href="${CONSOLE_KEYS}" target="_blank" rel="noopener" style="color:var(--accent)">Claude Console → API keys</a> sayfasından oluştur. Anahtar sadece bu cihazda saklanır.</div>`;
  } else {
    box.innerHTML = `
      <div class="set-row"><span>Anahtar</span><span class="muted small" style="font-family:ui-monospace,monospace">sk-ant-…${esc(c.key.slice(-4))}</span></div>
      <div class="set-row"><span>Model</span><select id="ai-model">${Object.entries(MODELS).map(([k, m]) => `<option value="${k}" ${c.model === k ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select></div>
      <div class="set-row"><span>Yanıt derinliği</span><select id="ai-effort">${Object.entries(DEPTHS).map(([k, l]) => `<option value="${k}" ${c.effort === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="set-row"><span>Harcanan (tahmini)</span><span class="muted">${fmt$(c.spent)}</span></div>
      <a class="set-row" href="#/chat">💬 Sohbeti aç<span class="chev"></span></a>
      <button class="set-row" id="ai-add" style="width:100%;border:0;background:none;text-align:left">🔑 Anahtarı değiştir<span class="chev"></span></button>
      <button class="set-row" id="ai-del" style="width:100%;border:0;background:none;text-align:left;color:var(--danger)">Anahtarı bu cihazdan sil</button>
      <div class="set-row muted small" style="display:block">Gerçek bakiye ve harcama: <a href="https://console.anthropic.com/settings/billing" target="_blank" rel="noopener" style="color:var(--accent)">Claude Console → Billing</a>. Daha derin yanıtlar ve Opus daha pahalıdır. Anahtar GitHub'a ve yedeğe gitmez.</div>`;
    $('#ai-model', box).addEventListener('change', async e => { await saveAiConfig({ model: e.target.value, modelChosen: true }); toast('Model değişti'); });
    $('#ai-effort', box).addEventListener('change', async e => { await saveAiConfig({ effort: e.target.value }); toast('Kaydedildi'); });
    $('#ai-del', box).addEventListener('click', async () => {
      if (!(await confirmSheet('Anahtarı sil', 'Claude API anahtarı bu cihazdan silinecek. Console\'daki anahtar silinmez.', 'Sil'))) return;
      await saveAiConfig({ key: '' }); toast('Anahtar silindi'); fillAiSection(view);
    });
  }
  $('#ai-add', box).addEventListener('click', () => openKeySheet(view));
}

function openKeySheet(view) {
  sheet({
    title: 'Claude API anahtarı',
    body: `<ol class="small" style="padding-left:18px;line-height:1.6">
        <li><a href="${CONSOLE_KEYS}" target="_blank" rel="noopener" style="color:var(--accent)">Claude Console → API keys</a> sayfasını aç.</li>
        <li><b>Create key</b> → ad: <b>kitapligim</b> → oluştur.</li>
        <li><b>sk-ant-…</b> ile başlayan anahtarı kopyala, buraya yapıştır.</li></ol>
      <div class="form-group"><div class="field"><label for="ai-key">Anahtar</label><input id="ai-key" type="password" placeholder="sk-ant-api03-…" autocapitalize="off" autocorrect="off" spellcheck="false" autocomplete="off"></div></div>
      <div id="ai-msg" class="small" style="min-height:20px"></div>
      <p class="muted small">Anahtar sadece bu cihazda saklanır; GitHub'a, yedeğe ya da başka bir yere gönderilmez. Bu anahtarı kimseyle paylaşma.</p>`,
    foot: '<button class="btn" data-close>Vazgeç</button><button class="btn primary" id="ai-save">Kaydet ve dene</button>',
    onMount: (el, close) => {
      $('#ai-save', el).addEventListener('click', async () => {
        const k = $('#ai-key', el).value.trim();
        const msg = $('#ai-msg', el);
        if (!/^sk-ant-/.test(k)) { msg.style.color = 'var(--danger)'; msg.textContent = 'Anahtar "sk-ant-" ile başlamalı.'; return; }
        const prev = (await aiConfig()).key;
        await saveAiConfig({ key: k });
        msg.style.color = ''; msg.textContent = 'Deneniyor…';
        try {
          await testKey();
          close(); toast('✅ Anahtar çalışıyor'); fillAiSection(view);
        } catch (e) {
          await saveAiConfig({ key: prev });
          msg.style.color = 'var(--danger)'; msg.textContent = e.message;
        }
      });
    },
  });
}
