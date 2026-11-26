// Çıkış takvimi: Türkçe çıkış tarihi gelecekte olanlar ve orijinali bu yıl/ileride çıkacak kitaplar.
import { state, today, formatPubDate, saveSettings, displayTitle } from '../store.js';
import { esc, enc, bookRow, hydrateCovers, toast, $, $$ } from '../ui.js';
import * as N from '../news.js';

const DATE = /^\d{4}(-\d{2}(-\d{2})?)?$/;
const thisYear = () => new Date().getFullYear();

export function upcomingLists() {
  const t = today();
  const tr = state.books.filter(b => DATE.test(String(b.trDate || '')) && String(b.trDate) > t)
    .sort((a, b) => String(a.trDate).localeCompare(String(b.trDate)));
  const orig = state.books.filter(b => Number(b.pubYear) >= thisYear() && !['Okundu', 'Elendi'].includes(b.status))
    .sort((a, b) => Number(a.pubYear) - Number(b.pubYear) || String(a.series || '').localeCompare(String(b.series || '')));
  return { tr, orig };
}

export const upcomingCount = () => { const { tr, orig } = upcomingLists(); return new Set([...tr, ...orig].map(b => b.id)).size; };

function newsHTML() {
  const info = N.newsInfo();
  const items = N.newsItems();
  if (!info) return '';
  const ser = items.filter(i => i.type === 'series'), trs = items.filter(i => i.type === 'tr');
  const img = u => (u ? `<img class="nw-img" src="${esc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<div class="nw-img"></div>');
  const when = new Date(info.updatedAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
  return `<div class="section nw">
    <h3 style="margin-bottom:4px">🆕 Yenilikler</h3>
    <p class="small muted" style="margin:0 0 10px">Son denetim: ${esc(when)}${info.partial ? ' (yarım kaldı, gelecek ay devam eder)' : ''} · ayda bir otomatik</p>
    ${!items.length ? '<p class="small muted" style="margin:0">Şimdilik yeni bir şey yok.</p>' : ''}
    ${ser.length ? `<div class="small" style="margin:6px 0"><b>Serilerine yeni kitap</b></div>${ser.map(i => `<div class="nw-row" data-key="${esc(i.key)}">${img(i.img)}
      <div class="body"><div class="t">${esc(N.newsTitle(i.title))}</div><div class="small muted">${esc(i.series)} #${i.order}${i.date ? ` · ${esc(i.date)}` : ''}${i.avg && Number(i.avg) > 0 ? ` · ★ ${esc(String(i.avg).replace('.', ','))}` : ''}</div>
        <div class="btn-row" style="margin-top:6px"><button class="mini-btn" data-add="${esc(i.key)}">＋ Listeye ekle</button><a class="mini-btn" href="${esc(i.url)}" target="_blank" rel="noopener">Goodreads</a><button class="mini-btn" data-hide="${esc(i.key)}">Gizle</button></div></div></div>`).join('')}` : ''}
    ${trs.length ? `<div class="small" style="margin:12px 0 6px"><b>Türkçesi çıkmış olabilir</b></div>${trs.map(i => `<div class="nw-row" data-key="${esc(i.key)}">${img(i.img)}
      <div class="body"><div class="t"><a href="#/book/${enc(i.bookId)}">${esc(N.titleOfBook(i.bookId))}</a></div><div class="small muted">🇹🇷 ${esc(N.newsTitle(i.title))}${i.publisher ? ` · ${esc(i.publisher)}` : ''}${i.date ? ` · ${esc(i.date)}` : ''}</div>
        <div class="btn-row" style="margin-top:6px"><button class="mini-btn" data-apply="${esc(i.key)}">✓ Türkçesi var olarak işle</button><a class="mini-btn" href="${esc(i.url)}" target="_blank" rel="noopener">Baskıyı gör</a><button class="mini-btn" data-hide="${esc(i.key)}">Yanlış · gizle</button></div></div></div>`).join('')}
      <p class="small muted" style="margin:6px 0 0">İşlersen çeviri durumu "Var" olur; Türkçe ad, yayınevi, tarih ve kapak yalnızca boşsa doldurulur.</p>` : ''}
  </div>`;
}

function wireNews(view, redraw) {
  const find = k => N.newsItems().find(i => i.key === k);
  $$('[data-hide]', view).forEach(x => x.addEventListener('click', async () => { await N.dismiss(x.dataset.hide); redraw(); }));
  $$('[data-add]', view).forEach(x => x.addEventListener('click', async () => { const i = find(x.dataset.add); if (!i) return; const b = await N.addSeriesItem(i); toast(`"${displayTitle(b)}" listeye eklendi`); redraw(); }));
  $$('[data-apply]', view).forEach(x => x.addEventListener('click', async () => { const i = find(x.dataset.apply); if (!i) return; const b = await N.applyTrItem(i); toast(`"${displayTitle(b)}" Türkçesi var olarak işlendi`); redraw(); }));
}

export function renderUpcoming(view) {
  drawUpcoming(view);
  const before = N.newsInfo()?.updatedAt;
  N.loadNews().then(() => { if (view.isConnected && location.hash.startsWith('#/upcoming') && N.newsInfo()?.updatedAt !== before) drawUpcoming(view); });
}

function drawUpcoming(view) {
  const { tr, orig } = upcomingLists();
  const byYear = orig.reduce((m, b) => ((m[b.pubYear] ||= []).push(b), m), {});
  const byMonth = tr.reduce((m, b) => { const k = String(b.trDate).slice(0, 7); (m[k] ||= []).push(b); return m; }, {});
  view.innerHTML = `
    <div class="topbar"><button class="icon-btn" data-back aria-label="Geri"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button><div class="title">📅 Çıkış takvimi</div></div>
    ${newsHTML()}
    ${!tr.length && !orig.length ? `<div class="empty"><div class="big">📅</div><h2>Yakında çıkacak kitap yok</h2><p>Kitap düzenleme ekranında <b>Türkçe çıkış tarihi</b> (örn. 2027-03 ya da 2027-03-15) ya da gelecek bir <b>yayın yılı</b> girersen burada görünür; tarihi gelince haber veririm.</p></div>` : ''}
    ${tr.length ? `<h3 style="margin:8px 0">🇹🇷 Türkçe çıkışlar</h3>${Object.entries(byMonth).map(([m, list]) => `
      <div class="muted small" style="margin:10px 0 6px">${esc(formatPubDate(m))}</div>
      <div class="list">${list.map(b => bookRow(b, { sub: `${b.author || ''} · 📅 ${formatPubDate(b.trDate)}` })).join('')}</div>`).join('')}` : ''}
    ${orig.length ? `<h3 style="margin:18px 0 8px">🌐 Orijinal çıkışlar</h3>${Object.entries(byYear).map(([y, list]) => `
      <div class="muted small" style="margin:10px 0 6px">${Number(y) === thisYear() ? `Bu yıl (${y})` : y}</div>
      <div class="list">${list.map(b => bookRow(b)).join('')}</div>`).join('')}
      <div class="muted small" style="margin-top:8px">Orijinal çıkışlarda yalnızca yıl biliniyor; kesin tarih için kitabı düzenleyip Türkçe çıkış tarihi alanını kullanabilirsin.</div>` : ''}`;
  $('[data-back]', view).addEventListener('click', () => { if ((window.__navCount || 0) > 1) history.back(); else location.hash = '#/reading'; });
  hydrateCovers?.(view);
  wireNews(view, () => drawUpcoming(view));
}

// Uygulama açılışında: Türkçe çıkış tarihi gelen (ya da son bakıştan beri geçen) kitapları haber ver
export async function checkReleases() {
  const t = today();
  const last = state.settings.releaseChecked || t;
  const due = state.books.filter(b => DATE.test(String(b.trDate || '')) && String(b.trDate) <= t && String(b.trDate) > last);
  if (state.settings.releaseChecked !== t) { state.settings.releaseChecked = t; await saveSettings(); }
  if (due.length) toast(due.length === 1 ? `📅 "${displayTitle(due[0])}" Türkçe olarak çıktı!` : `📅 ${due.length} kitap Türkçe olarak çıktı: ${due.slice(0, 3).map(displayTitle).join(', ')}`);
  return due;
}
