// Ayarlar ve seçenek listesi düzenleme.
import { state, saveSettings, saveOptions, CRITERIA, OPTION_LISTS, PALETTE, optionUsage, renameOption, replaceAll, saveBooks } from '../store.js';
import { db } from '../db.js';
import { esc, toast, sheet, confirmSheet, promptSheet, $, $$ } from '../ui.js';
import { backButton, wireBack } from './detail.js';
import { applyTheme } from '../ui.js';
import { githubSection, wireGithub } from './github.js';

export const APP_VERSION = '1.14.1';

export async function renderSettings(view) {
  const s = state.settings;
  const lastBackup = s.lastBackup ? new Date(s.lastBackup).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }) : 'hiç alınmadı';
  let storage = '';
  const { filesUsage, formatSize } = await import('../files.js');
  const fu = await filesUsage();
  try {
    const est = await navigator.storage?.estimate?.();
    const persisted = await navigator.storage?.persisted?.();
    if (est) storage = `${(est.usage / 1048576).toFixed(1)} MB kullanılıyor${persisted ? ' · 🔒 kalıcı' : ''}`;
  } catch { /* yok */ }
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;

  view.innerHTML = `
    <div class="page-head"><h1>Ayarlar</h1></div>
    ${!standalone ? `<div class="warn">📲 <span>Uygulama gibi kullanmak için Safari'de <b>Paylaş</b> düğmesine, sonra <b>Ana Ekrana Ekle</b>'ye dokun.</span></div>` : ''}

    <div class="form-group-title">🤖 Asistan (Claude)</div>
    <div class="form-group" id="ai-sec"><div class="set-row muted small">…</div></div>

    <div class="form-group"><button class="set-row" id="guide" style="width:100%;border:0;background:none;text-align:left">📏 Puanlama rehberi<span class="chev"></span></button></div>

    <div class="form-group-title">Kapak ve özetler</div>
    <div class="form-group"><button class="set-row" id="autofill" style="width:100%;border:0;background:none;text-align:left">🖼️ Eksik kapak ve özetleri internetten bul<span class="chev"></span></button>
      <div class="set-row muted small" style="display:block">Tek bir kitap için: kitap sayfası → <b>Düzenle</b> → kapağın altındaki <b>🔍 Bul</b>.</div></div>

    ${githubSection()}

    <div class="form-group-title">Seçenek listelerim</div>
    <div class="form-group">${Object.entries(OPTION_LISTS).map(([k, d]) => `<a class="set-row" href="#/options/${k}"><span>${d.label}</span><span class="muted small" style="margin-left:auto">${state.options[k].length}</span><span class="chev"></span></a>`).join('')}</div>

    <div class="form-group-title">Görünüm</div>
    <div class="form-group">
      <div class="set-row"><span>Tema</span><select id="theme">${[['auto', 'Telefona göre'], ['light', 'Açık'], ['dark', 'Koyu']].map(([v, l]) => `<option value="${v}" ${s.theme === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="set-row"><span>Kapak olarak göster</span><select id="coverpref">${[['tr', 'Türkçe kapak'], ['orig', 'Orijinal kapak']].map(([v, l]) => `<option value="${v}" ${(s.coverPref || 'tr') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="set-row"><span>Orijinal adları göster</span><span class="toggle"><input type="checkbox" id="showorig" ${s.showOriginal !== false ? 'checked' : ''}><span></span></span></div>
      <div class="set-row"><span>Kitap görünümü</span><select id="viewmode">${[['grid', 'Kapaklar'], ['list', 'Liste']].map(([v, l]) => `<option value="${v}" ${s.view === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="set-row"><span>${new Date().getFullYear()} okuma hedefi</span><input type="number" id="goal" inputmode="numeric" min="0" value="${esc(s.yearlyGoal)}"></div>
    </div>

    <div class="form-group-title">Genel uyum puanı ağırlıkları</div>
    <div class="form-group">${CRITERIA.map(c => `<div class="set-row"><span>${c.label}</span><input type="number" inputmode="numeric" min="0" data-w="${c.key}" value="${esc(s.weights[c.key])}"></div>`).join('')}
      <div class="set-row muted small">Toplam: <b id="wsum">${CRITERIA.reduce((t, c) => t + (Number(s.weights[c.key]) || 0), 0)}</b> · Boş kriterler hesaba katılmaz.</div></div>

    ${(s.savedFilters || []).length ? `<div class="form-group-title">Kayıtlı filtreler</div><div class="form-group">${s.savedFilters.map((f, i) => `<div class="opt-item"><span class="lbl">⭐ ${esc(f.name)}</span><button class="del" data-delf="${i}" aria-label="Sil">🗑</button></div>`).join('')}</div>` : ''}

    <div class="form-group-title">Verilerim</div>
    <div class="form-group">
      <label class="set-row" style="position:relative">📥 Excel'den içe aktar<span class="chev"></span><input type="file" id="imp" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style="position:absolute;inset:0;opacity:0"></label>
      <button class="set-row" id="exp" style="width:100%;border:0;background:none;text-align:left">📤 Excel'e aktar<span class="chev"></span></button>
      <button class="set-row" id="bak" style="width:100%;border:0;background:none;text-align:left">💾 Yedek al (kapaklar dahil)<span class="chev"></span></button>
      <label class="set-row" style="position:relative">♻️ Yedekten geri yükle<span class="chev"></span><input type="file" id="res" accept=".json,application/json" style="position:absolute;inset:0;opacity:0"></label>
      <div class="set-row muted small" style="display:block">Son yedek: ${lastBackup}${storage ? `<br>${storage}` : ''}${fu.count ? `<br>📄 Kitap dosyaları: ${fu.count} dosya · ${formatSize(fu.bytes)} (sadece bu telefonda; yedeğe ve GitHub'a dahil değil)` : ''}<br>Veriler yalnızca bu telefonda saklanır. Ara sıra yedek alıp Dosyalar'a ya da iCloud Drive'a kaydetmeni öneririm.</div>
    </div>

    <div class="form-group"><button class="set-row" id="wipe" style="width:100%;border:0;background:none;color:var(--danger)">Tüm verileri sil</button></div>
    <p class="muted small" style="text-align:center">Kitaplığım ${APP_VERSION} · ${state.books.length} kitap<br><button class="mini-btn" id="check-upd" style="margin-top:8px">🔄 Güncellemeleri denetle</button></p>`;

  wireGithub(view);
  $('#guide', view).addEventListener('click', async () => (await import('../ui.js')).openGuide());
  (await import('./aisettings.js')).fillAiSection(view);
  $('#check-upd', view)?.addEventListener('click', () => checkForUpdate());
  $('#autofill', view).addEventListener('click', async () => (await import('./autofill.js')).openAutofill());
  $('#theme', view).addEventListener('change', async e => { s.theme = e.target.value; applyTheme(); await saveSettings(); });
  $('#coverpref', view).addEventListener('change', async e => { s.coverPref = e.target.value; await saveSettings(); toast(e.target.value === 'orig' ? 'Orijinal kapaklar gösterilecek' : 'Türkçe kapaklar gösterilecek'); });
  $('#showorig', view).addEventListener('change', async e => { s.showOriginal = e.target.checked; await saveSettings(); });
  $('#viewmode', view).addEventListener('change', async e => { s.view = e.target.value; await saveSettings(); });
  $('#goal', view).addEventListener('change', async e => { s.yearlyGoal = Number(e.target.value) || 0; await saveSettings(); toast('Hedef kaydedildi'); });
  $$('[data-w]', view).forEach(inp => inp.addEventListener('change', async () => {
    s.weights[inp.dataset.w] = Number(inp.value) || 0;
    await saveSettings();
    toast('Puanlar yeniden hesaplandı');
  }));
  $$('[data-delf]', view).forEach(b => b.addEventListener('click', async () => {
    s.savedFilters.splice(Number(b.dataset.delf), 1);
    await saveSettings();
  }));

  $('#imp', view).addEventListener('change', async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const { readExcel, importExcel } = await import('../io.js');
    toast('Excel okunuyor…');
    let parsed;
    try { parsed = await readExcel(file); } catch (err) { toast(err.message); return; }
    sheet({
      title: 'Excel\'den içe aktar',
      body: `<p><b>${parsed.books.length}</b> kitap bulundu${parsed.weights ? ', puan ağırlıkları' : ''}${parsed.rules ? ' ve okuma kuralları' : ''} da okunacak.</p>
        ${state.books.length ? `<p class="muted small">Şu an kitaplığında ${state.books.length} kitap var.</p>` : ''}`,
      foot: state.books.length
        ? '<button class="btn" data-mode="merge">Ekle (aynıları atla)</button><button class="btn primary" data-mode="replace" style="background:var(--danger)">Tümünü değiştir</button>'
        : '<button class="btn" data-close>Vazgeç</button><button class="btn primary" data-mode="replace">İçe aktar</button>',
      onMount: (el, close) => $$('[data-mode]', el).forEach(b => b.addEventListener('click', async () => {
        if (b.dataset.mode === 'replace' && state.books.length && !(await confirmSheet('Emin misin?', 'Mevcut bütün kitapların ve kapakların silinip Excel\'deki liste yüklenecek.', 'Değiştir'))) return;
        close();
        const r = await importExcel(parsed, b.dataset.mode);
        toast(`${r.added} kitap aktarıldı${r.skipped ? `, ${r.skipped} tekrar atlandı` : ''}`);
        location.hash = '#/';
      })),
    });
  });
  $('#exp', view).addEventListener('click', async () => {
    const { exportExcel } = await import('../io.js');
    try { await exportExcel(); } catch (err) { toast(err.message); }
  });
  $('#bak', view).addEventListener('click', async () => {
    const { backup } = await import('../io.js');
    try { await backup(); toast('Yedek hazır'); } catch (err) { toast(err.message); }
  });
  $('#res', view).addEventListener('change', async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!(await confirmSheet('Yedekten geri yükle', 'Şu anki bütün veriler yedektekilerle değiştirilecek.', 'Geri yükle'))) return;
    const { restore } = await import('../io.js');
    try { const n = await restore(file); applyTheme(); toast(`${n} kitap geri yüklendi`); location.hash = '#/'; } catch (err) { toast(err.message); }
  });
  $('#wipe', view).addEventListener('click', async () => {
    if (!(await confirmSheet('Tüm verileri sil', 'Bütün kitaplar, kapaklar, kitap dosyaları ve notlar bu telefondan silinecek. Bu işlem geri alınamaz.', 'Hepsini sil'))) return;
    await db.clearCovers();
    await db.clearFiles();
    await replaceAll([]);
    toast('Tüm veriler silindi');
  });
}

// ---------- Seçenek listesi düzenleme ----------
export async function renderOptions(view, [key]) {
  const def = OPTION_LISTS[key];
  if (!def) { location.replace('#/settings'); return; }
  const list = state.options[key];
  view.innerHTML = `
    <div class="topbar">${backButton('#/settings')}<div class="title">${def.label}</div><button class="icon-btn" id="add">＋ Ekle</button></div>
    <p class="muted small" style="margin:4px 2px 12px">Kitap eklerken bu seçenekler listelenir. Adını değiştirirsen o seçeneği kullanan kitaplar da güncellenir.</p>
    ${list.length ? `<div class="form-group">${list.map((o, i) => `
      <div class="opt-item">
        ${def.hasColor ? `<button class="dot" data-color="${i}" style="background:${o.color || '#6b6370'};width:22px;height:22px;flex:0 0 22px;padding:0" aria-label="Renk"></button>` : ''}
        ${def.hasEmoji ? `<button data-emoji="${i}" style="font-size:20px" aria-label="Simge">${o.emoji || '•'}</button>` : ''}
        <span class="lbl">${esc(o.name)}</span><span class="count">${optionUsage(key, o.name)}</span>
        <button data-up="${i}" ${i === 0 ? 'disabled style="opacity:.25"' : ''} aria-label="Yukarı">↑</button>
        <button data-ren="${i}" aria-label="Yeniden adlandır">✎</button>
        <button class="del" data-del="${i}" aria-label="Sil">🗑</button>
      </div>`).join('')}</div>` : '<div class="empty">Henüz seçenek yok. ＋ Ekle ile ekleyebilirsin.</div>'}
    ${key === 'statuses' ? '<p class="muted small">Not: "Okundu", "Okunuyor" ve "Okunacak" adları öneri ve istatistiklerde kullanılır; bunların adını değiştirmemeni öneririm.</p>' : ''}`;
  wireBack(view);

  const rerender = () => renderOptions(view, [key]);
  $('#add', view).addEventListener('click', async () => {
    const name = await promptSheet(`Yeni: ${def.label}`);
    if (!name) return;
    if (list.some(o => o.name === name)) { toast('Bu seçenek zaten var'); return; }
    list.push(def.hasColor ? { name, color: PALETTE[list.length % PALETTE.length], ...(def.hasEmoji ? { emoji: '•' } : {}) } : { name });
    await saveOptions(); rerender();
  });
  $$('[data-ren]', view).forEach(b => b.addEventListener('click', async () => {
    const o = list[Number(b.dataset.ren)];
    const name = await promptSheet('Yeniden adlandır', { value: o.name });
    if (!name || name === o.name) return;
    if (list.some(x => x.name === name)) { toast('Bu ad zaten var'); return; }
    const n = await renameOption(key, o.name, name);
    toast(n ? `${n} kitap güncellendi` : 'Güncellendi'); rerender();
  }));
  $$('[data-del]', view).forEach(b => b.addEventListener('click', async () => {
    const i = Number(b.dataset.del), o = list[i];
    const used = optionUsage(key, o.name);
    if (!(await confirmSheet('Seçeneği sil', used ? `"${o.name}" ${used} kitapta kullanılıyor. Silersen bu kitaplardan da kaldırılır.` : `"${o.name}" silinsin mi?`, 'Sil'))) return;
    if (used) {
      const field = def.field;
      const changed = state.books.filter(x => (def.multi ? (x[field] || []).includes(o.name) : x[field] === o.name));
      changed.forEach(x => { if (def.multi) x[field] = x[field].filter(v => v !== o.name); else x[field] = ''; });
      await saveBooks(changed);
    }
    list.splice(i, 1);
    await saveOptions(); rerender();
  }));
  $$('[data-up]', view).forEach(b => b.addEventListener('click', async () => {
    const i = Number(b.dataset.up);
    if (i < 1) return;
    [list[i - 1], list[i]] = [list[i], list[i - 1]];
    await saveOptions(); rerender();
  }));
  $$('[data-color]', view).forEach(b => b.addEventListener('click', () => {
    const o = list[Number(b.dataset.color)];
    sheet({
      title: `Renk: ${o.name}`,
      body: `<div class="color-pick">${PALETTE.concat(['#3d2b3d', '#5b6b3a', '#2f7d4f']).map(c => `<button data-c="${c}" class="${o.color === c ? 'on' : ''}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div>`,
      onMount: (el, close) => $$('[data-c]', el).forEach(x => x.addEventListener('click', async () => { o.color = x.dataset.c; close(); await saveOptions(); rerender(); })),
    });
  }));
  $$('[data-emoji]', view).forEach(b => b.addEventListener('click', async () => {
    const o = list[Number(b.dataset.emoji)];
    const e = await promptSheet('Simge (emoji)', { value: o.emoji || '', placeholder: 'Örn. 📖' });
    if (!e) return;
    o.emoji = e.trim();
    await saveOptions(); rerender();
  }));
}

// Sunucudaki sürümü doğrudan oku; yeniyse güncelle, olmazsa uygulama dosyalarını temizleyip yeniden yükle.
// Kitaplar, kapaklar, dosyalar ve ayarlar IndexedDB'de durur; bu işlem onlara dokunmaz.
async function checkForUpdate() {
  if (!navigator.onLine) { toast('İnternet bağlantısı gerekiyor'); return; }
  toast('Denetleniyor…');
  let remote = null;
  try {
    const txt = await (await fetch(`sw.js?t=${Date.now()}`, { cache: 'no-store' })).text();
    remote = (txt.match(/const VERSION = 'v([\d.]+)'/) || [])[1] || null;
  } catch { toast('Sunucuya ulaşılamadı'); return; }
  if (!remote || remote === APP_VERSION) { toast(`En güncel sürümdesin (${APP_VERSION})`); return; }
  toast(`Yeni sürüm ${remote} bulundu, yükleniyor…`);
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
  } catch { /* aşağıdaki yedek yol çalışır */ }
  // Normal yol birkaç saniyede sayfayı yeniler; yenilemezse zorla güncelle.
  setTimeout(async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k.startsWith('kitapligim-v')).map(k => caches.delete(k)));
      const regs = await navigator.serviceWorker?.getRegistrations?.() || [];
      await Promise.all(regs.map(r => r.unregister()));
    } catch { /* yok */ }
    location.reload();
  }, 6000);
}
