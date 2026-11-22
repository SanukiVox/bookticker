// Ayarlar → Google Drive (kitap dosyaları). İstemci kimliği, bağlantı, durum, şimdi eşitle, kurulum rehberi.
import { esc, toast, sheet, confirmSheet, $ } from '../ui.js';

const ORIGIN = () => location.origin;
const REDIRECT = () => { let p = location.pathname.replace(/index\.html$/, ''); if (!p.endsWith('/')) p += '/'; return location.origin + p; }; // gdrive.js ile aynı

export const driveSectionShell = () => `<div class="form-group-title">Google Drive (kitap dosyaları)</div><div class="form-group" id="drive-sec"><div class="set-row muted small">…</div></div>`;

export async function fillDriveSection(view, rerender) {
  const box = $('#drive-sec', view);
  if (!box) return;
  const gd = await import('../gdrive.js');
  const c = await gd.driveConf();
  const valid = gd.tokenValid(c);
  const [up, down] = c.connected ? await Promise.all([gd.pendingUploads(), gd.pendingDownloads()]) : [[], []];
  if (!c.clientId) {
    box.innerHTML = `<div class="set-row" style="display:block"><div class="small">Eklediğin PDF/EPUB dosyaları Google Drive'ındaki <b>Kitaplığım</b> klasörüne yüklenir; öbür cihazda tek dokunuşla (ya da kendiliğinden) iner. Bir kerelik kurulum gerekir.</div>
        <div class="btn-row" style="margin-top:10px"><button class="btn" id="gd-help">📋 Kurulum adımları</button></div>
        <div class="field" style="padding:10px 0 0"><label for="gd-cid">Google istemci kimliği (Client ID)</label><input id="gd-cid" placeholder="…apps.googleusercontent.com" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
        <button class="btn primary block" id="gd-save" style="margin-top:8px">Kaydet ve bağlan</button></div>`;
  } else {
    const st = !c.connected ? 'Bağlı değil'
      : valid ? `✅ Bağlı${c.email ? ` · ${esc(c.email)}` : ''}` : `☁️ Bağlı${c.email ? ` · ${esc(c.email)}` : ''} · bağlantı gerektiğinde kendiliğinden yenilenir`;
    box.innerHTML = `
      <div class="set-row" style="display:block"><div><b>${st}</b></div>
        <div class="small muted" style="margin-top:4px">${c.connected ? `${up.length ? `⬆️ Yüklenecek: ${up.length} dosya${up.some(x => x.audio) ? ` (${up.filter(x => x.audio).length} sesli kitap bölümü)` : ''} · ` : ''}${down.length ? `⬇️ Bu cihazda olmayan: ${down.length} dosya · ` : ''}${c.lastSync ? `Son eşitleme: ${new Date(c.lastSync).toLocaleString('tr-TR')}` : 'Henüz eşitlenmedi'}` : 'Bağlanınca bu cihazdaki dosyalar Drive\'a yüklenir.'}<br>📄 Kitaplar: <b>Kitaplığım</b> klasörü · 🎧 Sesli kitaplar: <b>Kitaplığım - Sesli Kitaplar</b> klasörü (her kitap ayrı alt klasörde; öbür cihazda dinlerken indirilir)${c.lastError ? `<br><span style="color:var(--danger)">${esc(c.lastError)}</span>` : ''}</div></div>
      ${c.connected ? `<button class="set-row" id="gd-sync" style="width:100%;border:0;background:none;text-align:left">🔄 Şimdi eşitle<span class="chev"></span></button>
        <div class="set-row"><span>Öbür cihazda eklenenleri kendiliğinden indir</span><span class="toggle"><input type="checkbox" id="gd-auto" ${c.autoDownload !== false ? 'checked' : ''}><span></span></span></div>` : ''}
      <button class="set-row" id="gd-connect" style="width:100%;border:0;background:none;text-align:left">${c.connected ? '🔑 Bağlantıyı yenile' : '🔗 Google Drive\'a bağlan'}<span class="chev"></span></button>
      <button class="set-row" id="gd-edit" style="width:100%;border:0;background:none;text-align:left">⚙️ İstemci kimliği ve kurulum<span class="chev"></span></button>
      ${c.connected ? '<button class="set-row" id="gd-off" style="width:100%;border:0;background:none;text-align:left;color:var(--danger)">Bağlantıyı kes</button>' : ''}`;
  }

  $('#gd-help', box)?.addEventListener('click', openHelp);
  $('#gd-save', box)?.addEventListener('click', async () => {
    const id = $('#gd-cid', box).value.trim();
    if (!/\.apps\.googleusercontent\.com$/.test(id)) { toast('İstemci kimliği …apps.googleusercontent.com ile bitmeli'); return; }
    const conf = await gd.driveConf();
    await (await import('../db.js')).db.putMeta('gdrive', { ...conf, clientId: id });
    await saveClientId(id);
    location.reload(); // ayarı tazele, sonra bağlan düğmesi
  });
  $('#gd-connect', box)?.addEventListener('click', () => gd.connect({ returnTo: '#/settings' }).catch(e => toast(e.message)));
  $('#gd-edit', box)?.addEventListener('click', () => openHelp(c.clientId));
  $('#gd-auto', box)?.addEventListener('change', async e => {
    const conf = await gd.driveConf();
    await (await import('../db.js')).db.putMeta('gdrive', { ...conf, autoDownload: e.target.checked });
    location.reload();
  });
  $('#gd-sync', box)?.addEventListener('click', async e => {
    const btn = e.currentTarget; btn.firstChild.textContent = '🔄 Eşitleniyor…';
    try {
      const r = await gd.syncDrive({ download: true, onProgress: m => { btn.firstChild.textContent = m.length > 48 ? `${m.slice(0, 48)}…` : m; } });
      if (r?.needAuth) { gd.connect({ silent: !!c.email, returnTo: '#/settings' }); return; }
      if (r?.skipped) toast('Drive bağlı değil');
      else toast(`☁️ ${r.up || 0} yüklendi · ${r.down || 0} indirildi${r.failed?.length ? ` · ⚠️ ${r.failed.length} dosya alınamadı (ayrıntı aşağıda)` : ''}`, r.failed?.length ? 6000 : undefined);
    } catch (err) { toast(err.message || 'Eşitlenemedi'); }
    rerender?.();
  });
  $('#gd-off', box)?.addEventListener('click', async () => {
    if (!(await confirmSheet('Drive bağlantısını kes', 'Drive\'daki dosyalar silinmez; bu cihaz artık yükleme/indirme yapmaz.', 'Bağlantıyı kes'))) return;
    await gd.disconnect(); rerender?.();
  });
}

function openHelp(current = '') {
  sheet({
    title: '☁️ Google Drive kurulumu',
    body: `<div class="small" style="line-height:1.5">
      <p>Bir kerelik, bilgisayardan yapman daha kolay (~10 dk). Google hesabınla:</p>
      <ol style="padding-left:18px">
        <li><b>console.cloud.google.com</b> → üstten <b>Proje seç → Yeni proje</b> → ad: <i>Kitapligim</i> → Oluştur.</li>
        <li><b>APIs &amp; Services → Library</b> → <i>Google Drive API</i> → <b>Enable</b>.</li>
        <li><b>Google Auth Platform</b> (ya da <i>OAuth consent screen</i>) → <b>Get started</b>: uygulama adı <i>Kitaplığım</i>, destek e-postası senin adresin → <b>Audience: External</b> → kaydet.</li>
        <li><b>Audience → Test users → Add users</b> → kendi Gmail adresini ekle.</li>
        <li><b>Data access → Add or remove scopes</b> → <code>…/auth/drive.file</code> seç → kaydet.</li>
        <li><b>Clients → Create client</b> → tür: <b>Web application</b>
          <br>• Authorized JavaScript origins: <code>${esc(ORIGIN())}</code>
          <br>• Authorized redirect URIs: <code>${esc(REDIRECT())}</code> → <b>Create</b>.</li>
        <li>Çıkan <b>Client ID</b>'yi (…apps.googleusercontent.com) kopyala, aşağıya yapıştır.</li>
      </ol>
      <p class="muted">Bağlanırken Google "uygulama doğrulanmadı" diyebilir (uygulama sadece senin için, test modunda): <b>Gelişmiş → Kitaplığım'a git</b> de. Uygulama yalnızca kendi yüklediği dosyaları görebilir; Drive'ının geri kalanına erişemez.</p>
    </div>
    <div class="field" style="padding:6px 0 0"><label for="gd-cid2">Client ID</label><input id="gd-cid2" value="${esc(current)}" placeholder="…apps.googleusercontent.com" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
    <div class="btn-row" style="margin-top:8px"><button class="btn" id="gd-copy">📋 Adresleri kopyala</button><button class="btn primary" id="gd-save2">Kaydet</button></div>`,
    onMount: (el, close) => {
      $('#gd-copy', el).addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(`JavaScript origin: ${ORIGIN()}\nRedirect URI: ${REDIRECT()}`); toast('📋 Kopyalandı'); } catch { toast('Kopyalanamadı'); }
      });
      $('#gd-save2', el).addEventListener('click', async () => {
        const id = $('#gd-cid2', el).value.trim();
        if (!/\.apps\.googleusercontent\.com$/.test(id)) { toast('İstemci kimliği …apps.googleusercontent.com ile bitmeli'); return; }
        const gd = await import('../gdrive.js');
        const conf = await gd.driveConf();
        await (await import('../db.js')).db.putMeta('gdrive', { ...conf, clientId: id });
        await saveClientId(id);
        close(); location.reload();
      });
    },
  });
}

// İstemci kimliği gizli değildir; ayarlarla GitHub'a gider, böylece öbür cihazlarda yeniden girmek gerekmez
async function saveClientId(id) {
  const st = await import('../store.js');
  st.state.settings.driveClientId = id;
  await st.saveSettings();
}
