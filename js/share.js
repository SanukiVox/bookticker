// Arkadaşlarla paylaşım: seçilen kitaplar ayrı, gizli bir depoya (bookticker-share) yazılır;
// kullanıcı adı + şifre ile giren kullanıcı yalnızca onları görür, yorum ve yıldız bırakabilir.
// Kullanıcıların GitHub anahtarı, şifreleriyle şifrelenip uygulamanın kendi deposundaki users.json'da durur.
import { state } from './store.js';
import { sync } from './sync.js';

const API = 'https://api.github.com';
export const SHARE_REPO = 'bookticker-share';
export const APP_REPO = 'bookticker';
export const APP_BRANCH = 'claude/program-yazma-8tqnyq';
const SHARED_FILE = 'kitaplar.json';
const USERS_FILE = 'users.json';
const GUEST_KEY = 'kitapligim-guest';
const ITER = 310000;

// ---------- Oturum ----------
export function guest() { try { return JSON.parse(localStorage.getItem(GUEST_KEY)); } catch { return null; } }
export const isGuest = () => !!guest()?.token;
export function logout() { try { localStorage.removeItem(GUEST_KEY); } catch { /* yok */ } location.hash = '#/'; location.reload(); }

async function api(token, owner, repo, path, { method = 'GET', body, raw } = {}) {
  const res = await fetch(`${API}/repos/${owner}/${repo}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, cache: 'no-store',
  });
  if (!res.ok) {
    const e = new Error(res.status === 401 ? 'Anahtar geçersiz ya da süresi dolmuş' : res.status === 403 ? 'Anahtarın bu işlem için izni yok' : res.status === 404 ? 'Depo ya da dosya bulunamadı (anahtarın bu depoya erişimi var mı?)' : `GitHub hatası (${res.status})`);
    e.status = res.status; throw e;
  }
  return res.status === 204 ? null : raw ? res.text() : res.json();
}
const admin = () => { if (!sync.cfg?.token) throw new Error('Önce Ayarlar → GitHub eşitlemeyi kur'); return { token: sync.cfg.token, owner: sync.cfg.owner }; };
const enc64 = s => { const b = new TextEncoder().encode(s); let t = ''; for (let i = 0; i < b.length; i += 0x8000) t += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(t); };
const dec64 = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), c => c.charCodeAt(0)));

async function getFile(token, owner, repo, path, ref) {
  try { const f = await api(token, owner, repo, `/contents/${path}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`); return { sha: f.sha, text: dec64(f.content) }; }
  catch (e) { if (e.status === 404) return { sha: null, text: null }; throw e; }
}
async function putFile(token, owner, repo, path, text, message, branch) {
  const cur = await getFile(token, owner, repo, path, branch);
  return api(token, owner, repo, `/contents/${path}`, { method: 'PUT', body: { message, content: enc64(text), ...(cur.sha ? { sha: cur.sha } : {}), ...(branch ? { branch } : {}) } });
}

// ---------- Paylaşılan kitaplar (yalnızca kitap bilgileri; kişisel veriler gitmez) ----------
const PUBLIC = ['id', 'title', 'originalTitle', 'author', 'series', 'seriesOrder', 'genre', 'translation', 'publisher', 'scores', 'quality', 'spicy', 'spicyNote',
  'qualityConf', 'confidence', 'goodreads', 'goodreadsVotes', 'review', 'summary', 'warnings', 'tags', 'pubYear', 'trDate', 'createdAt', 'updatedAt'];
export function sanitize(b) {
  const o = { status: 'Okunacak' };
  for (const k of PUBLIC) if (b[k] !== undefined) o[k] = b[k];
  o.coverOrig = b.coverOrig || null; o.coverTr = b.coverTr || null;
  return o;
}
// Bu cihazda yüklenmiş kapaklar (adres değil, anahtar) paylaşım deposuna resim dosyası olarak yüklenir;
// kitaplar.json'da "share:covers/<anahtar>.jpg" diye geçer.
const COVER_DIR = 'covers';
const coverPath = key => `${COVER_DIR}/${String(key).replace(/[^\w.-]/g, '_')}.jpg`;
function shareCoverRef(v, need) {
  if (!v || /^(https?:|data:|share:)/.test(v)) return v || null;
  const p = coverPath(v);
  need.set(p, v);
  return `share:${p}`;
}
function sharedData() {
  const need = new Map(), books = [];
  for (const b of state.books.filter(x => x.shared)) {
    const o = sanitize(b);
    o.coverTr = shareCoverRef(o.coverTr, need); o.coverOrig = shareCoverRef(o.coverOrig, need);
    books.push(o);
  }
  return { text: JSON.stringify({ app: 'kitapligim-share', savedAt: new Date().toISOString(), books }, null, 1), need };
}
const bytesB64 = async blob => { const b = new Uint8Array(await blob.arrayBuffer()); let t = ''; for (let i = 0; i < b.length; i += 0x8000) t += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(t); };
async function uploadCovers(token, owner, need) {
  if (!need.size) return;
  let have = new Set();
  try { have = new Set((await api(token, owner, SHARE_REPO, `/contents/${COVER_DIR}`)).map(f => f.path)); }
  catch (e) { if (e.status !== 404) throw e; }
  const { db } = await import('./db.js');
  for (const [path, key] of need) {
    if (have.has(path)) continue;
    const blob = await db.getCover(key);
    if (!blob) continue;
    await api(token, owner, SHARE_REPO, `/contents/${path}`, { method: 'PUT', body: { message: `Kapak: ${path}`, content: await bytesB64(blob) } });
  }
}
// Misafir: paylaşım deposundaki kapağı bir kez indirir, sonra bu cihazdan gösterir
export async function shareCoverBlob(ref) {
  const path = ref.replace(/^share:/, '');
  const { db } = await import('./db.js');
  const cached = await db.getCover(ref);
  if (cached) return cached;
  const g = guest();
  if (!g?.token) return null;
  const res = await fetch(`${API}/repos/${g.owner}/${g.repo}/contents/${path}`, { headers: { Authorization: `Bearer ${g.token}`, Accept: 'application/vnd.github.raw+json', 'X-GitHub-Api-Version': '2022-11-28' } });
  if (!res.ok) return null;
  const blob = new Blob([await res.arrayBuffer()], { type: 'image/jpeg' });
  try { await db.putCover(ref, blob); } catch { /* önbelleğe yazılamazsa her seferinde indirir */ }
  return blob;
}
let lastPublished = null, timer = null;
export async function publishShare() {
  const { token, owner } = admin();
  const { text, need } = sharedData();
  await uploadCovers(token, owner, need);
  await putFile(token, owner, SHARE_REPO, SHARED_FILE, text, `Paylaşılan kitaplar: ${state.books.filter(b => b.shared).length}`);
  lastPublished = text.replace(/"savedAt":"[^"]*"/, '');
}
// Paylaşılan bir kitap değişince birkaç saniye sonra kendiliğinden yeniden yayınla
export function schedulePublish() {
  if (isGuest() || !sync.cfg?.token || !state.books.some(b => b.shared) && lastPublished === null) return;
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const now = sharedData().text.replace(/"savedAt":"[^"]*"/, '');
    if (now === lastPublished) return;
    try { await publishShare(); } catch { /* bir sonraki değişiklikte tekrar denenir */ }
  }, 8000);
}

// ---------- Kullanıcılar (şifreli anahtar) ----------
async function keyFrom(password, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const b64 = u8 => btoa(String.fromCharCode(...u8));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export const normUser = u => String(u || '').trim().toLocaleLowerCase('tr').replace(/\s+/g, '');

export async function listUsers() {
  const { token, owner } = admin();
  const f = await getFile(token, owner, APP_REPO, USERS_FILE, APP_BRANCH);
  return f.text ? JSON.parse(f.text).users || {} : {};
}
export async function createUser({ username, name, password, guestToken }) {
  const u = normUser(username);
  if (!/^[a-z0-9çğıöşü._-]{3,30}$/.test(u)) throw new Error('Kullanıcı adı 3–30 karakter olmalı (harf, rakam, . _ -)');
  if (String(password).length < 12) throw new Error('Şifre en az 12 karakter olmalı');
  if (!/^(github_pat_|ghp_)/.test(guestToken.trim())) throw new Error('Davet anahtarı github_pat_ ile başlamalı');
  const { token, owner } = admin();
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const payload = JSON.stringify({ token: guestToken.trim(), owner, repo: SHARE_REPO, name: name.trim() || username });
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFrom(password, salt), new TextEncoder().encode(payload)));
  const f = await getFile(token, owner, APP_REPO, USERS_FILE, APP_BRANCH);
  const data = f.text ? JSON.parse(f.text) : { app: 'kitapligim-users', users: {} };
  data.users[u] = { name: name.trim() || username, salt: b64(salt), iv: b64(iv), ct: b64(ct), iter: ITER, created: new Date().toISOString() };
  await putFile(token, owner, APP_REPO, USERS_FILE, JSON.stringify(data, null, 1), `Kullanıcı: ${u}`, APP_BRANCH);
}
// Yönetici: bu cihazdaki GitHub eşitleme bilgisi (veri deposu + anahtar) şifreyle kilitlenir
export async function createAdmin({ username, password }) {
  const u = normUser(username);
  if (!/^[a-z0-9çğıöşü._-]{3,30}$/.test(u)) throw new Error('Kullanıcı adı 3–30 karakter olmalı (harf, rakam, . _ -)');
  if (String(password).length < 14) throw new Error('Yönetici şifresi en az 14 karakter olmalı');
  const { token, owner } = admin();
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const payload = JSON.stringify({ role: 'admin', token, owner, repo: sync.cfg.repo, branch: sync.cfg.branch || 'main', name: 'Yönetici' });
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFrom(password, salt), new TextEncoder().encode(payload)));
  const f = await getFile(token, owner, APP_REPO, USERS_FILE, APP_BRANCH);
  const data = f.text ? JSON.parse(f.text) : { app: 'kitapligim-users', users: {} };
  data.users[u] = { name: 'Yönetici', role: 'admin', salt: b64(salt), iv: b64(iv), ct: b64(ct), iter: ITER, created: new Date().toISOString() };
  await putFile(token, owner, APP_REPO, USERS_FILE, JSON.stringify(data, null, 1), `Yönetici: ${u}`, APP_BRANCH);
}

export async function deleteUser(username) {
  const { token, owner } = admin();
  const f = await getFile(token, owner, APP_REPO, USERS_FILE, APP_BRANCH);
  if (!f.text) return;
  const data = JSON.parse(f.text); delete data.users[normUser(username)];
  await putFile(token, owner, APP_REPO, USERS_FILE, JSON.stringify(data, null, 1), `Kullanıcı silindi: ${normUser(username)}`, APP_BRANCH);
}
export async function login(username, password) {
  const res = await fetch(`${USERS_FILE}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Kullanıcı listesi bulunamadı');
  const e = (await res.json()).users?.[normUser(username)];
  if (!e) throw new Error('Kullanıcı adı ya da şifre hatalı');
  let payload;
  try {
    const key = await keyFrom(password, unb64(e.salt));
    payload = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(e.iv) }, key, unb64(e.ct))));
  } catch { throw new Error('Kullanıcı adı ya da şifre hatalı'); }
  if (payload.role === 'admin') {
    // Yönetici: eşitlemeyi kur ve kitaplığı GitHub'dan çek
    const sy = await import('./sync.js');
    await sy.configure({ owner: payload.owner, repo: payload.repo, branch: payload.branch, token: payload.token });
    await sy.testConnection();
    try { await sy.pull(); } catch { /* veri sonra otomatik eşitlemeyle gelir */ }
    return payload;
  }
  await api(payload.token, payload.owner, payload.repo, ''); // anahtar hâlâ geçerli mi?
  localStorage.setItem(GUEST_KEY, JSON.stringify({ ...payload, user: normUser(username) }));
  return payload;
}
export async function loadShared() {
  const g = guest();
  const text = await api(g.token, g.owner, g.repo, `/contents/${SHARED_FILE}`, { raw: true });
  return JSON.parse(text).books || [];
}

// ---------- Yorumlar (paylaşım deposunda kitap başına bir "issue") ----------
const ctx = () => { const g = guest(); if (g?.token) return { token: g.token, owner: g.owner, repo: g.repo, name: g.name }; const a = admin(); return { ...a, repo: SHARE_REPO, name: 'Ben' }; };
let issueMap = null;
async function issues(c, refresh) {
  if (issueMap && !refresh) return issueMap;
  issueMap = new Map();
  for (let page = 1; page < 10; page++) {
    const list = await api(c.token, c.owner, c.repo, `/issues?state=all&per_page=100&page=${page}`);
    for (const i of list) { const m = /^kitap:(\S+)/.exec(i.title); if (m) issueMap.set(m[1], i); }
    if (list.length < 100) break;
  }
  return issueMap;
}
const MARK = /<!--kitapligim (\{.*?\})-->/;
function parseComment(c) {
  const m = MARK.exec(c.body || ''); let meta = {};
  try { meta = m ? JSON.parse(m[1]) : {}; } catch { /* yok */ }
  return { id: c.id, at: c.created_at, name: meta.name || 'Ben', stars: meta.stars || 0, text: (c.body || '').replace(MARK, '').trim() };
}
export async function bookComments(bookId) {
  const c = ctx();
  const i = (await issues(c)).get(bookId);
  if (!i || !i.comments) return [];
  return (await api(c.token, c.owner, c.repo, `/issues/${i.number}/comments?per_page=100`)).map(parseComment);
}
export async function addComment(book, text, stars) {
  const c = ctx();
  let i = (await issues(c, true)).get(book.id);
  if (!i) { i = await api(c.token, c.owner, c.repo, '/issues', { method: 'POST', body: { title: `kitap:${book.id} · ${book.title}`, body: `${book.title} — ${book.author || ''}` } }); issueMap.set(book.id, i); }
  const body = `${text.trim()}\n\n<!--kitapligim ${JSON.stringify({ name: c.name, stars: Number(stars) || 0 })}-->`;
  await api(c.token, c.owner, c.repo, `/issues/${i.number}/comments`, { method: 'POST', body: { body } });
  i.comments = (i.comments || 0) + 1;
}
// Admin: son yorumlar (tüm kitaplar)
export async function recentComments() {
  const c = ctx();
  const list = await api(c.token, c.owner, c.repo, `/issues/comments?sort=created&direction=desc&per_page=50`);
  const map = await issues(c, true);
  const byUrl = new Map([...map.entries()].map(([id, i]) => [i.url, id]));
  return list.map(x => ({ ...parseComment(x), bookId: byUrl.get(x.issue_url) }));
}
