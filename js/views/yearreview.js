// Yıllık özet: yıl içinde biten kitaplar, okuma süresi, türler, yazarlar, en sevilenler, aylık dağılım;
// paylaşılabilir görsel (PNG) üretir.
import { state, computeScore, displayTitle, CRITERIA } from '../store.js';
import { esc, enc, toast, $ } from '../ui.js';
import { formatDuration } from '../files.js';

const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

export function yearStats(year) {
  const y = String(year);
  const done = state.books.filter(b => b.status === 'Okundu' && String(b.endDate || '').startsWith(y))
    .sort((a, b) => String(a.endDate).localeCompare(String(b.endDate)));
  const log = state.settings.readLog || {};
  const days = Object.entries(log).filter(([k]) => k.startsWith(y));
  const seconds = days.reduce((t, [, v]) => t + (v || 0), 0);
  const readDays = days.filter(([, v]) => v >= 60).length;
  const count = (arr, f) => Object.entries(arr.reduce((m, b) => { for (const k of [].concat(f(b) || [])) if (k) m[k] = (m[k] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]);
  const genres = count(done, b => b.genre);
  const authors = count(done, b => b.author);
  const series = count(done, b => b.series);
  const tags = count(done, b => b.tags || []);
  const rated = done.filter(b => typeof b.myRating === 'number');
  const avgRating = rated.length ? rated.reduce((t, b) => t + b.myRating, 0) / rated.length : null;
  const best = done.slice().sort((a, b) => (b.myRating ?? -1) - (a.myRating ?? -1) || (computeScore(b) ?? 0) - (computeScore(a) ?? 0)).slice(0, 5);
  const spicy = done.filter(b => typeof b.spicy === 'number');
  const avgSpicy = spicy.length ? spicy.reduce((t, b) => t + b.spicy, 0) / spicy.length : null;
  const perMonth = MONTHS.map((_, i) => done.filter(b => Number(String(b.endDate).slice(5, 7)) === i + 1).length);
  const fromTime = new Date(`${y}-01-01T00:00`).getTime(), toTime = new Date(`${Number(y) + 1}-01-01T00:00`).getTime();
  const inYear = t => t >= fromTime && t < toTime;
  const words = state.books.reduce((n, b) => n + (b.vocab || []).filter(v => inYear(v.at)).length, 0);
  const highlights = state.books.reduce((n, b) => n + [...(b.highlights || []), ...(b.highlights2 || [])].filter(h => inYear(h.at)).length, 0);
  // En uzun seri (yıl içinde, ≥1 dk)
  let bestRun = 0, run = 0, prev = null;
  for (const [k] of days.filter(([, v]) => v >= 60).sort()) {
    const d = new Date(`${k}T12:00`); run = prev && Math.round((d - prev) / 864e5) === 1 ? run + 1 : 1; bestRun = Math.max(bestRun, run); prev = d;
  }
  // En çok hangi kriterler yüksek (biten kitapların ortalaması)
  const critAvg = CRITERIA.map(c => { const v = done.map(b => b.scores?.[c.key]).filter(x => typeof x === 'number'); return { c, avg: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }; }).filter(x => x.avg != null).sort((a, b) => b.avg - a.avg);
  return { year: Number(y), done, seconds, readDays, genres, authors, series, tags, avgRating, best, avgSpicy, perMonth, words, highlights, bestRun, critAvg };
}

export const yearsWithData = () => {
  const ys = new Set(state.books.filter(b => b.status === 'Okundu' && /^\d{4}/.test(String(b.endDate || ''))).map(b => Number(String(b.endDate).slice(0, 4))));
  Object.keys(state.settings.readLog || {}).forEach(k => ys.add(Number(k.slice(0, 4))));
  ys.add(new Date().getFullYear());
  return [...ys].filter(Boolean).sort((a, b) => b - a);
};

export function renderYear(view, [yr]) {
  const year = Number(yr) || new Date().getFullYear();
  const s = yearStats(year);
  const maxM = Math.max(1, ...s.perMonth);
  const years = yearsWithData();
  view.innerHTML = `
    <div class="topbar"><button class="icon-btn" data-back aria-label="Geri"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button><div class="title">🗓 ${year} özetim</div>
      <button class="mini-btn" id="yr-share">📤 Paylaş</button></div>
    ${years.length > 1 ? `<div class="chip-wrap" style="margin-bottom:10px">${years.map(y => `<a class="chip ${y === year ? 'on' : ''}" href="#/year/${y}">${y}</a>`).join('')}</div>` : ''}
    <div class="year-hero"><div class="n">${s.done.length}</div><div>kitap bitirdim</div>
      <div class="year-sub">${s.seconds ? `⏱ ${formatDuration(s.seconds)} · ` : ''}${s.readDays ? `📆 ${s.readDays} gün okudum` : ''}${s.bestRun > 1 ? ` · 🔥 en uzun seri ${s.bestRun} gün` : ''}</div></div>
    <div class="section"><h3>Aylara göre</h3><div class="month-bars">${s.perMonth.map((n, i) => `<div><span class="v">${n || ''}</span><i style="height:${n ? Math.max(6, (n / maxM) * 70) : 3}px" class="${n ? '' : 'zero'}"></i>${MONTHS[i]}</div>`).join('')}</div></div>
    ${s.best.length ? `<div class="section"><h3>⭐ En sevdiklerim</h3><div class="list" style="box-shadow:none;margin:0 -14px">${s.best.map((b, i) => `<a class="row" href="#/book/${enc(b.id)}"><b style="width:22px;text-align:center">${i + 1}</b><div class="body"><div class="t">${esc(displayTitle(b))}</div><div class="s">${esc(b.author || '')}${typeof b.myRating === 'number' ? ` · ★ ${String(b.myRating).replace('.', ',')}` : ''}</div></div></a>`).join('')}</div></div>` : ''}
    <div class="stat-grid" style="grid-template-columns:repeat(2,1fr)">
      ${s.avgRating != null ? `<div class="stat"><div class="n">★ ${s.avgRating.toFixed(1).replace('.', ',')}</div><div class="l">ortalama puanım</div></div>` : ''}
      ${s.avgSpicy != null ? `<div class="stat"><div class="n">🌶️ ${s.avgSpicy.toFixed(1).replace('.', ',')}</div><div class="l">ortalama spicy</div></div>` : ''}
      ${s.words ? `<div class="stat"><div class="n">📒 ${s.words}</div><div class="l">deftere eklenen kelime</div></div>` : ''}
      ${s.highlights ? `<div class="stat"><div class="n">🖍 ${s.highlights}</div><div class="l">vurgu ve not</div></div>` : ''}
    </div>
    ${s.genres.length ? `<div class="section"><h3>Türler</h3>${s.genres.slice(0, 6).map(([g, n]) => `<div class="taste-row"><span>${esc(g)}</span><div class="progress" style="flex:1;height:8px"><span style="width:${(n / s.done.length) * 100}%"></span></div><b class="small">${n}</b></div>`).join('')}</div>` : ''}
    ${s.authors.length ? `<div class="section"><h3>En çok okuduğum yazarlar</h3><div class="small">${s.authors.slice(0, 6).map(([a, n]) => `<b>${esc(a)}</b> (${n})`).join(' · ')}</div>
      ${s.series.length ? `<h3 style="margin-top:12px">Seriler</h3><div class="small">${s.series.slice(0, 6).map(([a, n]) => `${esc(a)} (${n})`).join(' · ')}</div>` : ''}</div>` : ''}
    ${s.critAvg.length ? `<div class="section"><h3>Okuduklarımın güçlü yanı</h3><div class="small">${s.critAvg.slice(0, 3).map(x => `${esc(x.c.title || x.c.label)} ${x.avg.toFixed(1).replace('.', ',')}`).join(' · ')}</div></div>` : ''}
    ${!s.done.length && !s.seconds ? `<div class="empty"><p>${year} için henüz veri yok. Kitapları "Okundu" yaptıkça ve uygulamada okudukça burası dolacak.</p></div>` : ''}`;
  $('[data-back]', view).addEventListener('click', () => { if ((window.__navCount || 0) > 1) history.back(); else location.hash = '#/reading'; });
  $('#yr-share', view).addEventListener('click', () => shareImage(s));
}

// Paylaşılabilir görsel (1080×1350)
async function shareImage(s) {
  const W = 1080, H = 1350, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, W, H); grad.addColorStop(0, '#5b2a47'); grad.addColorStop(1, '#2a1630');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  g.fillStyle = '#fff'; g.textAlign = 'center';
  const font = (w, px, fam = 'Georgia, serif') => { g.font = `${w} ${px}px ${fam}`; };
  font('700', 54); g.fillText(`${s.year} okuma yılım`, W / 2, 140);
  font('700', 230); g.fillText(String(s.done.length), W / 2, 400);
  font('400', 46, '-apple-system, Helvetica, Arial, sans-serif'); g.fillText('kitap bitirdim', W / 2, 470);
  const facts = [s.seconds ? `⏱ ${formatDuration(s.seconds)} okuma` : '', s.readDays ? `📆 ${s.readDays} gün` : '', s.bestRun > 1 ? `🔥 ${s.bestRun} gün seri` : ''].filter(Boolean).join('   ');
  font('400', 36, '-apple-system, Helvetica, Arial, sans-serif'); g.fillText(facts, W / 2, 545);
  g.textAlign = 'left';
  let y = 650;
  if (s.best.length) {
    font('700', 40, '-apple-system, Helvetica, Arial, sans-serif'); g.fillText('⭐ En sevdiklerim', 90, y); y += 60;
    font('400', 36, 'Georgia, serif');
    for (const [i, b] of s.best.slice(0, 5).entries()) {
      let t = `${i + 1}. ${displayTitle(b)}`;
      while (g.measureText(t).width > W - 180 && t.length > 4) t = t.slice(0, -2);
      if (t !== `${i + 1}. ${displayTitle(b)}`) t += '…';
      g.fillText(t, 90, y); y += 54;
    }
  }
  y += 30;
  font('400', 34, '-apple-system, Helvetica, Arial, sans-serif');
  if (s.genres.length) { g.fillText(`📚 En çok: ${s.genres.slice(0, 3).map(x => x[0]).join(', ')}`, 90, y); y += 54; }
  if (s.authors[0]) { g.fillText(`✍️ ${s.authors[0][0]} (${s.authors[0][1]} kitap)`, 90, y); y += 54; }
  if (s.avgRating != null) { g.fillText(`★ Ortalama puanım ${s.avgRating.toFixed(1).replace('.', ',')}`, 90, y); y += 54; }
  // aylık çubuklar
  const maxM = Math.max(1, ...s.perMonth), bx = 90, bw = (W - 180) / 12, base = H - 90;
  s.perMonth.forEach((n, i) => {
    const h = n ? Math.max(8, (n / maxM) * 120) : 4;
    g.fillStyle = n ? '#f2b8d4' : 'rgba(255,255,255,.25)';
    g.fillRect(bx + i * bw + 8, base - h, bw - 16, h);
  });
  g.fillStyle = 'rgba(255,255,255,.6)'; g.textAlign = 'center'; font('400', 22, '-apple-system, Helvetica, Arial, sans-serif');
  MONTHS.forEach((m, i) => g.fillText(m, bx + i * bw + bw / 2, base + 32));
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const file = new File([blob], `okuma-yilim-${s.year}.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: `${s.year} okuma yılım` }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast('🖼 Görsel indirildi');
}
