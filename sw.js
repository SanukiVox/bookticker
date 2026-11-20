// Çevrimdışı çalışma: uygulama dosyalarını telefona önbelleğe al.
// Yeni sürüm yayınlarken VERSION değerini artır.
const VERSION = 'v1.43.2';
const IMG_CACHE = 'kitapligim-kapaklar';
const CACHE = `kitapligim-${VERSION}`;
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/db.js', 'js/store.js', 'js/ui.js', 'js/io.js', 'js/sync.js', 'js/lookup.js',
  'js/views/library.js', 'js/views/search.js', 'js/views/detail.js', 'js/views/edit.js',
  'js/views/group.js', 'js/views/reading.js', 'js/views/settings.js', 'js/views/github.js', 'js/views/autofill.js',
  'js/files.js', 'js/views/reader.js', 'js/views/wordpick.js', 'js/views/vocab.js', 'js/views/highlights.js', 'js/views/finished.js', 'js/views/estimate.js', 'js/views/chapsum.js', 'js/views/upcoming.js', 'js/views/yearreview.js', 'js/filebackup.js', 'js/gdrive.js', 'js/views/drivesettings.js', 'js/views/bookfile.js', 'js/views/cropper.js', 'js/views/ask.js', 'js/similar.js', 'js/ai.js', 'js/views/chat.js', 'js/views/aisettings.js', 'js/booktext.js', 'js/share.js', 'js/views/sharing.js', 'js/push.js', 'js/views/notify.js', 'js/analyze.js', 'js/autoeval.js', 'js/views/sendbook.js', 'vendor/anthropic-sdk.min.mjs',
  'vendor/xlsx.full.min.js', 'vendor/jszip.min.js', 'vendor/epub.min.js',
  'vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs',
  ...['FoxitDingbats.pfb', 'FoxitFixed.pfb', 'FoxitFixedBold.pfb', 'FoxitFixedBoldItalic.pfb', 'FoxitFixedItalic.pfb',
    'FoxitSerif.pfb', 'FoxitSerifBold.pfb', 'FoxitSerifBoldItalic.pfb', 'FoxitSerifItalic.pfb', 'FoxitSymbol.pfb',
    'LiberationSans-Bold.ttf', 'LiberationSans-BoldItalic.ttf', 'LiberationSans-Italic.ttf', 'LiberationSans-Regular.ttf']
    .map(f => `vendor/pdfjs/standard_fonts/${f}`),
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  // cache: 'reload' → dosyalar tarayıcının HTTP önbelleğinden değil, sunucudan alınır.
  // (GitHub Pages 10 dk önbellek başlığı gönderiyor; yoksa yeni sürüme eski dosyalar girebiliyor.)
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('kitapligim-') && k !== CACHE && k !== IMG_CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Önce önbellek (hızlı ve internetsiz), yoksa ağ.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).pathname.endsWith('/users.json') || new URL(req.url).pathname.includes('/push/')) return; // her zaman güncel
  // İnternetten bulunan kapak görsellerini çevrimdışı için sakla.
  if (new URL(req.url).origin !== location.origin) {
    if (req.destination !== 'image') return;
    e.respondWith(caches.open(IMG_CACHE).then(c => c.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }))));
    return;
  }
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match('index.html')))
  );
});

// ---------- Bildirimler (GitHub Actions'tan gelen Web Push) ----------
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Kitaplığım', {
    body: d.body || '', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: d.tag, data: { url: d.url || '#/' },
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '#/', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if ('focus' in c) return c.focus().then(w => (w && 'navigate' in w ? w.navigate(url) : null)).catch(() => null);
    return self.clients.openWindow(url);
  }));
});
