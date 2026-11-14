// Çıkış takvimi: Türkçe çıkış tarihi gelecekte olanlar ve orijinali bu yıl/ileride çıkacak kitaplar.
import { state, today, formatPubDate, saveSettings, displayTitle } from '../store.js';
import { esc, bookRow, hydrateCovers, toast, $ } from '../ui.js';

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

export function renderUpcoming(view) {
  const { tr, orig } = upcomingLists();
  const byYear = orig.reduce((m, b) => ((m[b.pubYear] ||= []).push(b), m), {});
  const byMonth = tr.reduce((m, b) => { const k = String(b.trDate).slice(0, 7); (m[k] ||= []).push(b); return m; }, {});
  view.innerHTML = `
    <div class="topbar"><button class="icon-btn" data-back aria-label="Geri"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button><div class="title">📅 Çıkış takvimi</div></div>
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
