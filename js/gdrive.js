// Google Drive ile kitap dosyası (PDF/EPUB) eşitleme.
// - Kimlik: OAuth "implicit" yönlendirme akışı (sunucu yok). Erişim anahtarı ~1 saat geçerli; yalnızca bu cihazda
//   (IndexedDB meta 'gdrive') saklanır, GitHub'a gitmez. Süresi bitince Google'a görünmeden yönlendirip yenileriz.
// - Yetki: drive.file → uygulama yalnızca kendi oluşturduğu dosyaları görür (Drive'ınızın geri kalanına erişmez).
// - Dosyalar Drive'da "Kitaplığım" klasörüne; içerik özeti (hash) appProperties'te. Kitapta file.driveId tutulur
//   ve GitHub eşitlemesiyle öbür cihazlara gider; orada dosya Drive'dan indirilir.
import { state, saveBook, displayTitle } from './store.js';
import { db } from './db.js';
import { resolveLocalKey, slotBook } from './files.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3';
const UP = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER = 'Kitaplığım';
// Google'a hep aynı dönüş adresi gitsin: .../bookticker, .../bookticker/index.html → .../bookticker/
// (Google Cloud'daki "Authorized redirect URIs" ile birebir aynı olmalı)
export const redirectUri = () => {
  let p = location.pathname.replace(/index\.html$/, '');
  if (!p.endsWith('/')) p += '/';
  return location.origin + p;
};

let conf = null;
const listeners = new Set();
export const onDriveChange = fn => listeners.add(fn);
const emit = () => listeners.forEach(f => { try { f(); } catch { /* yok */ } });

export async function driveConf() {
  conf ||= { clientId: '', token: '', exp: 0, folderId: '', autoDownload: true, connected: false, ...((await db.getMeta('gdrive')) || {}) };
  if (!conf.clientId && state.settings?.driveClientId) conf.clientId = state.settings.driveClientId;
  // Eski kurulum: kimlik yalnızca bu cihazdaysa ayarlara da yaz (GitHub ile öbür cihazlara gitsin)
  else if (conf.clientId && state.settings && !state.guest && state.settings.driveClientId !== conf.clientId) {
    state.settings.driveClientId = conf.clientId;
    import('./store.js').then(m => m.saveSettings()).catch(() => {});
  }
  return conf;
}
async function saveConf(patch) { conf = { ...(await driveConf()), ...patch }; await db.putMeta('gdrive', conf); emit(); return conf; }
export const tokenValid = c => !!(c?.token && c.exp > Date.now() + 60000);

// ---------- Yetkilendirme (yönlendirme) ----------
export async function connect({ silent = false, returnTo } = {}) {
  const c = await driveConf();
  if (!c.clientId) throw new Error('Önce Google istemci kimliğini (Client ID) gir');
  const st = { r: returnTo ?? (location.hash || '#/'), s: silent ? 1 : 0, n: Math.random().toString(36).slice(2) };
  sessionStorage.setItem('gdrive-state', st.n);
  try { localStorage.setItem('gdrive-state', JSON.stringify({ n: st.n, at: Date.now() })); } catch { /* yok */ }
  const q = new URLSearchParams({ client_id: c.clientId, redirect_uri: redirectUri(), response_type: 'token', scope: SCOPE, include_granted_scopes: 'true', state: JSON.stringify(st) });
  if (silent) q.set('prompt', 'none');
  if (c.email) q.set('login_hint', c.email);
  location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
}

// Uygulama açılırken (yönlendirmeden dönüşte) çağrılır; true dönerse adres düzeltildi
export async function handleRedirect() {
  const h = location.hash;
  if (!/^#(access_token|error|state)=/.test(h) && !/[#&](access_token|error)=/.test(h)) return false;
  const p = new URLSearchParams(h.slice(1));
  let st = {};
  try { st = JSON.parse(p.get('state') || '{}'); } catch { /* yok */ }
  let expected = sessionStorage.getItem('gdrive-state');
  if (!expected) { try { const l = JSON.parse(localStorage.getItem('gdrive-state') || 'null'); if (l && Date.now() - l.at < 15 * 60000) expected = l.n; } catch { /* yok */ } }
  sessionStorage.removeItem('gdrive-state');
  try { localStorage.removeItem('gdrive-state'); } catch { /* yok */ }
  if (p.get('access_token') && !(st.n && st.n === expected)) {
    await saveConf({ lastError: 'Google girişi tamamlanamadı (dönüş doğrulanamadı). "Google Drive\'a bağlan"a uygulamanın içinden tekrar bas.' });
  } else if (p.get('access_token') && st.n && st.n === expected) {
    await saveConf({ token: p.get('access_token'), exp: Date.now() + (Number(p.get('expires_in')) || 3600) * 1000, connected: true, lastError: '' });
    try { const me = await api('/about?fields=user(emailAddress)'); if (me?.user?.emailAddress) await saveConf({ email: me.user.emailAddress }); } catch { /* yok */ }
  } else if (p.get('error')) {
    await saveConf({ lastError: st.s ? 'Drive bağlantısının yenilenmesi gerekiyor' : `Google: ${p.get('error')}` });
  }
  history.replaceState(null, '', `${location.pathname}${st.r && st.r.startsWith('#') ? st.r : '#/'}`);
  return true;
}

export async function disconnect() {
  const c = await driveConf();
  if (c.token) fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(c.token)}`, { method: 'POST' }).catch(() => {});
  await saveConf({ token: '', exp: 0, connected: false, folderId: '' });
}

// ---------- API ----------
class AuthError extends Error {}
async function api(path, { method = 'GET', body, headers = {}, raw = false, base = API } = {}) {
  const c = await driveConf();
  if (!tokenValid(c)) throw new AuthError('Drive bağlantısı yenilenmeli');
  const r = await fetch(path.startsWith('http') ? path : base + path, { method, body, headers: { Authorization: `Bearer ${c.token}`, ...headers } });
  if (r.status === 401) { await saveConf({ exp: 0 }); throw new AuthError('Drive bağlantısı yenilenmeli'); }
  if (!r.ok) { let m = ''; try { m = (await r.json()).error?.message; } catch { /* yok */ } throw new Error(`Drive: ${m || r.status}`); }
  return raw ? r : r.status === 204 ? null : r.json();
}

async function folderId() {
  const c = await driveConf();
  if (c.folderId) return c.folderId;
  const q = encodeURIComponent(`mimeType='application/vnd.google-apps.folder' and name='${FOLDER}' and trashed=false`);
  const found = await api(`/files?q=${q}&fields=files(id)&spaces=drive`);
  let id = found.files?.[0]?.id;
  if (!id) id = (await api('/files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: FOLDER, mimeType: 'application/vnd.google-apps.folder' }) })).id;
  await saveConf({ folderId: id });
  return id;
}

async function findByHash(hash) {
  if (!hash) return null;
  const q = encodeURIComponent(`appProperties has { key='hash' and value='${hash}' } and trashed=false`);
  const r = await api(`/files?q=${q}&fields=files(id)&spaces=drive`);
  return r.files?.[0]?.id || null;
}

async function uploadBlob(blob, name, hash) {
  const parent = await folderId();
  const meta = { name, parents: [parent], appProperties: { hash: hash || '', app: 'kitapligim' } };
  if (blob.size <= 4.5 * 1024 * 1024) {
    const boundary = `kj${Math.random().toString(36).slice(2)}`;
    const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`, blob, `\r\n--${boundary}--`]);
    return (await api('/files?uploadType=multipart&fields=id', { method: 'POST', base: UP, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body })).id;
  }
  // Büyük dosya: devam ettirilebilir yükleme
  const start = await api('/files?uploadType=resumable&fields=id', { method: 'POST', base: UP, raw: true, headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': blob.type || 'application/octet-stream', 'X-Upload-Content-Length': String(blob.size) }, body: JSON.stringify(meta) });
  const loc = start.headers.get('Location');
  if (!loc) throw new Error('Drive: yükleme başlatılamadı');
  const c = await driveConf();
  const r = await fetch(loc, { method: 'PUT', body: blob, headers: { Authorization: `Bearer ${c.token}` } });
  if (!r.ok) throw new Error(`Drive yükleme: ${r.status}`);
  return (await r.json()).id;
}

// ---------- Eşitleme ----------
const LANG = { orig: 'orijinal', tr: 'ceviri' };
const fileName = (b, f, slot) => `${displayTitle(b).replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 80)}${f.lang ? ` - ${LANG[f.lang]}` : slot === 2 ? ' - 2' : ''}.${f.type}`;

// Bu cihazda olup Drive'da olmayan dosyalar
export async function pendingUploads() {
  const out = [];
  for (const b of state.books) for (const slot of [1, 2]) {
    const f = slot === 2 ? b.file2 : b.file;
    if (!f || f.driveId) continue;
    const key = await resolveLocalKey(slotBook(b, slot));
    if (key) out.push({ b, slot, f, key });
  }
  return out;
}
// Drive'da olup bu cihazda olmayan dosyalar
export async function pendingDownloads() {
  const out = [];
  for (const b of state.books) for (const slot of [1, 2]) {
    const f = slot === 2 ? b.file2 : b.file;
    if (!f?.driveId) continue;
    if (!(await resolveLocalKey(slotBook(b, slot)))) out.push({ b, slot, f });
  }
  return out;
}

export async function uploadOne({ b, slot, f, key }) {
  const blob = await db.getFile(key);
  if (!blob) return false;
  const id = (await findByHash(f.hash)) || (await uploadBlob(blob, fileName(b, f, slot), f.hash));
  const cur = slot === 2 ? b.file2 : b.file;
  if (cur && (cur.hash === f.hash || !cur.hash)) { cur.driveId = id; await saveBook(b); }
  return true;
}

export async function downloadOne(b, slot, onProgress) {
  const f = slot === 2 ? b.file2 : b.file;
  if (!f?.driveId) throw new Error('Bu dosya Drive\'da yok');
  const r = await api(`/files/${f.driveId}?alt=media`, { raw: true });
  let blob;
  const total = Number(r.headers.get('Content-Length')) || f.size || 0;
  if (r.body && total && onProgress) {
    const reader = r.body.getReader(); const parts = []; let got = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; onProgress(got / total); }
    blob = new Blob(parts);
  } else blob = await r.blob();
  const key = f.key || (f.hash ? `h-${f.hash.slice(0, 32)}` : `${b.id}-${slot}`);
  await db.putFile(key, new Blob([blob], { type: f.type === 'pdf' ? 'application/pdf' : 'application/epub+zip' }));
  if (!f.key) { f.key = key; await saveBook(b); }
  return true;
}

let running = null;
// Yüklenmemişleri yükle; ayar açıksa eksikleri indir. needAuth: bağlantı yenilenmeli mi
export function syncDrive({ download } = {}) {
  running ||= (async () => {
    const c = await driveConf();
    if (!c.connected || !c.clientId) return { skipped: true };
    const up = await pendingUploads();
    const down = (download ?? c.autoDownload) ? await pendingDownloads() : [];
    if (!up.length && !down.length) return { up: 0, down: 0 };
    if (!tokenValid(c)) return { needAuth: true, up: up.length, down: down.length };
    let nu = 0, nd = 0;
    try {
      for (const x of up) if (await uploadOne(x)) nu++;
      for (const x of down) if (await downloadOne(x.b, x.slot)) nd++;
      await saveConf({ lastSync: Date.now(), lastError: '' });
    } catch (e) {
      await saveConf({ lastError: e.message });
      if (e instanceof AuthError) return { needAuth: true, up: nu, down: nd };
      throw e;
    }
    return { up: nu, down: nd };
  })().finally(() => { running = null; });
  return running;
}

// Uygulama açılışında: iş varsa ve bağlantı süresi dolmuşsa Google'a görünmeden yönlendirip yenile (oturumda bir kez)
export async function startupDrive(toast) {
  const c = await driveConf();
  if (!c.connected || !c.clientId) return;
  const res = await syncDrive().catch(e => ({ error: e }));
  if (res?.needAuth && !location.hash.startsWith('#/read/') && !sessionStorage.getItem('gdrive-silent')) {
    sessionStorage.setItem('gdrive-silent', '1');
    connect({ silent: true });
    return;
  }
  if (res?.up || res?.down) toast(`☁️ Drive: ${res.up ? `${res.up} dosya yüklendi` : ''}${res.up && res.down ? ' · ' : ''}${res.down ? `${res.down} dosya indirildi` : ''}`);
}

// Bağlantı yenilemesi için Google'a gidip dönünce yarım kalan indirmeyi tamamla
export function rememberDownload(bookId, slot) { sessionStorage.setItem('gdrive-after', JSON.stringify({ bookId, slot })); }
export async function resumeAfterAuth(toast) {
  const raw = sessionStorage.getItem('gdrive-after');
  if (!raw) return false;
  sessionStorage.removeItem('gdrive-after');
  const c = await driveConf();
  if (!tokenValid(c)) return false;
  try {
    const { bookId, slot } = JSON.parse(raw);
    const b = state.books.find(x => x.id === bookId);
    if (!b) return false;
    toast?.('☁️ Drive\'dan indiriliyor…');
    await downloadOne(b, slot);
    toast?.('☁️ Dosya indirildi');
    return true;
  } catch (e) { toast?.(e.message || 'İndirilemedi'); return false; }
}
