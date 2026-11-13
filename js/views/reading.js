// Okuma: şu an okunanlar, sıradaki kitap önerisi, öncelik sırası, istatistik.
import { state, computeScore, booksInSeries, displayTitle, statusInfo, genreColor, saveBooks, saveSettings, norm } from '../store.js';
import { esc, enc, coverHTML, bookCard, hydrateCovers, sheet, toast, $, $$ } from '../ui.js';
import { readingStats, formatDuration, progressOf } from '../files.js';
import { tasteRecommendations } from '../similar.js';

const DONE = new Set(['Okundu', 'Elendi', 'Yarım bırakıldı']);
const hasTurkish = b => !b.translation || b.translation === 'Var';

// Okuma kurallarına göre öneri puanı ve gerekçesi.
export function suggestions(limit = 5) {
  const out = [];
  for (const b of state.books) {
    if (b.status !== 'Okunacak') continue;
    if (!hasTurkish(b)) continue;
    let pts = (computeScore(b) ?? 2.5) * 10;
    let why = [];
    if (b.series) {
      const s = booksInSeries(b.series);
      const idx = s.findIndex(x => x.id === b.id);
      const before = s.slice(0, idx);
      if (before.some(x => !DONE.has(x.status))) continue; // önceki kitap okunmadan sonrakini önerme
      if (before.some(x => x.status === 'Okundu')) { pts += 60; why.push('başladığın seriye devam'); }
      else if (idx === 0) why.push('yeni bir serinin ilk kitabı');
    }
    if (b.priority) { pts += 200 - b.priority; why.unshift(`öncelik sıranda #${b.priority}`); }
    const sc = computeScore(b);
    if (sc !== null) why.push(`uyum ${sc.toFixed(1)}`);
    if (b.translation === 'Var') why.push('Türkçesi var');
    out.push({ b, pts, why: why.join(' · ') });
  }
  return out.sort((x, y) => y.pts - x.pts).slice(0, limit);
}

export async function renderReading(view) {
  const reading = state.books.filter(b => b.status === 'Okunuyor');
  const sugg = suggestions(6);
  const taste = tasteRecommendations(10).filter(t => !sugg.some(s => s.b.id === t.b.id));
  const queue = state.books.filter(b => b.priority && !DONE.has(b.status)).sort((a, b) => a.priority - b.priority);
  const year = new Date().getFullYear();
  const readThisYear = state.books.filter(b => b.status === 'Okundu' && (b.endDate || '').startsWith(String(year)));
  const goal = Number(state.settings.yearlyGoal) || 0;

  const counts = {};
  for (const b of state.books) counts[b.status] = (counts[b.status] || 0) + 1;
  const genres = {};
  for (const b of state.books) if (b.genre) genres[b.genre] = (genres[b.genre] || 0) + 1;
  const maxG = Math.max(1, ...Object.values(genres));
  const total = state.books.length;
  const rated = state.books.filter(b => b.myRating);
  const avgMine = rated.length ? (rated.reduce((s, b) => s + b.myRating, 0) / rated.length).toFixed(1) : '—';
  const trMissing = state.books.filter(b => b.status !== 'Okundu' && b.translation && b.translation !== 'Var').length;

  if (!total) {
    view.innerHTML = `<div class="page-head"><h1>Okuma</h1></div><div class="empty"><div class="big">📖</div><h2>Henüz kitap yok</h2><p>Kitap ekledikçe burada sıradaki kitap önerilerini ve istatistiklerini göreceksin.</p><a class="btn primary" href="#/edit/new">Kitap ekle</a></div>`;
    return;
  }

  const top = sugg[0];
  view.innerHTML = `
    <div class="page-head"><h1>Okuma</h1></div>
    <div class="tip" style="margin-bottom:18px"><span style="font-size:26px">🤖</span>
      <button id="ask-open" style="border:0;background:none;text-align:left;padding:0;flex:1"><b>Asistana sor</b><br><span class="small">Kitaplığın ve notlarınla Claude, ChatGPT ya da Gemini'ye sor →</span></button>
      <button class="mini-btn" id="ask-import-btn" title="Asistanın önerilerini listeye ekle">📥</button></div>
    ${reading.length ? `<h3 style="margin-bottom:8px">Şu an okuduğun</h3><div class="list" style="margin-bottom:18px">${reading.map(b => {
      const pct = progressOf(b);
      return `<div class="row"><a href="#/book/${enc(b.id)}" style="display:contents">${coverHTML(b, { badge: false })}
        <div class="body"><div class="t">${esc(displayTitle(b))}</div><div class="s">${esc(b.author || '')}${b.readingSeconds ? ` · ⏱ ${formatDuration(b.readingSeconds)}` : ''}</div>
        ${pct != null ? `<div class="progress"><span style="width:${pct}%"></span></div><div class="s">%${Math.floor(pct)}${b.progress?.page && b.progress?.pages ? ` · sayfa ${b.progress.page}/${b.progress.pages}` : ''}</div>` : ''}</div></a>
        ${b.file ? `<a class="mini-btn" href="#/read/${enc(b.id)}">📖 Devam</a>` : ''}</div>`;
    }).join('')}</div>` : ''}
    ${top ? `<a class="next-card" href="#/book/${enc(top.b.id)}">${coverHTML(top.b, { badge: false })}
      <div><div class="lbl">Sıradaki kitap önerisi</div><div class="t">${esc(displayTitle(top.b))}</div><div class="small">${esc(top.b.author || '')}</div><div class="why">${esc(top.why)}</div></div></a>` : ''}
    ${sugg.length > 1 ? `<h3 style="margin-bottom:8px">Diğer öneriler</h3><div class="strip" style="margin:0 -16px 20px;padding:2px 16px 4px">${sugg.slice(1).map(s => bookCard(s.b)).join('')}</div>` : ''}
    ${taste.length ? `<h3 style="margin-bottom:8px">Zevkine göre</h3><div class="strip" style="margin:0 -16px 20px;padding:2px 16px 4px">${taste.map(t => bookCard(t.b, '', `${displayTitle(t.because)} sevdiğin için`)).join('')}</div>` : ''}

    <div class="section"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><h3 style="margin:0">Öncelik sıram</h3><button class="mini-btn" id="add-q">＋ Ekle</button></div>
      ${queue.length ? `<div class="list" id="queue" style="box-shadow:none;margin:0 -14px -14px">${queue.map((b, i) => `
        <div class="row queue-row" data-id="${esc(b.id)}"><span class="handle" aria-label="Sürükle">≡</span><span class="num">${i + 1}</span>
          <a class="body" href="#/book/${enc(b.id)}"><div class="t">${esc(displayTitle(b))}</div><div class="s">${esc(b.author || '')} · ${statusInfo(b.status).emoji} ${esc(b.status)}${!hasTurkish(b) ? ' · ⚠️ Türkçe: ' + esc(b.translation) : ''}</div></a>
          <button class="icon-btn" data-unq="${esc(b.id)}" aria-label="Sıradan çıkar" style="color:var(--text-3)">✕</button></div>`).join('')}</div>
        <p class="muted small" style="margin:18px 0 0">≡ işaretinden tutup sürükleyerek sırayı değiştirebilirsin.</p>`
        : '<p class="muted small" style="margin:0">Sıraya kitap eklemek için ＋ Ekle\'ye dokun.</p>'}
    </div>

    <div class="section"><h3>Okuma kurallarım</h3><ol class="rules" style="margin:0;padding-left:20px">${state.settings.rules.map(r => `<li>${esc(r)}</li>`).join('')}</ol>
      <button class="mini-btn" id="edit-rules" style="margin-top:6px">Kuralları düzenle</button></div>

    <h3 style="margin:20px 0 10px">İstatistik</h3>
    ${(() => {
      const r = readingStats();
      if (!r.totalSec) return '';
      const max = Math.max(...r.last7.map(x => x.sec), 1);
      const days = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
      return `<div class="section"><h3>Okuma süresi</h3>
        <div class="stat-grid" style="margin-bottom:6px;grid-template-columns:repeat(3,1fr)"><div><div class="n" style="font:700 22px/1.1 var(--serif)">${formatDuration(r.todaySec)}</div><div class="muted small">Bugün</div></div>
          <div><div class="n" style="font:700 22px/1.1 var(--serif)">${formatDuration(r.weekSec)}</div><div class="muted small">Son 7 gün</div></div>
          <div><div class="n" style="font:700 22px/1.1 var(--serif)">${r.streak ? `🔥 ${r.streak} gün` : '—'}</div><div class="muted small">Art arda okuma</div></div></div>
        <div class="week-bars">${r.last7.map(x => `<div><i class="${x.sec ? '' : 'zero'}" style="height:${x.sec ? Math.max(6, (x.sec / max) * 70) : 3}px" title="${formatDuration(x.sec)}"></i>${days[x.d.getDay()]}</div>`).join('')}</div>
        <div class="muted small" style="margin-top:8px">Bu ay ${formatDuration(r.monthSec)} · Toplam ${formatDuration(r.totalSec)}</div></div>`;
    })()}
    <div class="section"><div style="display:flex;justify-content:space-between;align-items:baseline"><b>${year} hedefi</b><span class="muted small">${readThisYear.length} / ${goal || '—'} kitap</span></div>
      <div class="progress" style="height:10px;margin-top:8px"><span style="width:${goal ? Math.min(100, (readThisYear.length / goal) * 100) : 0}%"></span></div></div>
    <div class="stat-grid">
      <a class="stat" href="#/search?status=Okundu"><div class="n">${counts['Okundu'] || 0}</div><div class="l">✅ Okundu</div></a>
      <a class="stat" href="#/search?status=Okunacak"><div class="n">${counts['Okunacak'] || 0}</div><div class="l">📚 Okunacak</div></a>
      <div class="stat"><div class="n">${total}</div><div class="l">Toplam kitap</div></div>
      <div class="stat"><div class="n">${avgMine}</div><div class="l">⭐ Ortalama puanım</div></div>
      <div class="stat"><div class="n">${new Set(state.books.map(b => b.author).filter(Boolean)).size}</div><div class="l">Yazar</div></div>
      <div class="stat"><div class="n">${trMissing}</div><div class="l">⏳ Türkçesi yok/belirsiz</div></div>
    </div>
    <div class="section"><h3>Durumlara göre</h3>${state.options.statuses.filter(s => counts[s.name]).map(s => `
      <a class="hbar" href="#/search?status=${enc(s.name)}"><span>${s.emoji} ${esc(s.name)}</span><b>${counts[s.name]}</b><div class="track"><span style="width:${(counts[s.name] / total) * 100}%;background:${s.color}"></span></div></a>`).join('')}</div>
    <div class="section"><h3>Türlere göre</h3>${Object.entries(genres).sort((a, b) => b[1] - a[1]).map(([g, n]) => `
      <a class="hbar" href="#/search?genre=${enc(g)}"><span>${esc(g)}</span><b>${n}</b><div class="track"><span style="width:${(n / maxG) * 100}%;background:${genreColor(g)}"></span></div></a>`).join('')}</div>
  `;
  hydrateCovers(view);
  $('#ask-open', view)?.addEventListener('click', async () => (await import('./ask.js')).openAsk());
  $('#ask-import-btn', view)?.addEventListener('click', async () => (await import('./ask.js')).openImportSuggestions());

  $$('[data-unq]', view).forEach(btn => btn.addEventListener('click', async e => {
    e.preventDefault();
    const b = state.books.find(x => x.id === btn.dataset.unq);
    b.priority = null;
    renumber(queue.filter(x => x !== b));
    await saveBooks([b, ...queue.filter(x => x !== b)]);
  }));
  $('#add-q', view).addEventListener('click', () => addToQueue(queue));
  $('#edit-rules', view).addEventListener('click', editRules);
  setupDrag(view, queue);
}

function renumber(list) { list.forEach((b, i) => { b.priority = i + 1; }); }

function addToQueue(queue) {
  const candidates = () => state.books.filter(b => !b.priority && !DONE.has(b.status));
  const rows = (q) => candidates().filter(b => !q || norm([b.title, b.originalTitle, b.author, b.series].join(' ')).includes(norm(q))).slice(0, 40)
    .map(b => `<button class="row" data-add="${esc(b.id)}" style="width:100%;border:0;background:none;text-align:left"><div class="body"><div class="t">${esc(displayTitle(b))}</div><div class="s">${esc(b.author || '')}${b.series ? ' · ' + esc(b.series) : ''}</div></div><span class="mini-btn">＋</span></button>`).join('');
  sheet({
    title: 'Sıraya ekle',
    body: `<div class="searchbox"><input id="qq" placeholder="Kitap ara…" style="padding-left:14px"></div><div class="list" id="qlist">${rows('')}</div>`,
    onMount: (el, close) => {
      $('#qq', el).addEventListener('input', e => { $('#qlist', el).innerHTML = rows(e.target.value); });
      $('#qlist', el).addEventListener('click', async e => {
        const r = e.target.closest('[data-add]'); if (!r) return;
        const b = state.books.find(x => x.id === r.dataset.add);
        b.priority = queue.length + 1;
        queue.push(b);
        await saveBooks([b]);
        toast(`#${b.priority} olarak eklendi`);
        close();
      });
    },
  });
}

function editRules() {
  sheet({
    title: 'Okuma kuralları',
    body: `<p class="muted small">Her satıra bir kural yaz.</p><div class="form-group"><div class="field"><textarea id="rules" style="min-height:220px">${esc(state.settings.rules.join('\n'))}</textarea></div></div>`,
    foot: '<button class="btn" data-close>Vazgeç</button><button class="btn primary" id="save-rules">Kaydet</button>',
    onMount: (el, close) => $('#save-rules', el).addEventListener('click', async () => {
      state.settings.rules = $('#rules', el).value.split('\n').map(s => s.trim()).filter(Boolean);
      close();
      await saveSettings();
    }),
  });
}

// Sürükle-bırak ile sıralama (dokunmatik ve fare).
function setupDrag(view, queue) {
  const list = $('#queue', view);
  if (!list) return;
  let dragEl = null, startY = 0;
  list.addEventListener('pointerdown', e => {
    const h = e.target.closest('.handle');
    if (!h) return;
    dragEl = h.closest('.queue-row');
    startY = e.clientY;
    dragEl.classList.add('dragging');
    h.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  list.addEventListener('pointermove', e => {
    if (!dragEl) return;
    dragEl.style.transform = `translateY(${e.clientY - startY}px)`;
    const rows = $$('.queue-row', list).filter(r => r !== dragEl);
    for (const r of rows) {
      const box = r.getBoundingClientRect();
      const mid = box.top + box.height / 2;
      const before = dragEl.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING;
      if (before && e.clientY > mid) { const old = dragEl.getBoundingClientRect().top; r.after(dragEl); startY += dragEl.getBoundingClientRect().top - old; dragEl.style.transform = `translateY(${e.clientY - startY}px)`; break; }
      if (!before && e.clientY < mid) { const old = dragEl.getBoundingClientRect().top; r.before(dragEl); startY += dragEl.getBoundingClientRect().top - old; dragEl.style.transform = `translateY(${e.clientY - startY}px)`; break; }
    }
  });
  const end = async () => {
    if (!dragEl) return;
    dragEl.classList.remove('dragging');
    dragEl.style.transform = '';
    dragEl = null;
    const order = $$('.queue-row', list).map(r => r.dataset.id);
    const sorted = order.map(id => queue.find(b => b.id === id));
    const changed = sorted.filter((b, i) => b.priority !== i + 1);
    renumber(sorted);
    if (changed.length) await saveBooks(changed);
  };
  list.addEventListener('pointerup', end);
  list.addEventListener('pointercancel', end);
}
