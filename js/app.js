// Uygulamanın giriş noktası: yönlendirme, tema, çevrimdışı çalışma.
import { load, state, onChange } from './store.js';
import { requestPersistence } from './db.js';
import { $, $$, applyTheme, toast } from './ui.js';
import { loadSync, startAutoSync, onSyncChange, onAutoPush, isConfigured, remoteChanged, sync } from './sync.js';
import { renderLibrary } from './views/library.js';
import { renderSearch } from './views/search.js';
import { renderDetail } from './views/detail.js';
import { renderEdit } from './views/edit.js';
import { renderReading } from './views/reading.js';
import { renderSettings, renderOptions } from './views/settings.js';
import { renderAuthor, renderSeries } from './views/group.js';
import { renderReader } from './views/reader.js';

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
  if (current) scrollMemory.set(current, window.scrollY);
  const { path, query, raw } = parse();
  const view = $('#view');
  for (const [re, fn, tab] of routes) {
    const m = path.match(re);
    if (!m) continue;
    current = raw;
    $$('#tabbar a').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));
    $('#tabbar').classList.toggle('hidden', tab === 'add' || tab === 'read');
    const params = m.slice(1).map(decodeURIComponent);
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
  if (pending || parse().path.startsWith('/edit/') || parse().path.startsWith('/read/')) return;
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
  await Promise.all([load(), loadSync()]);
  applyTheme();
  window.addEventListener('hashchange', () => {
    // Sayfa değişince açık panelleri kapat
    const sheets = $('#sheet-root');
    if (sheets.children.length) { sheets.replaceChildren(); document.body.style.overflow = ''; }
    route();
  });
  await route();
  requestPersistence();
  startAutoSync();
  onAutoPush(err => toast(err ? `☁️ GitHub'a gönderilemedi: ${err.message}` : '☁️ GitHub\'a kaydedildi'));
  // Başka bir cihazdan GitHub'a daha yeni veri gönderildiyse haber ver.
  if (isConfigured() && navigator.onLine && !sync.cfg.dirty) {
    remoteChanged().then(changed => { if (changed) toast('☁️ GitHub\'da daha yeni veri var · Ayarlar → GitHub\'dan çek'); }).catch(() => {});
  }
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
  $('#view').innerHTML = `<div class="empty"><div class="big">⚠️</div><h2>Uygulama açılamadı</h2><p>${String(err?.message || err)}</p></div>`;
});
