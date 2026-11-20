// Giriş ekranı (kullanıcı adı + şifre), yönetim (paylaşılan kitaplar, kullanıcılar, gelen yorumlar) ve kitap sayfası yorumları.
import { state, getBook, displayTitle } from '../store.js';
import { esc, enc, toast, sheet, confirmSheet, $, $$ } from '../ui.js';

const stars = n => (n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '');
const when = iso => new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });

export async function renderLogin(view, { landing = false } = {}) {
  document.getElementById('tabbar')?.classList.toggle('hidden', landing);
  view.innerHTML = `<div class="login-hero"><div class="big">📚</div><h1>Kitaplığım</h1><p class="muted">Giriş yap</p></div>
    <div class="section"><p class="muted small">Kullanıcı adın ve şifrenle gir.</p>
      <div class="form-group">
        <div class="field"><label for="lg-u">Kullanıcı adı</label><input id="lg-u" autocomplete="username" autocapitalize="off" autocorrect="off"></div>
        <div class="field"><label for="lg-p">Şifre</label><div class="pw-wrap"><input id="lg-p" type="password" autocomplete="current-password"><button type="button" class="pw-eye" id="lg-eye" aria-label="Şifreyi göster">👁</button></div></div>
      </div>
      <button class="btn primary block" id="lg-go">Giriş yap</button>
      <div class="muted small" id="lg-msg" style="margin-top:8px"></div></div>`;
  const go = async () => {
    const btn = $('#lg-go', view), msg = $('#lg-msg', view);
    btn.disabled = true; msg.textContent = 'Kontrol ediliyor…';
    try { await (await import('../share.js')).login($('#lg-u', view).value, $('#lg-p', view).value); history.replaceState(null, '', location.pathname + '#/'); location.reload(); }
    catch (e) { msg.textContent = e.message; btn.disabled = false; }
  };
  $('#lg-go', view).addEventListener('click', go);
  $('#lg-eye', view).addEventListener('click', () => {
    const p = $('#lg-p', view), show = p.type === 'password';
    p.type = show ? 'text' : 'password';
    $('#lg-eye', view).textContent = show ? '🙈' : '👁';
    $('#lg-eye', view).setAttribute('aria-label', show ? 'Şifreyi gizle' : 'Şifreyi göster');
  });
  $('#lg-p', view).addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
}

// Misafir için ayarlar: okuma istatistikleri, görünüm tercihleri, indirilen dosyalar
export async function renderGuestSettings(view, g) {
  const { state: st, saveSettings } = await import('../store.js');
  const { readingStats, formatDuration, formatSize, progressOf } = await import('../files.js');
  const { goalCard, wireGoal } = await import('./reading.js');
  const { applyTheme } = await import('../ui.js');
  const { db } = await import('../db.js');
  const s = st.settings, r = readingStats();
  const books = st.books;
  const reading = books.filter(b => b.status === 'Okunuyor');
  const done = books.filter(b => b.status === 'Okundu');
  const byTime = books.filter(b => b.readingSeconds > 0).sort((a, b) => b.readingSeconds - a.readingSeconds);
  const keys = new Set(await db.allFileKeys());
  const local = books.flatMap(b => [b.file, b.file2]).filter(f => f?.key && keys.has(f.key));
  const localBytes = local.reduce((t, f) => t + (f.size || 0), 0);
  const max = Math.max(...r.last7.map(x => x.sec), 1);
  const days = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
  const sel = (id, cur, opts) => `<select id="${id}">${opts.map(([v, l]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  view.innerHTML = `<div class="page-head"><h1>Ayarlar</h1></div>
    <div class="section"><p>👋 Merhaba <b>${esc(g.name || g.user)}</b></p><p class="muted small">Seninle paylaşılan ${books.length} kitabı görüyorsun. Kitap sayfalarının altından yorum ve yıldız bırakabilirsin.</p></div>

    <h3 style="margin:20px 0 10px">📊 Okuma istatistiklerim</h3>
    ${goalCard()}
    <div class="section"><h3>Okuma süresi</h3>
      <div class="stat-grid" style="margin-bottom:6px;grid-template-columns:repeat(3,1fr)">
        <div><div class="n" style="font:700 22px/1.1 var(--serif)">${formatDuration(r.todaySec)}</div><div class="muted small">Bugün</div></div>
        <div><div class="n" style="font:700 22px/1.1 var(--serif)">${formatDuration(r.weekSec)}</div><div class="muted small">Son 7 gün</div></div>
        <div><div class="n" style="font:700 22px/1.1 var(--serif)">${r.streak ? `🔥 ${r.streak} gün` : '—'}</div><div class="muted small">Art arda okuma</div></div></div>
      <div class="week-bars">${r.last7.map(x => `<div><i class="${x.sec ? '' : 'zero'}" style="height:${x.sec ? Math.max(6, (x.sec / max) * 70) : 3}px" title="${formatDuration(x.sec)}"></i>${days[x.d.getDay()]}</div>`).join('')}</div>
      <div class="muted small" style="margin-top:8px">Bu ay ${formatDuration(r.monthSec)} · ${r.monthDays} gün okudun · Toplam ${formatDuration(r.totalSec)}${r.best > 1 ? ` · En uzun seri ${r.best} gün` : ''}</div></div>
    <div class="stat-grid">
      <div class="stat"><div class="n">${reading.length}</div><div class="l">📖 Okuyorum</div></div>
      <div class="stat"><div class="n">${done.length}</div><div class="l">✅ Okudum</div></div>
      <div class="stat"><div class="n">${books.length - reading.length - done.length}</div><div class="l">📚 Okunacak</div></div></div>
    ${byTime.length ? `<div class="section"><h3>Kitaplarım</h3>${byTime.map(b => { const p = progressOf(b); return `<a class="hbar" href="#/book/${enc(b.id)}"><span>${esc(displayTitle(b))}</span><b>${formatDuration(b.readingSeconds)}</b><div class="track"><span style="width:${p ?? 0}%"></span></div></a>`; }).join('')}<div class="muted small" style="margin-top:6px">Çubuk: kitapta ne kadar ilerlediğin</div></div>` : '<div class="section muted small">Bir kitabı açıp okumaya başlayınca istatistiklerin burada birikir.</div>'}

    <div class="form-group-title">Görünüm</div>
    <div class="form-group">
      <div class="set-row"><span>Tema</span>${sel('g-theme', s.theme || 'auto', [['auto', 'Telefona göre'], ['light', 'Açık'], ['dark', 'Koyu']])}</div>
      <div class="set-row"><span>Kapak olarak göster</span>${sel('g-cover', s.coverPref || 'tr', [['tr', 'Türkçe kapak'], ['orig', 'Orijinal kapak']])}</div>
      <div class="set-row"><span>Orijinal adları göster</span><span class="toggle"><input type="checkbox" id="g-orig" ${s.showOriginal !== false ? 'checked' : ''}><span></span></span></div>
      <div class="set-row"><span>Listede gösterilecek puan</span>${sel('g-score', s.listScore || 'both', [['both', 'İkisi de'], ['romance', '💗 Romantizm'], ['quality', '⭐ Genel']])}</div>
      <div class="set-row"><span>Kitap görünümü</span>${sel('g-view', s.view || 'grid', [['grid', 'Kapaklar'], ['list', 'Liste']])}</div>
    </div>

    <div class="form-group-title">Kitap dosyaları</div>
    <div class="form-group">
      <div class="set-row muted small" style="display:block">📄 Bu telefona indirilen: ${local.length} dosya · ${formatSize(localBytes)}<br>Silinse de kaldığın yer korunur; kitabı yeniden açınca dosya tekrar iner.</div>
      ${local.length ? '<button class="set-row" id="g-clear" style="width:100%;border:0;background:none;text-align:left">🧹 İndirilen dosyaları sil<span class="chev"></span></button>' : ''}
      <button class="set-row" id="g-refresh" style="width:100%;border:0;background:none;text-align:left">🔄 Paylaşılan kitapları yenile<span class="chev"></span></button>
    </div>

    <div class="form-group"><button class="set-row" id="lo" style="width:100%;border:0;background:none;color:var(--danger)">Çıkış yap</button></div>`;
  wireGoal(view);
  const set = (id, fn) => $(id, view).addEventListener('change', async e => { fn(e.target); await saveSettings(); });
  set('#g-theme', t => { s.theme = t.value; applyTheme(); });
  set('#g-cover', t => { s.coverPref = t.value; });
  set('#g-orig', t => { s.showOriginal = t.checked; });
  set('#g-score', t => { s.listScore = t.value; });
  set('#g-view', t => { s.view = t.value; });
  $('#g-clear', view)?.addEventListener('click', async () => {
    if (!(await confirmSheet('İndirilen dosyaları sil', `${local.length} kitap dosyası bu telefondan silinecek. Kaldığın yerler korunur.`, 'Sil'))) return;
    for (const f of local) await db.deleteFile(f.key);
    toast('🧹 Silindi'); renderGuestSettings(view, g);
  });
  $('#g-refresh', view).addEventListener('click', () => location.reload());
  $('#lo', view).addEventListener('click', async () => {
    if (!(await confirmSheet('Çıkış yap', 'Tekrar girmek için kullanıcı adın ve şifren gerekecek.', 'Çıkış yap'))) return;
    (await import('../share.js')).logout();
  });
}

// Kitap sayfası: yorumlar bölümü (misafir ya da paylaşılan kitapta sahip)
export async function fillComments(sec, b, { guestMode }) {
  const sh = await import('../share.js');
  sec.innerHTML = '<h3>💬 Yorumlar</h3><div class="muted small">Yükleniyor…</div>';
  let list = [];
  try { list = await sh.bookComments(b.id); } catch (e) { sec.innerHTML = `<h3>💬 Yorumlar</h3><div class="muted small">${esc(e.message)}</div>`; return; }
  sec.innerHTML = `<h3>💬 Yorumlar${list.length ? ` · ${list.length}` : ''}</h3>
    ${list.length ? list.map(c => `<div class="cm"><div class="cm-h"><b>${esc(c.name)}</b>${c.stars ? ` <span class="cm-st">${stars(c.stars)}</span>` : ''}<span class="muted small">${when(c.at)}</span></div>${c.text ? `<div class="prose">${esc(c.text)}</div>` : ''}</div>`).join('') : '<div class="muted small">Henüz yorum yok.</div>'}
    <div class="cm-new"><div class="stars" id="cm-stars">${[1, 2, 3, 4, 5].map(n => `<button data-r="${n}" aria-label="${n} yıldız">★</button>`).join('')}</div>
      <textarea id="cm-text" placeholder="${guestMode ? 'Bu kitap hakkında ne düşünüyorsun?' : 'Yanıt yaz…'}"></textarea>
      <button class="btn primary" id="cm-send">Gönder</button></div>`;
  let r = 0;
  $$('#cm-stars button', sec).forEach(x => x.addEventListener('click', () => { r = Number(x.dataset.r) === r ? 0 : Number(x.dataset.r); $$('#cm-stars button', sec).forEach(y => y.classList.toggle('on', Number(y.dataset.r) <= r)); }));
  $('#cm-send', sec).addEventListener('click', async () => {
    const text = $('#cm-text', sec).value;
    if (!text.trim() && !r) { toast('Bir yorum yaz ya da yıldız ver'); return; }
    $('#cm-send', sec).disabled = true;
    try { await sh.addComment(b, text, r); toast('💬 Yorum gönderildi'); fillComments(sec, b, { guestMode }); }
    catch (e) { toast(e.message); $('#cm-send', sec).disabled = false; }
  });
}

// Yönetim: paylaşım + kullanıcılar + gelen yorumlar
export async function renderSharingAdmin(view) {
  const sh = await import('../share.js');
  const shared = state.books.filter(b => b.shared);
  view.innerHTML = `<div class="topbar"><a class="icon-btn" href="#/settings" aria-label="Geri">‹</a><div class="title">Paylaşım ve kullanıcılar</div></div>
    <div class="section"><h3>👥 Paylaşılan kitaplar · ${shared.length}</h3>
      <p class="muted small">Kitap sayfasındaki <b>👥 Paylaş</b> düğmesiyle eklenir. Yalnızca kitap bilgileri ve puanlar paylaşılır; notların, puanın, ilerlemen ve dosyaların paylaşılmaz.</p>
      ${shared.length ? `<div class="tags">${shared.map(b => `<a class="tag" href="#/book/${enc(b.id)}">${esc(displayTitle(b))}</a>`).join('')}</div>` : ''}
      <button class="btn" id="pub" style="margin-top:10px">📤 Şimdi yayınla</button></div>
    <div class="section"><h3>🔐 Yönetici girişi</h3>
      <p class="muted small">Yeni bir cihazda kitaplığını açmak için kullanıcı adı ve şifre. Bu cihazdaki GitHub bağlantın bu şifreyle kilitlenir; şifreyi kimseyle paylaşma.</p>
      <button class="btn" id="add-admin">🔐 Yönetici hesabı oluştur / şifreyi değiştir</button></div>
    <div class="section"><h3>🔑 Kullanıcılar</h3><div id="users" class="muted small">Yükleniyor…</div>
      <button class="btn primary" id="add-user" style="margin-top:10px">＋ Kullanıcı ekle</button></div>
    <div class="section"><h3>💬 Gelen yorumlar</h3><div id="recent" class="muted small">Yükleniyor…</div></div>`;
  $('#pub', view).addEventListener('click', async () => { try { await sh.publishShare(); toast('📤 Paylaşım güncellendi'); } catch (e) { toast(e.message); } });
  const loadUsers = async () => {
    try {
      const u = await sh.listUsers();
      const keys = Object.keys(u);
      $('#users', view).innerHTML = keys.length ? keys.map(k => `<div class="opt-item"><span class="lbl">${u[k].role === 'admin' ? '🔐' : '👤'} <b>${esc(k)}</b> · ${esc(u[k].role === 'admin' ? 'Yönetici' : u[k].name || '')}</span><button class="del" data-del="${esc(k)}" aria-label="Sil">🗑</button></div>`).join('') : 'Henüz kullanıcı yok.';
      $$('[data-del]', view).forEach(x => x.addEventListener('click', async () => {
        if (!(await confirmSheet('Kullanıcıyı sil', `${x.dataset.del} artık giriş yapamaz. Erişimi tamamen kapatmak için GitHub'da onun davet anahtarını da sil.`, 'Sil'))) return;
        try { await sh.deleteUser(x.dataset.del); toast('Silindi'); loadUsers(); } catch (e) { toast(e.message); }
      }));
    } catch (e) { $('#users', view).textContent = e.message; }
  };
  loadUsers();
  $('#add-user', view).addEventListener('click', () => openAddUser(sh, loadUsers));
  $('#add-admin', view).addEventListener('click', () => openAddAdmin(sh, loadUsers));
  try {
    const rc = await sh.recentComments();
    $('#recent', view).innerHTML = rc.length ? rc.map(c => { const b = getBook(c.bookId); return `<a class="cm" href="${b ? `#/book/${enc(b.id)}` : '#'}" style="display:block;color:inherit"><div class="cm-h"><b>${esc(c.name)}</b>${c.stars ? ` <span class="cm-st">${stars(c.stars)}</span>` : ''}<span class="muted small">${when(c.at)}</span></div><div class="small"><b>${esc(b ? displayTitle(b) : 'Kitap')}</b>${c.text ? ` — ${esc(c.text.slice(0, 140))}` : ''}</div></a>`; }).join('') : 'Henüz yorum yok.';
  } catch (e) { $('#recent', view).textContent = e.message; }
}

function genPassword() {
  const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const r = crypto.getRandomValues(new Uint8Array(14));
  return [...r].map(x => a[x % a.length]).join('');
}

function openAddUser(sh, done) {
  sheet({
    title: 'Kullanıcı ekle',
    body: `<div class="form-group">
        <div class="field"><label for="u-name">Görünen ad</label><input id="u-name" placeholder="örn. Ayşe"></div>
        <div class="field"><label for="u-user">Kullanıcı adı</label><input id="u-user" autocapitalize="off" autocorrect="off" placeholder="örn. ayse"></div>
        <div class="field"><label for="u-pass">Şifre (en az 12 karakter)</label><input id="u-pass" value="${genPassword()}"><button class="mini-btn" id="u-gen" type="button" style="margin-top:6px">🎲 Yeni şifre üret</button></div>
        <div class="field"><label for="u-tok">Davet anahtarı (GitHub)</label><input id="u-tok" placeholder="github_pat_…" autocapitalize="off" autocorrect="off"></div></div>
      <details class="small"><summary><b>Davet anahtarı nasıl oluşturulur?</b></summary><ol class="muted" style="padding-left:18px">
        <li>github.com → Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → Generate new token.</li>
        <li>Ad: arkadaşının adı · Süre: istediğin kadar.</li>
        <li>Repository access: <b>Only select repositories</b> → yalnızca <b>bookticker-share</b>.</li>
        <li>Permissions → Repository: <b>Contents: Read-only</b>, <b>Issues: Read and write</b> (Metadata otomatik gelir).</li>
        <li>Generate → çıkan anahtarı buraya yapıştır. Anahtar şifreyle kilitlenir; arkadaşına yalnızca kullanıcı adı ve şifreyi ver.</li></ol></details>`,
    foot: '<button class="btn" data-close>Vazgeç</button><button class="btn primary" id="u-save">Oluştur</button>',
    onMount: (el, close) => {
      $('#u-gen', el).addEventListener('click', () => { $('#u-pass', el).value = genPassword(); });
      $('#u-save', el).addEventListener('click', async () => {
        const btn = $('#u-save', el); btn.disabled = true; btn.textContent = 'Oluşturuluyor…';
        const v = id => $(id, el).value;
        try {
          await sh.createUser({ username: v('#u-user'), name: v('#u-name'), password: v('#u-pass'), guestToken: v('#u-tok') });
          close(); done();
          sheet({ title: 'Kullanıcı hazır', body: `<p>Arkadaşına şunları gönder:</p><div class="section"><b>Adres:</b> ${esc(location.origin + location.pathname)}<br><b>Kullanıcı adı:</b> ${esc(v('#u-user').trim().toLowerCase())}<br><b>Şifre:</b> ${esc(v('#u-pass'))}</div><p class="muted small">Uygulamayı açınca Ayarlar → <b>Kullanıcı girişi</b>. Girişin çalışması 1–2 dakika sürebilir (GitHub Pages güncellenirken).</p>`, foot: '<button class="btn primary" data-close>Tamam</button>' });
        } catch (e) { toast(e.message); btn.disabled = false; btn.textContent = 'Oluştur'; }
      });
    },
  });
}

function openAddAdmin(sh, done) {
  sheet({
    title: 'Yönetici hesabı',
    body: `<div class="form-group">
        <div class="field"><label for="a-user">Kullanıcı adı</label><input id="a-user" autocapitalize="off" autocorrect="off" placeholder="örn. yonetici"></div>
        <div class="field"><label for="a-pass">Şifre (en az 14 karakter)</label><input id="a-pass" value="${genPassword()}${genPassword().slice(0, 4)}"><button class="mini-btn" id="a-gen" type="button" style="margin-top:6px">🎲 Yeni şifre üret</button></div></div>
      <p class="muted small">Şifreyi bir yere not et (örneğin iPhone Parolalar). Unutursan bu ekrandan yenisini oluşturursun.</p>`,
    foot: '<button class="btn" data-close>Vazgeç</button><button class="btn primary" id="a-save">Kaydet</button>',
    onMount: (el, close) => {
      $('#a-gen', el).addEventListener('click', () => { $('#a-pass', el).value = genPassword() + genPassword().slice(0, 4); });
      $('#a-save', el).addEventListener('click', async () => {
        const btn = $('#a-save', el); btn.disabled = true;
        try { await sh.createAdmin({ username: $('#a-user', el).value, password: $('#a-pass', el).value }); close(); done(); toast('🔐 Yönetici hesabı kaydedildi'); }
        catch (e) { toast(e.message); btn.disabled = false; }
      });
    },
  });
}
