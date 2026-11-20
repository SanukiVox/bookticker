// Uygulamanın giriş noktası: yönlendirme, tema, çevrimdışı çalışma.
import { load, state, onChange } from './store.js';
import { requestPersistence } from './db.js';
import { $, $$, applyTheme, toast } from './ui.js';
import { loadSync, startAutoSync, onSyncChange, onAutoPush, onAutoPull } from './sync.js';
import { renderLibrary } from './views/library.js';
import { renderSearch } from './views/search.js';
import { renderDetail } from './views/detail.js';
import { renderEdit } from './views/edit.js';
import { renderReading } from './views/reading.js';
import { renderSettings, renderOptions } from './views/settings.js';
import { renderAuthor, renderSeries } from './views/group.js';
import { renderReader } from './views/reader.js';
import { renderChat } from './views/chat.js';
import { renderVocab } from './views/vocab.js';
import { renderUpcoming, checkReleases } from './views/upcoming.js';
import { renderYear } from './views/yearreview.js';

const routes = [
  [/^\/?$/, renderLibrary, 'library'],
  [/^\/library\/(books|authors|series)$/, renderLibrary, 'library'],
  [/^\/search$/, renderSearch, 'search'],
  [/^\/book\/([^/]+)$/, renderDetail, 'library'],
  [/^\/edit\/([^/]+)$/, renderEdit, 'add'],
  [/^\/author\/(.+)$/, renderAuthor, 'library'],
  [/^\/series\/(.+)$/, renderSeries, 'library'],
  [/^\/reading$/, renderReading, 'reading'],
  [/^\/settings$/, renderSettings, 'settings'],
  [/^\/options\/([a-z]+)$/, renderOptions, 'settings'],
  [/^\/read\/([^/]+)$/, renderReader, 'read'],
  [/^\/chat$/, renderChat, 'chat'],
  [/^\/vocab(?:\/([^/]+))?$/, renderVocab, 'reading'],
  [/^\/upcoming$/, renderUpcoming, 'reading'],
  [/^\/year(?:\/(\d{4}))?$/, renderYear, 'reading'],
  [/^\/giris$/, async v => (await import('./views/sharing.js')).renderLogin(v), 'settings'],
  [/^\/paylasim$/, async v => (await import('./views/sharing.js')).renderSharingAdmin(v), 'settings'],
];

const scrollMemory = new Map();
let current = null;
let cleanup = null; // açık ekranın kapanırken çalıştıracağı iş (örn. okuyucu)

function parse() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  return { path, query: new URLSearchParams(query), raw };
}

async function route() {
  window.__navCount = (window.__navCount || 0) + 1;
  if (!location.hash.startsWith('#/read/')) window.__lastNonRead = location.hash;
  if (current) scrollMemory.set(current, window.scrollY);
  const { path, query, raw } = parse();
  const view = $('#view');
  for (const [re, fn, tab] of routes) {
    const m = path.match(re);
    if (!m) continue;
    current = raw;
    $$('#tabbar a').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));
    $('#tabbar').classList.toggle('hidden', tab === 'add' || tab === 'read' || tab === 'chat');
    const params = m.slice(1).map(p => (p == null ? p : decodeURIComponent(p)));
    if (cleanup) { const c = cleanup; cleanup = null; try { await c(); } catch { /* yok */ } }
    const ret = await fn(view, params, query);
    if (typeof ret === 'function') cleanup = ret;
    window.scrollTo(0, scrollMemory.get(raw) || 0);
    return;
  }
  location.replace('#/');
}

// Veri değişince açık ekranı yenile (düzenleme ekranı hariç; o kendi durumunu tutar).
let pending = false;
onChange(() => {
  if (pending || parse().path.startsWith('/edit/') || parse().path.startsWith('/read/') || parse().path === '/chat' || (parse().path.startsWith('/vocab') && location.hash.includes('review=1'))) return;
  pending = true;
  requestAnimationFrame(async () => {
    pending = false;
    const y = window.scrollY;
    await route();
    window.scrollTo(0, y);
  });
});

// Eşitleme durumu değişince Ayarlar ekranını yenile.
onSyncChange(() => {
  if (parse().path === '/settings') { const y = window.scrollY; route().then(() => window.scrollTo(0, y)); }
});

async function start() {
  await Promise.all([load(), loadSync(), (async () => { try { await (await import('./db.js')).db.loadFileKeys(); } catch { /* yok */ } })()]);
  // Kullanıcı girişi yapılmışsa: yalnızca paylaşılan kitaplar, salt okunur; eşitleme ve Drive çalışmaz
  const share = await import('./share.js');
  if (share.isGuest()) {
    state.guest = true; document.body.classList.add('guest');
    try { state.books = await share.loadShared(); } catch (e) { state.books = []; toast(`Paylaşılan kitaplar alınamadı: ${e.message}`); }
    applyTheme();
    window.addEventListener('hashchange', () => { const sh = $('#sheet-root'); if (sh.children.length) { sh.replaceChildren(); document.body.style.overflow = ''; } route(); });
    await route();
    return;
  }
  onChange(() => share.schedulePublish());
  // Google Drive girişinden dönüş (#access_token=…): adresi düzelt, anahtarı sakla
  try { await (await import('./gdrive.js')).handleRedirect(); } catch { /* yok */ }
  applyTheme();
  window.addEventListener('hashchange', () => {
    // Sayfa değişince açık panelleri kapat
    const sheets = $('#sheet-root');
    if (sheets.children.length) { sheets.replaceChildren(); document.body.style.overflow = ''; }
    route();
  });
  await route();
  // Google girişinden dönüldüyse yarım kalan Drive indirmesini tamamla, ekranı yenile
  try { if (await (await import('./gdrive.js')).resumeAfterAuth(toast)) await route(); } catch { /* yok */ }
  requestPersistence();
  startAutoSync();
  setTimeout(() => checkReleases().catch(() => {}), 1500);
  // Google Drive: yüklenmemiş dosyaları yükle, öbür cihazdan eklenenleri indir (GitHub çekişinden sonra)
  setTimeout(async () => { try { (await import('./gdrive.js')).startupDrive(toast); } catch { /* yok */ } }, 4000);
  onAutoPush(err => toast(err ? `☁️ GitHub'a gönderilemedi: ${err.message}` : '☁️ GitHub\'a kaydedildi'));
  onAutoPull(async () => {
    toast('☁️ Diğer cihazdaki değişiklikler alındı');
    try { const r = await (await import('./gdrive.js')).syncDrive(); if (r?.down) toast(`☁️ Drive'dan ${r.down} kitap dosyası indirildi`); } catch { /* yok */ }
  });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // Yeni sürüm yayınlanınca uygulama kendini bir kez yeniler (eski sürümde takılı kalmaz).
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading || parse().path.startsWith('/edit/') || parse().path.startsWith('/read/')) return;
      reloading = true;
      location.reload();
    });
    navigator.serviceWorker.register('sw.js').then(reg => {
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch(() => {});
  }
}

start().catch(err => {
  // iPhone Kilit Modu (Lockdown Mode) sitelerin cihazda veri saklamasını (IndexedDB) kapatır
  if (!('indexedDB' in window) || /indexedDB/i.test(String(err?.message || err))) {
    $('#view').innerHTML = `<div class="empty" style="text-align:left"><div class="big" style="text-align:center">🔒</div><h2 style="text-align:center">Kilit Modu açık</h2>
      <p>iPhone'un <b>Kilit Modu</b> bu uygulamanın cihazdaki verilerine (kitaplar, ilerleme, dosyalar) erişimini kapatıyor. Verilerin silinmedi; Kilit Modu'nu kapatmadan bu siteyi istisna yapabilirsin:</p>
      <ol style="padding-left:20px;line-height:1.5"><li><b>Safari</b>'de <b>${location.host}${location.pathname}</b> adresini aç.</li>
      <li>Adres çubuğundaki <b>aA</b> (ya da ☰) düğmesine dokun → <b>Web Sitesi Ayarları</b>.</li>
      <li><b>Kilit Modu</b> anahtarını kapat → <b>Kapat</b> ile onayla.</li>
      <li>Ana ekrandaki uygulamayı tamamen kapatıp yeniden aç.</li></ol>
      <p class="muted small">İstisnaları sonradan Ayarlar → Gizlilik ve Güvenlik → Kilit Modu → Web Taramayı Yapılandır bölümünden görebilirsin. Uygulamayı ana ekrandan silme: cihazdaki veriler (kitap dosyaları dahil) silinir.</p></div>`;
    return;
  }
  $('#view').innerHTML = `<div class="empty"><div class="big">⚠️</div><h2>Uygulama açılamadı</h2><p>${String(err?.message || err)}</p></div>`;
});
