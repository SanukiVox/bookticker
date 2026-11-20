// Ayarlar → Bildirimler (yönetici ve kullanıcı için ortak)
import { state } from '../store.js';
import { esc, toast, sheet, confirmSheet, $ } from '../ui.js';

export async function renderNotify(view) {
  const P = await import('../push.js');
  const admin = !state.guest;
  const p = P.prefs();
  view.innerHTML = `<div class="topbar"><a class="icon-btn" href="#/settings" aria-label="Geri">‹</a><div class="title">Bildirimler</div></div><div id="nt-body"><div class="muted small">Yükleniyor…</div></div>`;
  const body = $('#nt-body', view);
  let cfg = null, cfgErr = '';
  try { cfg = await P.config(); } catch (e) { cfgErr = e.message; }
  if (!body.isConnected) return; // bu arada başka bir ekran açıldı

  const blocked = !P.supported() || (P.isIOS() && !P.standalone());
  const hours = Array.from({ length: 17 }, (_, i) => i + 7);
  body.innerHTML = `
    ${blocked ? `<div class="section"><b>📱 Önce uygulamayı ana ekrana ekle</b><p class="muted small">iPhone'da bildirimler yalnızca ana ekrana eklenen uygulamada çalışır (iOS 16.4 ve üzeri). Safari → Paylaş → Ana Ekrana Ekle, sonra uygulamayı ana ekrandaki simgeden açıp buraya gel.</p></div>` : ''}
    ${admin ? `<div class="section"><h3>🔧 Bildirim sistemi</h3>
      ${cfg ? '<p class="small">✅ Kurulu.</p>' : `<p class="muted small">${cfgErr ? esc(cfgErr) : 'Henüz kurulmadı. Bir kez kurman yeterli; sonra sen ve arkadaşların bildirim alabilir.'}</p>`}
      <details class="small"><summary><b>Kurulum için gerekenler</b></summary><ol class="muted" style="padding-left:18px">
        <li>GitHub anahtarına (Bookticker) <b>Workflows: Read and write</b> izni ekle: github.com → Settings → Developer settings → Fine-grained tokens → anahtar → Edit → Permissions → Workflows → Read and write → Update.</li>
        <li>Aşağıdaki düğmeye bas. Ekranda çıkan <b>gizli anahtarı</b> kopyala ve açılan GitHub sayfasında <b>VAPID_PRIVATE_KEY</b> adıyla kaydet (Add secret).</li></ol></details>
      <button class="btn ${cfg ? '' : 'primary'}" id="nt-install" style="margin-top:8px">${cfg ? '🔄 Dosyaları güncelle' : '🔧 Bildirim sistemini kur'}</button>
      ${cfg ? '<button class="mini-btn" id="nt-rekey" style="margin-top:8px;display:block">🔑 Gizli anahtarı yenile</button>' : ''}</div>` : ''}
    ${cfg && !blocked ? `<div class="form-group-title">Bu cihazda</div>
    <div class="form-group">
      <div class="set-row"><span>📖 Okuma hatırlatıcısı</span><select id="nt-hour"><option value="">Kapalı</option>${hours.map(h => `<option value="${h}" ${String(p.remindHour) === String(h) ? 'selected' : ''}>Her gün ${String(h).padStart(2, '0')}:00</option>`).join('')}</select></div>
      ${admin ? `<div class="set-row"><span>💌 Yeni kitap isteği gelince</span><span class="toggle"><input type="checkbox" id="nt-req" ${p.requests !== false ? 'checked' : ''}><span></span></span></div>
      <div class="set-row"><span>💬 Yeni yorum gelince</span><span class="toggle"><input type="checkbox" id="nt-com" ${p.comments !== false ? 'checked' : ''}><span></span></span></div>`
      : `<div class="set-row"><span>📚 Yeni kitap paylaşılınca</span><span class="toggle"><input type="checkbox" id="nt-new" ${p.newBooks !== false ? 'checked' : ''}><span></span></span></div>
      <div class="set-row"><span>💌 İsteğime yanıt gelince</span><span class="toggle"><input type="checkbox" id="nt-req" ${p.requests !== false ? 'checked' : ''}><span></span></span></div>`}
    </div>
    <button class="btn primary block" id="nt-save">${p.on ? '💾 Kaydet' : '🔔 Bildirimleri aç'}</button>
    ${p.on ? '<button class="btn block" id="nt-test" style="margin-top:8px">Deneme bildirimi göster</button><button class="btn block" id="nt-off" style="margin-top:8px;color:var(--danger)">Bu cihazda bildirimleri kapat</button>' : ''}
    <p class="muted small" style="margin-top:10px">Hatırlatıcı birkaç dakika gecikebilir. Bildirimler GitHub üzerinden gönderilir; GitHub'ın ücretsiz kullanım kotası içinde kalır.</p>`
    : !admin && !cfg ? '<div class="section muted small">Bildirimler henüz hazır değil. Kitaplığı paylaşan kişi kurunca buradan açabileceksin.</div>' : ''}`;

  const showKey = r => sheet({
    title: '🔑 Gizli anahtar',
    body: `<p class="small">Bu anahtarı kopyala, sonra <b>GitHub'da aç</b>'a bas. Açılan sayfada <b>Name</b> kutusuna <code>VAPID_PRIVATE_KEY</code>, <b>Secret</b> kutusuna anahtarı yapıştır ve <b>Add secret</b>'a bas.</p>
      <textarea id="nt-key" readonly style="width:100%;min-height:64px;font-family:monospace">${esc(r.privateKey)}</textarea>
      <p class="muted small">Anahtarı kimseyle paylaşma; burada bir daha gösterilmez (gerekirse yenisini üretirsin).</p>`,
    foot: `<button class="btn" id="nt-copy">📋 Kopyala</button><a class="btn primary" href="${esc(r.secretUrl)}" target="_blank" rel="noopener">GitHub'da aç ↗</a>`,
    onMount: el => $('#nt-copy', el).addEventListener('click', async () => { try { await navigator.clipboard.writeText(r.privateKey); toast('📋 Kopyalandı'); } catch { $('#nt-key', el).select(); toast('Seçildi; kopyala'); } }),
  });
  const run = async (btn, fn) => { btn.disabled = true; try { await fn(); } catch (e) { toast(e.message); } btn.disabled = false; };
  $('#nt-install', view)?.addEventListener('click', e => run(e.currentTarget, async () => {
    const r = await P.install();
    if (r.privateKey) showKey(r); else toast('🔄 Bildirim dosyaları güncellendi');
    renderNotify(view);
  }));
  $('#nt-rekey', view)?.addEventListener('click', e => run(e.currentTarget, async () => {
    if (!(await confirmSheet('Gizli anahtarı yenile', 'Yeni anahtar üretilir. Bildirim alan herkesin (arkadaşın dahil) bildirimleri bir kez yeniden açması gerekir.', 'Yenile'))) return;
    showKey(await P.install({ newKeys: true }));
    renderNotify(view);
  }));
  $('#nt-save', view)?.addEventListener('click', e => run(e.currentTarget, async () => {
    const v = id => $(id, view);
    await P.enable({ remindHour: v('#nt-hour').value === '' ? null : Number(v('#nt-hour').value), newBooks: v('#nt-new') ? v('#nt-new').checked : undefined, requests: v('#nt-req') ? v('#nt-req').checked : undefined, comments: v('#nt-com') ? v('#nt-com').checked : undefined });
    toast('🔔 Bildirim ayarların kaydedildi');
    renderNotify(view);
  }));
  $('#nt-test', view)?.addEventListener('click', e => run(e.currentTarget, () => P.testLocal()));
  $('#nt-off', view)?.addEventListener('click', e => run(e.currentTarget, async () => { await P.disable(); toast('Bildirimler kapatıldı'); renderNotify(view); }));
}
