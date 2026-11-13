// Çevrimdışı çalışma: uygulama dosyalarını telefona önbelleğe al.
// Yeni sürüm yayınlarken VERSION değerini artır.
const VERSION = 'v1.0.0';
const CACHE = `kitapligim-${VERSION}`;
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/db.js', 'js/store.js', 'js/ui.js', 'js/io.js',
  'js/views/library.js', 'js/views/search.js', 'js/views/detail.js', 'js/views/edit.js',
  'js/views/group.js', 'js/views/reading.js', 'js/views/settings.js',
  'vendor/xlsx.full.min.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('kitapligim-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Önce önbellek (hızlı ve internetsiz), yoksa ağ.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match('index.html')))
  );
});
