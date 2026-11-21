// Kitaplığım bildirimleri: GitHub Actions bu betiği çalıştırır (bookticker-share deposunda).
// Abonelikler "bildirim: …" başlıklı açık issue'larda JSON olarak durur. Uygulama kurulumda bu dosyayı depoya yükler.
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import webpush from 'web-push';

const { GITHUB_TOKEN, GITHUB_REPOSITORY, VAPID_PRIVATE_KEY, GITHUB_EVENT_NAME, GITHUB_EVENT_PATH } = process.env;
if (!VAPID_PRIVATE_KEY) { console.log('VAPID_PRIVATE_KEY gizli anahtarı eklenmemiş; bildirim gönderilmedi.'); process.exit(0); }
const cfg = JSON.parse(fs.readFileSync('push/config.json', 'utf8'));
webpush.setVapidDetails(cfg.subject, cfg.publicKey, VAPID_PRIVATE_KEY);
const ev = GITHUB_EVENT_PATH ? JSON.parse(fs.readFileSync(GITHUB_EVENT_PATH, 'utf8')) : {};

async function gh(path, opt = {}) {
  const r = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}${path}`, {
    ...opt, headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
  });
  if (!r.ok) throw new Error(`GitHub ${r.status} ${path}`);
  return r.status === 204 ? null : r.json();
}
const MARK = /<!--kitapligim (\{.*?\})-->/;
const meta = body => { try { return JSON.parse(MARK.exec(body || '')?.[1] || '{}'); } catch { return {}; } };
const plain = body => (body || '').replace(MARK, '').trim();

// Abonelikler
const subs = [];
for (let p = 1; p < 10; p++) {
  const list = await gh(`/issues?state=open&per_page=100&page=${p}`);
  for (const i of list) {
    if (!/^bildirim:/.test(i.title || '')) continue;
    try { subs.push({ ...JSON.parse(i.body), issue: i.number }); } catch { /* bozuk kayıt */ }
  }
  if (list.length < 100) break;
}
console.log(`${subs.length} abonelik`);

let sent = 0;
async function send(sub, payload) {
  try {
    await webpush.sendNotification(sub.sub, JSON.stringify(payload), { TTL: 6 * 3600 });
    sent++;
  } catch (e) {
    console.log(`Gönderilemedi (#${sub.issue}): ${e.statusCode || e.message}`);
    if (e.statusCode === 404 || e.statusCode === 410) await gh(`/issues/${sub.issue}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) }).catch(() => {});
  }
}
const admins = subs.filter(s => s.role === 'admin'), guests = subs.filter(s => s.role !== 'admin');

const REMIND = [
  'Bugün birkaç sayfa okumaya ne dersin? 📖',
  'Kitabın seni bekliyor, kaldığın yerden devam et ✨',
  'Günlük okuma hedefin için birkaç dakika ayır 🎯',
  'Bir bölüm daha? Hikâye seni bekliyor 📚',
];

if (GITHUB_EVENT_NAME === 'schedule' || GITHUB_EVENT_NAME === 'workflow_dispatch') {
  const now = new Date();
  for (const s of subs) {
    if (s.remindHour == null || s.remindHour === '') continue;
    const local = new Date(now.getTime() - (Number(s.tzOffset) || 0) * 60000);
    if (GITHUB_EVENT_NAME === 'schedule' && local.getUTCHours() !== Number(s.remindHour)) continue;
    await send(s, { title: '📖 Okuma zamanı', body: REMIND[local.getUTCDate() % REMIND.length], url: '#/reading', tag: 'hatirlatma' });
  }
} else if (GITHUB_EVENT_NAME === 'push') {
  // Yeni paylaşılan kitaplar
  let before = [];
  try { before = JSON.parse(execSync('git show HEAD~1:kitaplar.json', { encoding: 'utf8', maxBuffer: 1 << 28 })).books || []; } catch { /* ilk yayın */ }
  const after = JSON.parse(fs.readFileSync('kitaplar.json', 'utf8')).books || [];
  // Kişiye özel paylaşım: b.to yoksa herkes, varsa yalnız listedeki kullanıcılar görür
  const sees = (b, s) => !Array.isArray(b.to) || !b.to.length || b.to.includes(s.user) || (!s.user && b.to.includes(String(s.name || '').toLocaleLowerCase('tr')));
  for (const s of guests.filter(x => x.newBooks !== false)) {
    const had = new Set(before.filter(b => sees(b, s)).map(b => b.id));
    const mine = after.filter(b => sees(b, s));
    const added = mine.filter(b => !had.has(b.id));
    const filesBefore = new Set(before.filter(b => sees(b, s) && (b.file || b.file2)).map(b => b.id));
    const newFiles = mine.filter(b => (b.file || b.file2) && !filesBefore.has(b.id) && had.has(b.id));
    if (added.length) {
      const names = added.slice(0, 3).map(b => b.title).join(', ') + (added.length > 3 ? ` ve ${added.length - 3} kitap daha` : '');
      await send(s, { title: added.length > 1 ? `📚 ${added.length} yeni kitap paylaşıldı` : '📚 Yeni kitap paylaşıldı', body: names, url: added.length === 1 ? `#/book/${added[0].id}` : '#/', tag: 'yeni-kitap' });
    }
    if (newFiles.length) await send(s, { title: '📖 Okumaya hazır', body: `${newFiles.slice(0, 3).map(b => b.title).join(', ')} artık uygulamada okunabilir`, url: newFiles.length === 1 ? `#/book/${newFiles[0].id}` : '#/', tag: 'yeni-dosya' });
  }
} else if (GITHUB_EVENT_NAME === 'issues') {
  const i = ev.issue || {}, who = meta(i.body).name || 'Biri';
  if (/^duyuru:/.test(i.title || '') && ev.action === 'opened') {
    const m = meta(i.body), to = m.to;
    const targets = guests.filter(s => to === 'all' || !to || (Array.isArray(to) && (to.includes(s.user) || (!s.user && to.includes(String(s.name || '').toLocaleLowerCase('tr'))))));
    for (const s of targets) await send(s, { title: `📣 ${m.title || 'Kitaplığım'}`, body: plain(i.body).slice(0, 200), url: '#/reading', tag: `duyuru-${i.number}` });
  }
  if (/^istek:/.test(i.title || '')) {
    if (ev.action === 'opened') for (const s of admins.filter(x => x.requests !== false)) await send(s, { title: `💌 ${who} kitap istedi`, body: plain(i.body).slice(0, 160), url: '#/paylasim', tag: `istek-${i.number}` });
    if (ev.action === 'closed') for (const s of guests.filter(x => x.requests !== false && x.name === who)) await send(s, { title: '✅ İsteğin eklendi', body: plain(i.body).slice(0, 160), url: '#/reading', tag: `istek-${i.number}` });
  }
} else if (GITHUB_EVENT_NAME === 'issue_comment') {
  const i = ev.issue || {}, c = ev.comment || {}, who = meta(c.body).name || 'Biri';
  if (/^kitap:/.test(i.title || '') && who !== 'Ben') {
    const id = /^kitap:(\S+)/.exec(i.title)[1], book = i.title.replace(/^kitap:\S+\s*·\s*/, '');
    const st = meta(c.body).stars;
    for (const s of admins.filter(x => x.comments !== false)) await send(s, { title: `💬 ${who} yorum yaptı`, body: `${book}${st ? ` · ${'★'.repeat(st)}` : ''}${plain(c.body) ? ` — ${plain(c.body).slice(0, 140)}` : ''}`, url: `#/book/${id}`, tag: `yorum-${id}` });
  }
  if (/^istek:/.test(i.title || '') && who === 'Ben') {
    const asker = meta(i.body).name;
    for (const s of guests.filter(x => x.requests !== false && x.name === asker)) await send(s, { title: '💌 İsteğine yanıt geldi', body: plain(c.body).slice(0, 160), url: '#/reading', tag: `istek-${i.number}` });
  }
}
console.log(`${sent} bildirim gönderildi`);
