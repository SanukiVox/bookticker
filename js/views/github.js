// Ayarlar → GitHub eşitleme bölümü.
import { sync, isConfigured, configure, disconnect, setAuto, push, pull, testConnection } from '../sync.js';
import { esc, toast, sheet, confirmSheet, $ } from '../ui.js';
import { applyTheme } from '../ui.js';

function ago(t) {
  if (!t) return 'hiç';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'az önce';
  if (s < 3600) return `${Math.round(s / 60)} dk önce`;
  if (s < 86400) return `${Math.round(s / 3600)} saat önce`;
  return new Date(t).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function githubSection() {
  if (!isConfigured()) {
    return `<div class="form-group-title">GitHub eşitleme</div>
      <div class="form-group"><button class="set-row" id="gh-setup" style="width:100%;border:0;background:none;text-align:left">☁️ GitHub'a bağlan<span class="muted small" style="margin-left:auto">kurulmadı</span><span class="chev"></span></button>
      <div class="set-row muted small" style="display:block">Bağlanınca her değişiklik gizli GitHub deponuza da kaydedilir; telefon değişse bile verilerini oradan geri çekebilirsin.</div></div>`;
  }
  const c = sync.cfg;
  const status = sync.busy ? '🔄 Eşitleniyor…'
    : c.conflict ? '⚠️ GitHub\'da daha yeni veri var'
    : c.error ? `⚠️ ${esc(c.error)}`
    : c.dirty ? (navigator.onLine ? '⏳ Gönderilecek değişiklik var' : '📴 İnternet yok · değişiklikler bekliyor')
    : '✅ Eşitlendi';
  return `<div class="form-group-title">GitHub eşitleme</div>
    <div class="form-group">
      <div class="set-row" style="display:block"><div><b>${status}</b></div>
        <div class="muted small">${esc(c.owner)}/${esc(c.repo)} · ${esc(c.branch)}<br>Son gönderim: ${ago(c.lastPush)} · Son çekme: ${ago(c.lastPull)}</div></div>
      ${c.conflict ? `<div class="set-row" style="display:block"><div class="small" style="margin-bottom:8px">Bu veriler başka bir yerden (başka telefon, eski yedek vb.) GitHub'a kaydedilmiş. Ne yapmak istersin?</div>
        <div class="btn-row"><button class="btn" id="gh-pull2">GitHub'dakini al</button><button class="btn" id="gh-force" style="color:var(--danger)">Telefondakini yaz</button></div></div>` : ''}
      <button class="set-row" id="gh-push" style="width:100%;border:0;background:none;text-align:left" ${sync.busy ? 'disabled' : ''}>⬆️ Şimdi GitHub'a gönder<span class="chev"></span></button>
      <button class="set-row" id="gh-pull" style="width:100%;border:0;background:none;text-align:left" ${sync.busy ? 'disabled' : ''}>⬇️ GitHub'dan çek<span class="chev"></span></button>
      <div class="set-row"><span>Değişiklikleri otomatik gönder</span><span class="toggle"><input type="checkbox" id="gh-auto" ${c.auto ? 'checked' : ''}><span></span></span></div>
      <button class="set-row" id="gh-edit" style="width:100%;border:0;background:none;text-align:left">🔑 Bağlantı ayarları<span class="chev"></span></button>
    </div>`;
}

export function wireGithub(view) {
  $('#gh-setup', view)?.addEventListener('click', openSetup);
  $('#gh-edit', view)?.addEventListener('click', openSetup);
  $('#gh-auto', view)?.addEventListener('change', e => setAuto(e.target.checked));
  $('#gh-push', view)?.addEventListener('click', () => doPush(false));
  $('#gh-force', view)?.addEventListener('click', async () => {
    if (!(await confirmSheet('Telefondakini yaz', 'GitHub\'daki daha yeni veriler, bu telefondakilerle değiştirilecek. (Eski hâli GitHub geçmişinde durur.)', 'Yaz'))) return;
    doPush(true);
  });
  const pullHandler = async () => {
    if (!(await confirmSheet('GitHub\'dan çek', 'Bu telefondaki kitaplar, GitHub\'daki verilerle değiştirilecek.', 'Çek', false))) return;
    try { const n = await pull(); applyTheme(); toast(`⬇️ ${n} kitap GitHub'dan alındı`); } catch (e) { toast(e.message); }
  };
  $('#gh-pull', view)?.addEventListener('click', pullHandler);
  $('#gh-pull2', view)?.addEventListener('click', pullHandler);
}

async function doPush(force) {
  try { await push({ force }); toast('☁️ GitHub\'a kaydedildi'); } catch (e) { toast(e.message); }
}

function openSetup() {
  const c = sync.cfg || {};
  sheet({
    title: 'GitHub bağlantısı',
    body: `
      <p class="small muted">Verilerin, GitHub'daki <b>gizli (private)</b> veri deponda saklanır. Anahtar sadece bu telefonda durur.</p>
      <div class="form-group">
        <div class="field"><label for="gh-owner">GitHub kullanıcı adın</label><input id="gh-owner" value="${esc(c.owner || '')}" placeholder="örn. SanukiVox" autocapitalize="off" autocorrect="off" spellcheck="false"></div>
        <div class="field"><label for="gh-repo">Veri deposunun adı</label><input id="gh-repo" value="${esc(c.repo || 'bookticker-data')}" autocapitalize="off" autocorrect="off" spellcheck="false"></div>
        <div class="field"><label for="gh-branch">Dal (branch)</label><input id="gh-branch" value="${esc(c.branch || 'main')}" autocapitalize="off" autocorrect="off" spellcheck="false"></div>
        <div class="field"><label for="gh-token">Erişim anahtarı (token)</label><input id="gh-token" type="password" value="${esc(c.token || '')}" placeholder="github_pat_…" autocapitalize="off" autocorrect="off" spellcheck="false"></div>
      </div>
      <div id="gh-msg" class="small" style="min-height:20px"></div>
      ${isConfigured() ? '<button class="btn block danger" id="gh-disc" style="margin-top:8px">Bağlantıyı kaldır</button>' : ''}`,
    foot: '<button class="btn" data-close>Vazgeç</button><button class="btn primary" id="gh-save">Bağlan</button>',
    onMount: (el, close) => {
      const msg = $('#gh-msg', el);
      $('#gh-save', el).addEventListener('click', async () => {
        const v = id => $(id, el).value.trim();
        if (!v('#gh-owner') || !v('#gh-repo') || !v('#gh-token')) { msg.textContent = 'Kullanıcı adı, depo adı ve anahtar gerekli.'; return; }
        const prev = sync.cfg;
        const sameTarget = prev && prev.owner === v('#gh-owner') && prev.repo === v('#gh-repo') && prev.branch === (v('#gh-branch') || 'main');
        await configure({ owner: v('#gh-owner'), repo: v('#gh-repo'), branch: v('#gh-branch'), token: v('#gh-token'), reset: !sameTarget });
        msg.textContent = 'Bağlantı deneniyor…';
        try {
          const r = await testConnection();
          close();
          if (r.warn) toast(r.warn);
          // İlk bağlantı: GitHub'da veri varsa çekmeyi, yoksa göndermeyi öner.
          firstSyncChoice();
        } catch (e) {
          msg.style.color = 'var(--danger)';
          msg.textContent = e.message;
        }
      });
      $('#gh-disc', el)?.addEventListener('click', async () => {
        if (!(await confirmSheet('Bağlantıyı kaldır', 'Telefondaki verilerin silinmez; sadece GitHub\'a gönderim durur.', 'Kaldır'))) return;
        await disconnect(); close(); toast('GitHub bağlantısı kaldırıldı');
      });
    },
  });
}

async function firstSyncChoice() {
  const { remoteChanged } = await import('../sync.js');
  let hasRemote = false;
  try { hasRemote = await remoteChanged(); } catch (e) { toast(e.message); return; }
  if (hasRemote) {
    sheet({
      title: 'GitHub\'da veri bulundu',
      body: '<p>Bu depoda daha önce kaydedilmiş kitaplar var. Hangisini kullanalım?</p>',
      foot: '<button class="btn" id="c-push">Telefondakini gönder</button><button class="btn primary" id="c-pull">GitHub\'dakini al</button>',
      onMount: (el, close) => {
        $('#c-pull', el).addEventListener('click', async () => { close(); try { const n = await pull(); applyTheme(); toast(`⬇️ ${n} kitap alındı`); } catch (e) { toast(e.message); } });
        $('#c-push', el).addEventListener('click', async () => {
          close();
          if (!(await confirmSheet('Telefondakini gönder', 'GitHub\'daki veriler bu telefondakilerle değiştirilecek. (Eski hâli GitHub geçmişinde durur.)', 'Gönder'))) return;
          doPush(true);
        });
      },
    });
  } else {
    toast('✅ Bağlandı · ilk gönderim yapılıyor…');
    doPush(false);
  }
}
