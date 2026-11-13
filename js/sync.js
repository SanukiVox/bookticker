// GitHub ile eşitleme: veriler gizli bir depoya gönderilir / oradan çekilir.
// Depoda: kitapligim.json (kitaplar, seçenekler, ayarlar) + covers/<anahtar>.jpg (kapaklar)
import { state, onChange, replaceAll } from './store.js';
import { db } from './db.js';

const DATA_FILE = 'kitapligim.json';
const API = 'https://api.github.com';

export const sync = {
  cfg: null, // { owner, repo, branch, token, auto, lastPush, lastPull, lastRemoteCommit, dirty, error, conflict }
  busy: false,
  listeners: new Set(),
};

const notify = () => sync.listeners.forEach(fn => fn());
export const onSyncChange = fn => sync.listeners.add(fn);

export async function loadSync() {
  sync.cfg = (await db.getMeta('sync')) || null;
}
async function saveCfg() {
  await db.putMeta('sync', sync.cfg);
  notify();
}
export const isConfigured = () => !!(sync.cfg?.token && sync.cfg?.owner && sync.cfg?.repo);

export async function configure({ owner, repo, branch, token, reset = false }) {
  const keep = reset ? {} : (sync.cfg || {});
  sync.cfg = { ...keep, owner: owner.trim(), repo: repo.trim(), branch: (branch || 'main').trim(), token: token.trim(), auto: sync.cfg?.auto ?? true, error: null, conflict: false };
  await saveCfg();
}
export async function disconnect() {
  sync.cfg = null;
  await db.putMeta('sync', null);
  notify();
}
export async function setAuto(on) { sync.cfg.auto = on; await saveCfg(); if (on && sync.cfg.dirty) schedulePush(0); }

// ---------- GitHub API ----------
async function gh(path, { method = 'GET', body, accept } = {}) {
  const { owner, repo, token } = sync.cfg;
  const res = await fetch(`${API}/repos/${owner}/${repo}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: accept || 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  if (!res.ok) {
    const err = new Error(explain(res.status, path));
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

function explain(status, path) {
  if (status === 401) return 'Erişim anahtarı geçersiz ya da süresi dolmuş';
  if (status === 403) return 'Anahtarın bu depoya yazma izni yok (Contents: Read and write olmalı)';
  if (status === 404 && path === '') return 'Depo bulunamadı: kullanıcı adı / depo adını ve anahtarın bu depoya erişimi olduğunu kontrol et';
  if (status === 404) return 'GitHub\'da bulunamadı';
  if (status === 409) return 'Depo boş';
  if (status === 422) return 'GitHub isteği reddetti (dal adı doğru mu?)';
  return `GitHub hatası (${status})`;
}

const b64FromBytes = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const bytesFromB64 = b64 => Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0));
const b64FromText = text => b64FromBytes(new TextEncoder().encode(text));
const textFromB64 = b64 => new TextDecoder().decode(bytesFromB64(b64));

// Dalın son durumu: { commit, tree: Map(path → sha) } — depo boşsa null
async function remoteHead() {
  const { branch } = sync.cfg;
  let ref;
  try { ref = await gh(`/git/ref/heads/${encodeURIComponent(branch)}`); }
  catch (e) { if (e.status === 404 || e.status === 409) return null; throw e; }
  const commit = ref.object.sha;
  const c = await gh(`/git/commits/${commit}`);
  const t = await gh(`/git/trees/${c.tree.sha}?recursive=1`);
  const tree = new Map(t.tree.filter(x => x.type === 'blob').map(x => [x.path, x.sha]));
  return { commit, treeSha: c.tree.sha, tree };
}

export async function testConnection() {
  const repo = await gh('');
  if (!repo.private) return { ok: true, warn: 'Dikkat: bu depo herkese açık (public). Verilerin için gizli (private) bir depo kullanmanı öneririm.' };
  return { ok: true };
}

const coverKeyFromPath = p => p.replace(/^covers\//, '').replace(/\.jpg$/, '');
const usedCoverKeys = books => new Set(books.flatMap(b => [b.coverTr, b.coverOrig]).filter(k => k && !/^https?:\/\//.test(k)));


// ---------- Birleştirme (iki cihazın değişiklikleri birbirini ezmesin) ----------
// Kitaplar kimlikle eşleşir; aynı kitapta:
//  - genel bilgiler: daha yeni düzenlenen (updatedAt) kazanır
//  - okuma ilerlemesi: en son okunan (progress.updatedAt) kazanır
//  - yer imleri: iki taraf birleşir · okuma süresi: büyük olan
//  - dosya bilgisi: içerik özeti (hash) olan tercih edilir
// Silinen kitaplar "silindi" kaydıyla (mezar taşı) diğer cihaza da yayılır.
const t = v => Number(v) || 0;

function mergeBook(a, b) {
  const base = t(b.updatedAt) > t(a.updatedAt) ? b : a;
  const out = { ...base };
  const pa = a.progress, pb = b.progress;
  out.progress = !pa ? (pb ?? null) : !pb ? pa : (t(pb.updatedAt) > t(pa.updatedAt) ? pb : pa);
  const seen = new Set();
  out.bookmarks = [...(a.bookmarks || []), ...(b.bookmarks || [])]
    .filter(m => { const k = `${m.loc}|${m.createdAt}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((x, y) => t(x.createdAt) - t(y.createdAt));
  out.readingSeconds = Math.max(t(a.readingSeconds), t(b.readingSeconds)) || undefined;
  if (a.file || b.file) out.file = (a.file?.hash ? a.file : b.file?.hash ? b.file : base.file) || a.file || b.file;
  return out;
}

function mergeOptions(a, b) {
  if (!a) return b; if (!b) return a;
  const [newer, older] = t(b.updatedAt) > t(a.updatedAt) ? [b, a] : [a, b];
  const out = { ...older, ...newer };
  // Listelerde eklenen seçenek kaybolmasın
  for (const k of Object.keys(out)) {
    if (!Array.isArray(out[k])) continue;
    const names = new Set(out[k].map(o => o.name));
    for (const o of older[k] || []) if (o?.name && !names.has(o.name)) { out[k] = [...out[k], o]; names.add(o.name); }
  }
  return out;
}

function mergeSettings(a, b) {
  if (!a) return b; if (!b) return a;
  const [newer, older] = t(b.updatedAt) > t(a.updatedAt) ? [b, a] : [a, b];
  const out = { ...older, ...newer };
  const log = { ...(older.readLog || {}) };
  for (const [d, s] of Object.entries(newer.readLog || {})) log[d] = Math.max(t(log[d]), t(s));
  out.readLog = log;
  return out;
}

export function mergeData(local, remote) {
  const deleted = { ...(remote.deleted || {}) };
  for (const [id, ts] of Object.entries(local.deleted || {})) deleted[id] = Math.max(t(deleted[id]), t(ts));
  const map = new Map();
  for (const b of remote.books || []) map.set(b.id, b);
  for (const b of local.books || []) map.set(b.id, map.has(b.id) ? mergeBook(b, map.get(b.id)) : b);
  const books = [...map.values()].filter(b => !(deleted[b.id] && t(deleted[b.id]) >= t(b.updatedAt)));
  return { books, options: mergeOptions(local.options, remote.options), settings: mergeSettings(local.settings, remote.settings), deleted };
}

async function localData() {
  return { books: state.books, options: state.options, settings: state.settings, deleted: (await db.getMeta('deleted')) || {} };
}

async function readRemote(head) {
  if (!head?.tree.has(DATA_FILE)) return null;
  const blob = await gh(`/git/blobs/${head.tree.get(DATA_FILE)}`);
  const data = JSON.parse(textFromB64(blob.content));
  if (data?.app !== 'kitapligim' || !Array.isArray(data.books)) throw new Error('Depodaki veri dosyası tanınmadı');
  return data;
}

// Birleşik veriyi bu cihaza uygula (eksik kapakları indir, kullanılmayanları sil)
async function applyLocal(merged, head) {
  const used = usedCoverKeys(merged.books);
  const local = new Set(await db.allCoverKeys());
  for (const key of used) {
    if (local.has(key)) continue;
    const sha = head.tree.get(`covers/${key}.jpg`);
    if (!sha) continue;
    const cb = await gh(`/git/blobs/${sha}`);
    await db.putCover(key, new Blob([bytesFromB64(cb.content)], { type: 'image/jpeg' }));
  }
  for (const key of local) if (!used.has(key)) await db.deleteCover(key);
  await db.putMeta('deleted', merged.deleted);
  suppress = true;
  try { await replaceAll(merged.books, merged.options, merged.settings); } finally { suppress = false; }
}

const fingerprint = d => JSON.stringify([d.books.map(b => [b.id, b.updatedAt, b.progress?.updatedAt, (b.bookmarks || []).length, b.readingSeconds]).sort(), d.options?.updatedAt, d.settings?.updatedAt, Object.keys(d.deleted || {}).length]);

// ---------- Gönder ----------
export async function push({ force = false } = {}) {
  if (!isConfigured()) throw new Error('GitHub bağlantısı kurulmamış');
  if (sync.busy) return;
  sync.busy = true; notify();
  try {
    let head = await remoteHead();
    // GitHub'da bu cihazın bilmediği değişiklik varsa önce birleştir (ezme yok)
    if (head && head.commit !== sync.cfg.lastRemoteCommit && head.tree.has(DATA_FILE)) {
      const remote = await readRemote(head);
      await applyLocal(mergeData(await localData(), remote), head);
    }
    if (!head) {
      // Boş depo: ilk commit'i Contents API ile oluştur.
      await gh(`/contents/README.md`, { method: 'PUT', body: { message: 'Kitaplığım veri deposu', content: b64FromText('# Kitaplığım verileri\n\nBu depo Kitaplığım uygulaması tarafından yönetilir.\n'), branch: sync.cfg.branch } });
      head = await remoteHead();
    }

    const entries = [];
    const used = usedCoverKeys(state.books);
    // Yeni kapakları yükle
    for (const key of used) {
      const path = `covers/${key}.jpg`;
      if (head.tree.has(path)) continue;
      const blob = await db.getCover(key);
      if (!blob) continue;
      const b = await gh('/git/blobs', { method: 'POST', body: { content: b64FromBytes(new Uint8Array(await blob.arrayBuffer())), encoding: 'base64' } });
      entries.push({ path, mode: '100644', type: 'blob', sha: b.sha });
    }
    // Artık kullanılmayan kapakları sil
    for (const path of head.tree.keys()) {
      if (path.startsWith('covers/') && !used.has(coverKeyFromPath(path))) entries.push({ path, mode: '100644', type: 'blob', sha: null });
    }
    const data = { app: 'kitapligim', version: 2, savedAt: new Date().toISOString(), books: state.books, options: state.options, settings: state.settings, deleted: (await db.getMeta('deleted')) || {} };
    entries.push({ path: DATA_FILE, mode: '100644', type: 'blob', content: JSON.stringify(data, null, 1) });

    const tree = await gh('/git/trees', { method: 'POST', body: { base_tree: head.treeSha, tree: entries } });
    const n = state.books.length;
    const commit = await gh('/git/commits', { method: 'POST', body: { message: `Kitaplığım: ${n} kitap · ${new Date().toLocaleString('tr-TR')}`, tree: tree.sha, parents: [head.commit] } });
    try {
      await gh(`/git/refs/heads/${encodeURIComponent(sync.cfg.branch)}`, { method: 'PATCH', body: { sha: commit.sha, force: false } });
    } catch (e) {
      // Bu arada başka cihaz göndermiş: bir kez daha birleştirip dene
      if (e.status === 422 && !force) { sync.busy = false; return push({ force: true }); }
      throw e;
    }

    Object.assign(sync.cfg, { lastRemoteCommit: commit.sha, lastPush: Date.now(), dirty: false, error: null, conflict: false });
    await saveCfg();
  } catch (e) {
    if (sync.cfg) { sync.cfg.error = e.message; await saveCfg(); }
    throw e;
  } finally {
    sync.busy = false; notify();
  }
}

// ---------- Çek ----------
let suppress = false;
export async function pull() {
  if (!isConfigured()) throw new Error('GitHub bağlantısı kurulmamış');
  if (sync.busy) return null;
  sync.busy = true; notify();
  try {
    const head = await remoteHead();
    if (!head || !head.tree.has(DATA_FILE)) throw new Error('GitHub deposunda henüz veri yok. Önce "GitHub\'a gönder" ile kaydet.');
    const remote = await readRemote(head);
    const merged = mergeData(await localData(), remote);
    // Bu cihazda GitHub'da olmayan bir şey var mı? Varsa birleşik hâl geri gönderilmeli.
    const hasLocalExtra = fingerprint({ ...merged }) !== fingerprint({ books: remote.books, options: remote.options, settings: remote.settings, deleted: remote.deleted || {} });
    await applyLocal(merged, head);
    Object.assign(sync.cfg, { lastRemoteCommit: head.commit, lastPull: Date.now(), dirty: hasLocalExtra, error: null, conflict: false });
    await saveCfg();
    if (hasLocalExtra) schedulePush(1500);
    return merged.books.length;
  } catch (e) {
    if (sync.cfg) { sync.cfg.error = e.message; await saveCfg(); }
    throw e;
  } finally {
    sync.busy = false; notify();
  }
}

// GitHub'da telefondakinden daha yeni veri var mı?
export async function remoteChanged() {
  if (!isConfigured()) return false;
  const head = await remoteHead();
  return !!(head && head.tree.has(DATA_FILE) && head.commit !== sync.cfg.lastRemoteCommit);
}

// ---------- Otomatik gönderim ----------
let timer = null;
let onAutoResult = null;
export const onAutoPush = fn => { onAutoResult = fn; };

function schedulePush(delay = 4000) {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    if (!isConfigured() || !sync.cfg.auto || !sync.cfg.dirty) return;
    if (!navigator.onLine) return;
    if (sync.busy) { schedulePush(3000); return; }
    try { await push(); onAutoResult?.(null); } catch (e) { onAutoResult?.(e); }
  }, delay);
}

export function startAutoSync() {
  onChange(async () => {
    if (suppress || !isConfigured()) return;
    if (!sync.cfg.dirty) { sync.cfg.dirty = true; await saveCfg(); }
    schedulePush();
  });
  window.addEventListener('online', () => { autoPull(); schedulePush(1000); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { autoPull(); schedulePush(1500); } });
  if (sync.cfg?.dirty) schedulePush(2000);
  setTimeout(autoPull, 800);
}

// Diğer cihazdaki değişiklikleri kendiliğinden al (okuma/düzenleme sırasında değil)
let pulling = false, onPulled = null;
export const onAutoPull = fn => { onPulled = fn; };
async function autoPull() {
  if (pulling || sync.busy || !isConfigured() || !sync.cfg.auto || !navigator.onLine) return;
  const path = location.hash.replace(/^#/, '');
  if (path.startsWith('/read/') || path.startsWith('/edit/')) return;
  pulling = true;
  try {
    if (await remoteChanged()) { await pull(); onPulled?.(); }
  } catch { /* sessiz: bir sonraki açılışta tekrar dener */ }
  finally { pulling = false; }
}
