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
        <div class="field"><label for="lg-p">Şifre</label><input id="lg-p" type="password" autocomplete="current-password"></div>
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
  $('#lg-p', view).addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
}

// Misafir için sade ayarlar
export function renderGuestSettings(view, g) {
  view.innerHTML = `<div class="page-head"><h1>Ayarlar</h1></div>
    <div class="section"><p>Giriş yapan: <b>${esc(g.name || g.user)}</b></p><p class="muted small">Seninle paylaşılan ${state.books.length} kitabı görüyorsun. Kitap sayfalarının altından yorum ve yıldız bırakabilirsin.</p>
      <button class="btn block" id="lo">Çıkış yap</button></div>`;
  $('#lo', view).addEventListener('click', async () => (await import('../share.js')).logout());
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
