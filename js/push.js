// Telefon bildirimleri (Web Push). Sunucu yok: bildirimleri paylaşım deposundaki GitHub Actions gönderir.
// Bu cihazın aboneliği paylaşım deposunda "bildirim: kullanıcı@cihaz" başlıklı bir issue'da saklanır.
import { sync } from './sync.js';
import { api, getFile, putFile, guest, SHARE_REPO } from './share.js';

const PREF_KEY = 'kitapligim-push';
const DEV_KEY = 'kitapligim-device';
const CONFIG = 'push/config.json';

export const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export function prefs() { try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch { return {}; } }
const savePrefs = p => { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* yok */ } };
function deviceId() {
  let d = null;
  try { d = localStorage.getItem(DEV_KEY); } catch { /* yok */ }
  if (!d) { d = Math.random().toString(36).slice(2, 8); try { localStorage.setItem(DEV_KEY, d); } catch { /* yok */ } }
  return d;
}
function who() {
  const g = guest();
  if (g?.token) return { token: g.token, owner: g.owner, repo: g.repo, role: 'guest', name: g.name, user: g.user };
  if (!sync.cfg?.token) throw new Error('Önce GitHub eşitlemesini kur');
  return { token: sync.cfg.token, owner: sync.cfg.owner, repo: SHARE_REPO, role: 'admin', name: 'Ben', user: 'yonetici' };
}
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));

export async function config() {
  const w = who();
  const f = await getFile(w.token, w.owner, w.repo, CONFIG);
  return f.text ? JSON.parse(f.text) : null;
}

// Yönetici: bildirim sistemini paylaşım deposuna kurar. Yeni anahtar yalnızca ilk kurulumda (ya da istenince) üretilir.
export async function install({ newKeys = false } = {}) {
  const w = who();
  if (w.role !== 'admin') throw new Error('Yalnızca yönetici kurabilir');
  let cfg = await config(), privateKey = null;
  if (!cfg || newKeys) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const pub = await crypto.subtle.exportKey('raw', kp.publicKey);
    privateKey = (await crypto.subtle.exportKey('jwk', kp.privateKey)).d;
    cfg = { publicKey: b64url(pub), subject: location.protocol === 'https:' ? location.origin + location.pathname : 'https://github.com/', createdAt: new Date().toISOString() };
  }
  const get = async p => { const r = await fetch(`${p}?t=${Date.now()}`, { cache: 'no-store' }); if (!r.ok) throw new Error(`${p} alınamadı`); return r.text(); };
  const [script, flow] = await Promise.all([get('push/send.mjs'), get('push/bildirim.yml')]);
  await putFile(w.token, w.owner, w.repo, 'push/send.mjs', script, 'Bildirim betiği');
  try { await putFile(w.token, w.owner, w.repo, '.github/workflows/bildirim.yml', flow, 'Bildirim zamanlayıcısı'); }
  catch (e) {
    if (e.status === 403 || e.status === 404) throw new Error('GitHub anahtarında "Workflows: Read and write" izni yok. GitHub → Settings → Developer settings → Fine-grained tokens → anahtarını düzenle → Permissions → Workflows: Read and write → Update. Sonra tekrar dene.');
    throw e;
  }
  if (privateKey) await putFile(w.token, w.owner, w.repo, CONFIG, JSON.stringify(cfg, null, 1), 'Bildirim ayarı');
  return { privateKey, secretUrl: `https://github.com/${w.owner}/${w.repo}/settings/secrets/actions/new` };
}

// Bu cihazda bildirimleri aç ya da tercihleri güncelle
export async function enable(opts) {
  if (!supported()) throw new Error('Bu tarayıcı bildirim desteklemiyor');
  const cfg = await config();
  if (!cfg) throw new Error('Bildirim sistemi henüz kurulmamış');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Bildirim izni verilmedi. Telefon Ayarları → Bildirimler → Kitaplığım bölümünden açabilirsin.');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  const key = fromB64url(cfg.publicKey);
  if (sub && sub.options?.applicationServerKey && b64url(sub.options.applicationServerKey) !== cfg.publicKey) { await sub.unsubscribe(); sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const w = who(), p = { ...prefs(), ...opts, on: true };
  const body = JSON.stringify({ sub: sub.toJSON(), role: w.role, name: w.name, remindHour: p.remindHour ?? null, tzOffset: new Date().getTimezoneOffset(), newBooks: p.newBooks !== false, requests: p.requests !== false, comments: p.comments !== false, at: new Date().toISOString() });
  const title = `bildirim: ${w.user}@${deviceId()}`;
  if (p.issue) {
    try { await api(w.token, w.owner, w.repo, `/issues/${p.issue}`, { method: 'PATCH', body: { title, body, state: 'open' } }); }
    catch { p.issue = null; }
  }
  if (!p.issue) p.issue = (await api(w.token, w.owner, w.repo, '/issues', { method: 'POST', body: { title, body } })).number;
  savePrefs(p);
  return p;
}

export async function disable() {
  const p = prefs();
  try { const reg = await navigator.serviceWorker.ready; await (await reg.pushManager.getSubscription())?.unsubscribe(); } catch { /* yok */ }
  if (p.issue) { try { const w = who(); await api(w.token, w.owner, w.repo, `/issues/${p.issue}`, { method: 'PATCH', body: { state: 'closed' } }); } catch { /* yok */ } }
  savePrefs({ ...p, on: false, issue: null });
}

// İzin ve gösterim çalışıyor mu? (bu cihazda yerel bir deneme bildirimi)
export async function testLocal() {
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification('🔔 Bildirimler açık', { body: 'Kitaplığım sana buradan haber verecek.', icon: 'icons/icon-192.png', data: { url: '#/settings' } });
}
