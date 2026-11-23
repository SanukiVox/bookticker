// Sesli kitap: ses dosyaları yalnızca bu cihazda (IndexedDB 'files' deposu, anahtar 'a-…') saklanır.
// Kitapta bilgisi tutulur ve GitHub ile eşitlenir:
//   b.audio    = { tracks: [{ key, name, size, dur, type }], addedAt }   (birden çok dosya = bölümler)
//   b.audioPos = { t: parça sırası, s: saniye, percent, rate, updatedAt } (eşitlemede en yenisi kazanır)
//   b.listenSeconds = toplam dinleme süresi (okuma süresine de eklenir)
// Oynatıcı tektir ve sayfalar arasında gezinirken çalmaya devam eder (alt çubukta küçük oynatıcı).
import { state, saveBook, getBook, displayTitle, collator } from './store.js';
import { db } from './db.js';
import { addReadingTime, saveReadLog } from './files.js';

export const AUDIO_ACCEPT = 'audio/*,.mp3,.m4a,.m4b,.aac,.ogg,.oga,.opus,.wav,.flac';
const isAudio = f => /^audio\//.test(f.type || '') || /\.(mp3|m4a|m4b|aac|ogg|oga|opus|wav|flac)$/i.test(f.name || '');
const MIME = { mp3: 'audio/mpeg', m4a: 'audio/mp4', m4b: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac' };
const extOf = n => (n.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();

// Büyük ses dosyalarının tamamını belleğe almamak için kimlik: baş + son 256 KB + boyut
async function quickKey(file) {
  const part = 256 * 1024;
  const head = new Uint8Array(await file.slice(0, part).arrayBuffer());
  const tail = new Uint8Array(await file.slice(Math.max(0, file.size - part)).arrayBuffer());
  const size = new TextEncoder().encode(`|${file.size}|`);
  const all = new Uint8Array(head.length + tail.length + size.length);
  all.set(head); all.set(size, head.length); all.set(tail, head.length + size.length);
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', all));
  return 'a-' + [...h].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

function probeDuration(blob) {
  return new Promise(res => {
    const a = document.createElement('audio');
    const u = URL.createObjectURL(blob);
    let done = false;
    const fin = d => { if (done) return; done = true; URL.revokeObjectURL(u); a.removeAttribute('src'); res(Number.isFinite(d) && d > 0 ? Math.round(d) : 0); };
    a.preload = 'metadata';
    a.onloadedmetadata = () => fin(a.duration);
    a.onerror = () => fin(0);
    setTimeout(() => fin(0), 2500); // iPhone çalmadan süre vermeyebilir; süre ilk çalışta öğrenilir
    a.src = u;
  });
}

// ---------- Saklama ----------
// iPhone (Safari), dosya seçiciden gelen dosyayı IndexedDB'ye doğrudan koyunca sonradan okuyamayabiliyor
// ("WebKitBlobResource" hatası). Bu yüzden ses dosyası 8 MB'lık parçalar hâlinde kopyalanarak saklanır:
//   key → { audioChunks: n, type, size } · key#0 … key#(n-1) → parçalar. Bellekte aynı anda tek parça tutulur.
const CHUNK = 8 * 1024 * 1024;
export function chunkWriter(key, type) {
  let i = 0, buf = [], len = 0, size = 0;
  const flush = async () => {
    if (!len) return;
    await db.putFile(`${key}#${i++}`, new Blob(buf, { type }));
    buf = []; len = 0;
  };
  return {
    async write(u8) { buf.push(u8); len += u8.byteLength; size += u8.byteLength; if (len >= CHUNK) await flush(); },
    async close() { await flush(); await db.putFile(key, { audioChunks: i, type, size }); },
  };
}
async function putAudioFile(key, file, type) {
  const w = chunkWriter(key, type);
  for (let o = 0; o < file.size; o += CHUNK) await w.write(new Uint8Array(await file.slice(o, o + CHUNK).arrayBuffer()));
  await w.close();
}
export async function getAudioBlob(key, type) {
  const v = await db.getFile(key);
  if (!v) return null;
  if (v.audioChunks != null) {
    const parts = [];
    for (let i = 0; i < v.audioChunks; i++) { const p = await db.getFile(`${key}#${i}`); if (!p) return null; parts.push(p); }
    return new Blob(parts, { type: type || v.type || 'audio/mpeg' });
  }
  if (v instanceof Blob) { // eski sürümde doğrudan saklanmış: okunabiliyor mu?
    try { await v.slice(0, 16).arrayBuffer(); return v; } catch { return null; }
  }
  return null;
}
export async function deleteAudioBlob(key) {
  const v = await db.getFile(key);
  if (v?.audioChunks != null) for (let i = 0; i < v.audioChunks; i++) await db.deleteFile(`${key}#${i}`);
  await db.deleteFile(key);
}

const tracksOf = b => b?.audio?.tracks || [];
export const hasAudio = b => tracksOf(b).length > 0;
export const audioTotal = b => tracksOf(b).reduce((t, x) => t + (x.dur || 0), 0);

// Bu cihazdaki durum: 'local' | 'partial' (bazı parçalar eksik) | 'missing' | null (sesli kitap yok)
export function audioWhere(b) {
  const tr = tracksOf(b);
  if (!tr.length) return null;
  const keys = db.fileKeysSync();
  if (!keys) return 'local';
  const miss = tr.filter(x => !keys.has(x.key));
  if (!miss.length) return 'local';
  if (miss.every(x => x.driveId)) return 'drive';
  return miss.length < tr.length ? 'partial' : 'missing';
}

// Dosyaları ekle. replace: true → eskilerin yerine; false → sona ekle (yeni bölümler)
export async function attachAudio(book, files, { replace = true, onProgress } = {}) {
  const list = [...files].filter(isAudio).sort((a, b) => collator.compare(a.name, b.name));
  if (!list.length) throw new Error('Ses dosyası seçilmedi (MP3, M4A, M4B, AAC, OGG, WAV…)');
  const old = tracksOf(book);
  const tracks = [];
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    onProgress?.(i, list.length, f.name);
    const key = await quickKey(f);
    // iPhone dosyalara bazen boş ya da tanımadığı tür verir (ör. audio/x-m4b): uzantıya göre bilinen türü kullan
    const type = MIME[extOf(f.name)] || (/^audio\//.test(f.type) ? f.type : 'audio/mpeg');
    const blob = f.type === type ? f : new Blob([f], { type });
    await putAudioFile(key, f, type);
    const prev = old.find(x => x.key === key);
    tracks.push({ key, name: f.name, size: f.size, dur: prev?.dur || (await probeDuration(blob)), type, ...(prev?.driveId ? { driveId: prev.driveId } : {}) });
  }
  let next;
  if (replace) {
    next = tracks;
    const sameStart = old[0] && next[0] && old[0].key === next[0].key;
    for (const x of old) if (!next.some(y => y.key === x.key) && !usedElsewhere(x.key, book.id)) await deleteAudioBlob(x.key);
    if (!sameStart) book.audioPos = null;
  } else {
    next = [...old];
    for (const x of tracks) if (!next.some(y => y.key === x.key)) next.push(x);
  }
  book.audio = { tracks: next, addedAt: Date.now(), ...(book.audio?.driveFolder ? { driveFolder: book.audio.driveFolder } : {}) };
  await saveBook(book);
  // Drive bağlıysa arka planda "Kitaplığım - Sesli Kitaplar" klasörüne yükle
  import('./gdrive.js').then(m => m.syncDrive({ download: false })).catch(() => {});
  if (P.book?.id === book.id) { P.book = book; emit(); }
  return next.length;
}

const usedElsewhere = (key, id) => state.books.some(b => b.id !== id && tracksOf(b).some(x => x.key === key));

export async function removeAudio(book) {
  if (P.book?.id === book.id) stop();
  for (const x of tracksOf(book)) if (!usedElsewhere(x.key, book.id)) await deleteAudioBlob(x.key);
  book.audio = null;
  await saveBook(book);
}

export async function removeTrack(book, i) {
  const tr = tracksOf(book);
  const x = tr[i];
  if (!x) return;
  if (P.book?.id === book.id) stop();
  if (!usedElsewhere(x.key, book.id)) await deleteAudioBlob(x.key);
  tr.splice(i, 1);
  book.audio = tr.length ? { ...book.audio, tracks: tr } : null;
  if (book.audioPos && book.audioPos.t >= tr.length) book.audioPos = null;
  await saveBook(book);
}

export async function moveTrack(book, i, d) {
  const tr = tracksOf(book), j = i + d;
  if (j < 0 || j >= tr.length) return;
  [tr[i], tr[j]] = [tr[j], tr[i]];
  book.audio = { ...book.audio, tracks: tr };
  await saveBook(book);
}

// Yüzde: önceki parçaların süresi + bu parçadaki konum (süreler bilinmiyorsa parça sırasına göre)
export function percentAt(b, t, s) {
  const tr = tracksOf(b);
  if (!tr.length) return 0;
  const total = audioTotal(b);
  if (total > 0 && tr.every(x => x.dur)) {
    const before = tr.slice(0, t).reduce((a, x) => a + x.dur, 0);
    return Math.min(100, ((before + s) / total) * 100);
  }
  const d = tr[t]?.dur || 0;
  return Math.min(100, ((t + (d ? s / d : 0)) / tr.length) * 100);
}
export const audioPercent = b => (b?.audioPos ? b.audioPos.percent ?? percentAt(b, b.audioPos.t || 0, b.audioPos.s || 0) : null);

export function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

// ---------- Oynatıcı ----------
export const RATES = [0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5];
const P = { el: null, book: null, idx: 0, url: null, lastWall: 0, acc: 0, lastSave: 0, sleepAt: 0, sleepEnd: false, sleepTimer: null, error: '' };
const listeners = new Set();
export const onPlayer = fn => { listeners.add(fn); return () => listeners.delete(fn); };
function emit() { listeners.forEach(f => { try { f(); } catch { /* yok */ } }); }

export const player = {
  get book() { return P.book; },
  get idx() { return P.idx; },
  get playing() { return !!P.el && !P.el.paused && !P.el.ended; },
  get time() { return P.el?.currentTime || 0; },
  get duration() { const d = P.el?.duration; return Number.isFinite(d) ? d : (tracksOf(P.book)[P.idx]?.dur || 0); },
  get rate() { return P.el?.playbackRate || rateFor(P.book); },
  get sleep() { return P.sleepEnd ? 'end' : P.sleepAt ? Math.max(0, P.sleepAt - Date.now()) : 0; },
  get error() { return P.error; },
};
const rateFor = b => b?.audioPos?.rate || state.settings.audioRate || 1;

function el() {
  if (P.el) return P.el;
  const a = P.el = document.createElement('audio');
  a.preload = 'auto';
  a.setAttribute('playsinline', '');
  a.style.display = 'none';
  document.body.appendChild(a);
  a.addEventListener('timeupdate', tick);
  a.addEventListener('play', () => { P.lastWall = Date.now(); P.error = ''; mediaState(); emit(); });
  a.addEventListener('pause', () => { tick(); save(true); mediaState(); emit(); });
  a.addEventListener('loadedmetadata', () => {
    applySeek();
    a.playbackRate = a.defaultPlaybackRate = rateFor(P.book);
    const t = tracksOf(P.book)[P.idx];
    if (t && Number.isFinite(a.duration) && Math.round(a.duration) !== t.dur) { t.dur = Math.round(a.duration); }
    mediaState(); emit();
  });
  a.addEventListener('ended', async () => {
    if (P.sleepEnd) { P.sleepEnd = false; save(true); emit(); return; }
    if (P.idx + 1 < tracksOf(P.book).length) await open(P.book, P.idx + 1, 0, true);
    else { save(true, true); emit(); }
  });
  a.addEventListener('error', () => {
    if (!P.book || !a.src || a.src !== P.url) return; // kilit açma sesi ya da eski kaynak
    const c = a.error?.code;
    P.error = c === 4 ? 'Bu ses dosyası bu cihazda çalınamıyor (biçim desteklenmiyor). MP3 ya da M4A/M4B dene.'
      : `Ses dosyası açılamadı (hata ${c || '?'}${a.error?.message ? `: ${a.error.message}` : ''})`;
    emit();
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && P.book) save(true); });
  setupMediaSession();
  return a;
}

// Dinleme süresi: çalarken geçen gerçek zaman (hız ne olursa olsun), uzun aralar sayılmaz
function tick() {
  const a = P.el;
  if (!a || !P.book) return;
  const now = Date.now();
  if (!a.paused && P.lastWall) { const d = (now - P.lastWall) / 1000; if (d > 0 && d < 30) P.acc += d; }
  P.lastWall = a.paused ? 0 : now;
  if (now - P.lastSave > 15000) save(false);
  if (P.sleepAt && now >= P.sleepAt) { P.sleepAt = 0; a.pause(); }
  if (!a.paused && now - (P.lastPos || 0) > 5000) { P.lastPos = now; mediaState(); }
  emit();
}

// full: saveBook (eşitleme + ekran yenileme); değilse yalnızca bu cihaza yaz
async function save(full, finished = false) {
  const b = P.book, a = P.el;
  if (!b || !a) return;
  P.lastSave = Date.now();
  const s = finished ? (tracksOf(b)[P.idx]?.dur || a.currentTime) : a.currentTime;
  b.audioPos = { t: P.idx, s: Math.round(s * 10) / 10, percent: finished ? 100 : percentAt(b, P.idx, s), rate: a.playbackRate, updatedAt: Date.now() };
  const secs = Math.floor(P.acc);
  if (secs > 0) { P.acc -= secs; b.listenSeconds = (b.listenSeconds || 0) + secs; addReadingTime(b, secs); }
  if (full) { await saveBook(b); if (secs) saveReadLog(); }
  else await db.putBook(b);
}

// iPhone: ses yalnızca dokunuşla başlatılabilir. Dokunuşun hemen başında (await'ten önce) çağrılır;
// öğe bir kez dokunuşla çalınınca sonraki çalmalara (dosya yüklendikten sonra) izin verilir.
export function unlock() {
  const a = el();
  if (P.unlocked || a.src) return;
  P.unlocked = true;
  const n = 800, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  a.src = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  a.play().catch(() => {});
}

export async function open(b, idx = 0, time = 0, autoplay = true) {
  const a = el();
  const tr = tracksOf(b);
  if (!tr.length) throw new Error('Bu kitabın sesli kitabı yok');
  idx = Math.max(0, Math.min(tr.length - 1, idx));
  if (P.book && (P.book.id !== b.id || P.idx !== idx)) { tick(); await save(P.book.id !== b.id); }
  let blob = await getAudioBlob(tr[idx].key);
  if (!blob && db.fileKeysSync()?.has(tr[idx].key) && !tr[idx].driveId) throw new Error(`"${tr[idx].name}" bu cihazda okunamıyor (eski sürümle eklenmiş). Kitap sayfasında "Değiştir" ile dosyayı yeniden ekle.`);
  if (!blob && tr[idx].driveId) { // bu bölüm yalnız Drive'da: önce onu indir
    const gd = await import('./gdrive.js');
    P.error = '☁️ Bölüm Drive\'dan indiriliyor…'; emit();
    try { await gd.downloadAudio(b, { only: idx, onProgress: f => { P.error = `☁️ Bölüm Drive'dan indiriliyor… %${Math.round(f * 100)}`; emit(); } }); }
    catch (e) { P.error = ''; emit(); throw new Error(/yenilenmeli/.test(e.message) ? 'Drive bağlantısı yenilenmeli: kitap sayfasındaki "Drive\'dan indir" düğmesini kullan' : e.message); }
    P.error = ''; blob = await getAudioBlob(tr[idx].key);
  }
  if (!blob) throw new Error(`"${tr[idx].name}" bu cihazda yok; dosyayı yeniden ekle`);
  // Eski kayıtlarda tür yanlış/boş olabilir: iPhone türü bilinmeyen sesi çalmaz
  const type = MIME[extOf(tr[idx].name)] || (/^audio\//.test(blob.type) ? blob.type : 'audio/mpeg');
  if (blob.type !== type) blob = new Blob([blob], { type });
  if (P.url) URL.revokeObjectURL(P.url);
  P.url = URL.createObjectURL(blob);
  P.book = b; P.idx = idx; P.error = '';
  // iPhone ses bilgisini (süre vb.) çalmaya başlamadan yüklemez: önce çal, konuma bilgi gelince git
  P.pendingSeek = time > 0 ? time : 0;
  a.src = P.url;
  a.load();
  a.playbackRate = a.defaultPlaybackRate = rateFor(b);
  setMetadata();
  if (autoplay) await play();
  else await new Promise(res => { const go = () => { a.removeEventListener('loadedmetadata', go); res(); }; a.addEventListener('loadedmetadata', go); setTimeout(go, 3000); });
  applySeek();
  emit();
}

// Bekleyen konuma git (süre bilgisi geldiyse)
function applySeek() {
  const a = P.el, t = P.pendingSeek;
  if (!a || !t || !(a.readyState >= 1)) return;
  P.pendingSeek = 0;
  try { a.currentTime = Number.isFinite(a.duration) ? Math.min(t, a.duration - 1) : t; } catch { /* yok */ }
}

// Kitabı kaldığı yerden aç (ya da zaten açıksa çal/durdur)
export async function resume(b, autoplay = true) {
  if (P.book?.id === b.id && P.el?.src) { if (autoplay) await play(); return; }
  const p = b.audioPos || {};
  const tr = tracksOf(b);
  let t = p.t || 0, s = p.s || 0;
  if (p.percent >= 100 || t >= tr.length) { t = 0; s = 0; }
  await open(b, t, Math.max(0, s - 3), autoplay);
}

export async function play() {
  if (!P.el) return;
  try {
    const pr = P.el.play();
    P.el.playbackRate = P.el.defaultPlaybackRate = rateFor(P.book);
    await pr;
    P.error = '';
    const b = P.book;
    if (b && !state.guest && b.status !== 'Okunuyor' && b.status !== 'Okundu') { b.status = 'Okunuyor'; saveBook(b); }
    else if (b && state.guest && b.status !== 'Okunuyor' && b.status !== 'Okundu') { b.status = 'Okunuyor'; saveBook(b); }
  } catch (e) {
    if (e?.name === 'AbortError') return;
    P.error = e?.name === 'NotAllowedError' ? 'Çalmak için ▶️ düğmesine bir kez daha dokun' : `Ses başlatılamadı: ${e?.message || e?.name || 'bilinmeyen hata'}`;
    emit();
  }
}
export const pause = () => P.el?.pause();
export const toggle = () => (player.playing ? pause() : play());
export function seek(delta) {
  const a = P.el;
  if (!a) return;
  const t = a.currentTime + delta;
  if (t < 0 && P.idx > 0) { const prev = tracksOf(P.book)[P.idx - 1]; open(P.book, P.idx - 1, Math.max(0, (prev.dur || 0) + t), !a.paused); return; }
  if (Number.isFinite(a.duration) && t > a.duration && P.idx + 1 < tracksOf(P.book).length) { open(P.book, P.idx + 1, t - a.duration, !a.paused); return; }
  a.currentTime = Math.max(0, Math.min(t, (a.duration || t) - 0.5));
  tick();
}
export function seekTo(sec) { if (P.el) { P.el.currentTime = Math.max(0, sec); tick(); } }
export const next = () => P.book && P.idx + 1 < tracksOf(P.book).length && open(P.book, P.idx + 1, 0, player.playing || true);
export function prev() {
  if (!P.book) return;
  if (P.el.currentTime > 5 || P.idx === 0) { seekTo(0); return; }
  open(P.book, P.idx - 1, 0, player.playing);
}
export async function setRate(r) {
  if (P.el) { P.el.playbackRate = r; P.el.defaultPlaybackRate = r; }
  state.settings.audioRate = r;
  (await import('./store.js')).saveSettings();
  if (P.book) save(false);
  emit();
}
// Uyku zamanlayıcısı: dakika (0 = kapalı) ya da 'end' (bu bölüm bitince)
export function setSleep(v) {
  P.sleepEnd = v === 'end';
  P.sleepAt = typeof v === 'number' && v > 0 ? Date.now() + v * 60000 : 0;
  clearTimeout(P.sleepTimer);
  if (P.sleepAt) P.sleepTimer = setTimeout(() => { if (P.sleepAt && Date.now() >= P.sleepAt - 500) { P.sleepAt = 0; pause(); emit(); } }, v * 60000 + 200);
  emit();
}
export async function stop() {
  if (!P.el) return;
  P.el.pause();
  await save(true);
  P.el.removeAttribute('src'); P.el.load();
  if (P.url) URL.revokeObjectURL(P.url);
  P.url = null; P.book = null; P.idx = 0; P.sleepAt = 0; P.sleepEnd = false;
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
  emit();
}

// ---------- Kilit ekranı / kulaklık düğmeleri ----------
function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  const h = (k, f) => { try { ms.setActionHandler(k, f); } catch { /* desteklenmiyor */ } };
  h('play', () => play());
  h('pause', () => pause());
  h('seekbackward', d => seek(-(d?.seekOffset || 15)));
  h('seekforward', d => seek(d?.seekOffset || 30));
  h('previoustrack', () => prev());
  h('nexttrack', () => next());
  h('seekto', d => { if (d?.seekTime != null) seekTo(d.seekTime); });
}
function setMetadata() {
  if (!('mediaSession' in navigator) || !P.book) return;
  const b = P.book, t = tracksOf(b)[P.idx];
  const art = [b.coverTr, b.coverOrig].find(u => /^https?:/.test(u || ''));
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: displayTitle(b), artist: b.author || '', album: tracksOf(b).length > 1 ? `${P.idx + 1}/${tracksOf(b).length} · ${t?.name || ''}` : 'Sesli kitap',
      artwork: art ? [{ src: art, sizes: '512x512', type: 'image/jpeg' }] : [],
    });
  } catch { /* yok */ }
}
function mediaState() {
  if (!('mediaSession' in navigator) || !P.el) return;
  navigator.mediaSession.playbackState = P.el.paused ? 'paused' : 'playing';
  const d = P.el.duration;
  try { if (Number.isFinite(d) && d > 0) navigator.mediaSession.setPositionState({ duration: d, position: Math.min(P.el.currentTime, d), playbackRate: P.el.playbackRate || 1 }); } catch { /* yok */ }
}

export const bookById = id => getBook(id);
