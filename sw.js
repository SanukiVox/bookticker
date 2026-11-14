// Çevrimdışı çalışma: uygulama dosyalarını telefona önbelleğe al.
// Yeni sürüm yayınlarken VERSION değerini artır.
const VERSION = 'v1.17.0';
const IMG_CACHE = 'kitapligim-kapaklar';
const CACHE = `kitapligim-${VERSION}`;
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/db.js', 'js/store.js', 'js/ui.js', 'js/io.js', 'js/sync.js', 'js/lookup.js',
  'js/views/library.js', 'js/views/search.js', 'js/views/detail.js', 'js/views/edit.js',
  'js/views/group.js', 'js/views/reading.js', 'js/views/settings.js', 'js/views/github.js', 'js/views/autofill.js',
  'js/files.js', 'js/views/reader.js', 'js/views/wordpick.js', 'js/views/bookfile.js', 'js/views/cropper.js', 'js/views/ask.js', 'js/similar.js', 'js/ai.js', 'js/views/chat.js', 'js/views/aisettings.js', 'js/booktext.js', 'js/views/sendbook.js', 'vendor/anthropic-sdk.min.mjs',
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
