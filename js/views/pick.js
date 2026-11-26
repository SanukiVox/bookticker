// "Ne okusam?": ruh haline göre öneri (yapay zekâsız; puanlar, spicy, tür ve seri durumu) ve kitap çarkı.
import { state, computeScore, computeQuality, displayTitle, saveBooks, PALETTE } from '../store.js';
import { esc, enc, coverHTML, hydrateCovers, toast, $, $$ } from '../ui.js';
import { fileSummary } from '../files.js';

const DONE = new Set(['Okundu', 'Elendi', 'Yarım bırakıldı']);
const STARTED = new Set(['Okundu', 'Okunuyor']);
const num = v => (v === null || v === undefined || v === '' ? null : Number(v));
const sc = (b, k) => num(b.scores?.[k]);
const g = (b, re) => re.test(b.genre || '');
const f1 = v => String(Math.round(v * 10) / 10).replace('.', ',');

// Her ruh hali: süzgeç (fit) ve/veya puan katkısı (val: 0–5 arası), kısa gerekçe
const MOODS = [
  { k: 'romance', l: '💕 Bol romantizm', val: b => avg(sc(b, 'chemistry'), sc(b, 'romance')), why: v => `romantizm/kimya ${f1(v)}` },
  { k: 'spicy', l: '🌶️ Spicy', fit: b => num(b.spicy) >= 3, why: (_, b) => `spicy ${f1(num(b.spicy))}` },
  { k: 'clean', l: '🌸 Az spicy', fit: b => num(b.spicy) !== null && num(b.spicy) <= 1.5 },
  { k: 'light', l: '😄 Hafif ve eğlenceli', fit: b => g(b, /Komedi|Çağdaş Romantik/i) && !g(b, /Dark|Mafya/i), val: b => sc(b, 'pace') },
  { k: 'fantasy', l: '🐉 Fantastik dünya', fit: b => g(b, /Fantastik|Romantasy|Bilimkurgu/i), val: b => sc(b, 'world'), why: v => `dünya ${f1(v)}` },
  { k: 'action', l: '⚔️ Aksiyon', val: b => sc(b, 'action'), why: v => `aksiyon ${f1(v)}` },
  { k: 'page', l: '⚡ Elimden bırakamayayım', val: b => sc(b, 'pace'), why: v => `sürükleyicilik ${f1(v)}` },
  { k: 'deep', l: '🎭 Derin ve edebî', val: b => avg(sc(b, 'literary'), computeQuality(b)), why: v => `edebî derinlik ${f1(v)}` },
  { k: 'dark', l: '🖤 Karanlık', fit: b => g(b, /Dark|Mafya/i) },
  { k: 'thriller', l: '🔎 Gerilim / polisiye', fit: b => g(b, /Gerilim|Polisiye/i) },
  { k: 'classic', l: '🏛 Klasik / edebiyat', fit: b => g(b, /Klasik|Edebiyat/i) },
  { k: 'single', l: '1️⃣ Tek kitap', fit: b => !b.series },
  { k: 'start', l: '🧵 Yeni seriye başla', fit: b => b.series && Number(b.seriesOrder) === 1 && !seriesStarted(b.series) },
  { k: 'cont', l: '➡️ Serimi sürdür', fit: b => b.series && seriesStarted(b.series) },
];
const EXTRAS = [
  { k: 'tr', l: '🇹🇷 Türkçesi var', fit: b => !b.translation || b.translation === 'Var' },
  { k: 'file', l: '📄 Dosyası var', fit: b => { const fs = fileSummary(b); return !!fs && fs.where !== 'missing'; } },
  { k: 'audio', l: '🎧 Sesli kitabı var', fit: b => !!b.audio?.tracks?.length },
  { k: 'owned', l: '📚 Bende var', fit: b => !!b.owned },
];

function avg(...v) { const x = v.filter(n => n !== null && !Number.isNaN(n)); return x.length ? x.reduce((t, n) => t + n, 0) / x.length : null; }
let startedCache = null;
function seriesStarted(name) {
  if (!startedCache) { startedCache = new Set(state.books.filter(b => b.series && STARTED.has(b.status)).map(b => b.series)); }
  return startedCache.has(name);
}

// Seri içindeki kitap, öncesindeki ana kitaplar okunmadan önerilmez (#1 her zaman olur)
function inOrder(b) {
  const o = Number(b.seriesOrder);
  if (!b.series || !o || o <= 1) return true;
  return state.books.filter(x => x.series === b.series && Number.isInteger(Number(x.seriesOrder)) && Number(x.seriesOrder) < o && x.id !== b.id)
    .every(x => STARTED.has(x.status));
}

// Kişisel uyum + genel puan + Goodreads; hepsi kabaca 0–5
function base(b) {
  const fit = computeScore(b), q = computeQuality(b), gr = num(b.goodreads);
  const grs = gr ? Math.max(0, Math.min(5, (gr - 3) * 2.5 + 1.5)) : null;
  return avg(fit, fit, q, grs) ?? 2.5;
}

export function pickPool(sel) {
  startedCache = null;
  const moods = MOODS.filter(m => sel.has(m.k)), extras = EXTRAS.filter(e => sel.has(e.k));
  const out = [];
  for (const b of state.books) {
    if (DONE.has(b.status) || b.status === 'Okunuyor' || b.status === 'Çeviri bekleniyor') continue;
    if (!inOrder(b)) continue;
    if (extras.some(e => !e.fit(b))) continue;
    if (moods.some(m => m.fit && !m.fit(b))) continue;
    let s = base(b); const why = [];
    for (const m of moods) {
      if (!m.val) { if (m.why) why.push(m.why(null, b)); continue; }
      const v = m.val(b);
      if (v === null) { s -= 0.6; continue; }
      s += (v - 3) * 0.9;
      if (v >= 3.75 && m.why) why.push(m.why(v, b));
    }
    if (b.series && sel.has('cont')) why.push(`${b.series} #${b.seriesOrder} sırada`);
    if (b.priority) { s += 0.4; why.push(`okuma sıranda #${b.priority}`); }
    if (b.favorite) s += 0.2;
    const gr = num(b.goodreads);
    if (gr && gr >= 4.2) why.push(`Goodreads ${gr.toFixed(2).replace('.', ',')}`);
    const fit = computeScore(b);
    if (fit && fit >= 4) why.push(`uyum ${f1(fit)}`);
    out.push({ b, s, why: why.slice(0, 3) });
  }
  return out.sort((a, b) => b.s - a.s);
}

// Üst sıralardan ağırlıklı rastgele seçim (hep aynı 3 kitap çıkmasın)
function sample(pool, n, skip = new Set()) {
  const cand = pool.filter(p => !skip.has(p.b.id)).slice(0, 25);
  const res = [];
  while (res.length < n && cand.length) {
    const w = cand.map((p, i) => Math.max(0.05, p.s - (cand[cand.length - 1].s - 0.3)) / (1 + i * 0.08));
    let r = Math.random() * w.reduce((t, x) => t + x, 0), i = 0;
    while ((r -= w[i]) > 0 && i < w.length - 1) i++;
    res.push(cand.splice(i, 1)[0]);
  }
  return res;
}

const KEY = 'pick.sel';
const loadSel = () => { try { return new Set(JSON.parse(localStorage.getItem(KEY)) || ['tr']); } catch { return new Set(['tr']); } };
const saveSel = s => { try { localStorage.setItem(KEY, JSON.stringify([...s])); } catch { /* yok */ } };

function wheelSVG(items) {
  const n = items.length, a = 360 / n, R = 140, C = 150;
  const pt = deg => { const r = (deg - 90) * Math.PI / 180; return `${(C + R * Math.cos(r)).toFixed(2)} ${(C + R * Math.sin(r)).toFixed(2)}`; };
  const seg = (it, i) => {
    const p = n === 1 ? `<circle cx="${C}" cy="${C}" r="${R}" fill="${PALETTE[0]}"/>`
      : `<path d="M${C} ${C} L${pt(i * a)} A${R} ${R} 0 ${a > 180 ? 1 : 0} 1 ${pt((i + 1) * a)} Z" fill="${PALETTE[i % PALETTE.length]}"/>`;
    const t = displayTitle(it.b); const label = t.length > 17 ? `${t.slice(0, 16)}…` : t;
    return `${p}<text transform="rotate(${i * a + a / 2 - 90} ${C} ${C})" x="${C + R - 8}" y="${C + 4}" text-anchor="end" font-size="11" font-weight="600" fill="#fff">${esc(label)}</text>`;
  };
  return `<svg viewBox="0 0 300 300" class="wheel-svg">${items.map(seg).join('')}<circle cx="${C}" cy="${C}" r="18" fill="var(--surface)" stroke="var(--line)"/></svg>`;
}

const card = (p, extra = '') => `<div class="pick-card ${extra}"><a href="#/book/${enc(p.b.id)}" style="display:contents">${coverHTML(p.b, { badge: false })}
  <div class="body"><div class="t">${esc(displayTitle(p.b))}</div><div class="small muted">${esc(p.b.author || '')}${p.b.series ? ` · ${esc(p.b.series)}${p.b.seriesOrder ? ` #${p.b.seriesOrder}` : ''}` : ''}</div>
  ${p.why.length ? `<div class="why">${esc(p.why.join(' · '))}</div>` : ''}</div></a>
  <button class="mini-btn" data-queue="${esc(p.b.id)}" ${p.b.priority ? 'disabled' : ''}>${p.b.priority ? `Sırada #${p.b.priority}` : '＋ Sıraya'}</button></div>`;

export function renderPick(view) {
  const sel = loadSel();
  let shown = [], seen = new Set(), rot = 0, wheel = [];
  const draw = () => {
    const pool = pickPool(sel);
    view.innerHTML = `
      <div class="topbar"><button class="icon-btn" data-back aria-label="Geri"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button><div class="title">🎲 Ne okusam?</div></div>
      <div class="f-block"><h3>Nasıl bir şey istersin?</h3><div class="chip-wrap">${MOODS.map(m => `<button class="chip ${sel.has(m.k) ? 'on' : ''}" data-k="${m.k}">${m.l}</button>`).join('')}</div></div>
      <div class="f-block"><h3>Koşullar</h3><div class="chip-wrap">${EXTRAS.map(m => `<button class="chip ${sel.has(m.k) ? 'on' : ''}" data-k="${m.k}">${m.l}</button>`).join('')}</div>
        <p class="small muted" style="margin-top:8px">Okunacaklarından <b>${pool.length}</b> kitap uyuyor${sel.size ? ' · <button class="linkish" id="pk-clear">seçimleri temizle</button>' : ''}. Serilerde yalnızca sıradaki kitap önerilir.</p></div>
      ${pool.length ? `<div id="pk-res"></div>
        <div class="btn-row" style="margin:6px 0 22px"><button class="btn" id="pk-more">🔄 Başka öner</button></div>
        <div class="section"><h3>🎡 Kitap çarkı</h3><p class="small muted" style="margin:0 0 10px">Karar veremiyorsan çarkı çevir; uyan kitaplardan ${Math.min(10, pool.length)} tanesi çarkta.</p>
          <div class="wheel-wrap"><div class="wheel-pin"></div><div class="wheel" id="pk-wheel"></div></div>
          <div class="btn-row" style="justify-content:center;margin-top:12px"><button class="btn primary" id="pk-spin">🎡 Çarkı çevir</button><button class="btn" id="pk-refill">Çarkı karıştır</button></div>
          <div id="pk-win" style="margin-top:12px"></div></div>`
        : '<div class="empty"><div class="big">🤷</div><h2>Bu seçimle uyan kitap yok</h2><p>Birkaç seçimi kaldırmayı dene.</p></div>'}`;
    $('[data-back]', view).addEventListener('click', () => { if ((window.__navCount || 0) > 1) history.back(); else location.hash = '#/reading'; });
    $$('[data-k]', view).forEach(x => x.addEventListener('click', () => {
      const k = x.dataset.k;
      if (sel.has(k)) sel.delete(k); else {
        sel.add(k);
        if (k === 'spicy') sel.delete('clean'); if (k === 'clean') sel.delete('spicy');
        if (k === 'single') { sel.delete('start'); sel.delete('cont'); }
        if (k === 'start') { sel.delete('cont'); sel.delete('single'); } if (k === 'cont') { sel.delete('start'); sel.delete('single'); }
      }
      saveSel(sel); seen = new Set(); draw();
    }));
    $('#pk-clear', view)?.addEventListener('click', () => { sel.clear(); saveSel(sel); draw(); });
    if (!pool.length) return;
    const showRes = () => {
      shown = sample(pool, 3, seen);
      if (!shown.length) { seen = new Set(); shown = sample(pool, 3); }
      shown.forEach(p => seen.add(p.b.id));
      $('#pk-res', view).innerHTML = `<div class="pick-list">${shown.map((p, i) => card(p, i === 0 ? 'top' : '')).join('')}</div>`;
      hydrateCovers(view);
    };
    const fill = () => {
      wheel = sample(pool, Math.min(10, pool.length));
      rot = 0;
      $('#pk-wheel', view).innerHTML = wheelSVG(wheel);
      $('#pk-wheel', view).style.transition = 'none';
      $('#pk-wheel', view).style.transform = 'rotate(0deg)';
      $('#pk-win', view).innerHTML = '';
    };
    showRes(); fill();
    $('#pk-more', view).addEventListener('click', showRes);
    $('#pk-refill', view).addEventListener('click', fill);
    $('#pk-spin', view).addEventListener('click', e => {
      const btn = e.currentTarget, w = $('#pk-wheel', view);
      const i = Math.floor(Math.random() * wheel.length), a = 360 / wheel.length;
      const target = 360 - (i * a + a / 2) + (Math.random() - 0.5) * a * 0.6;
      rot = rot - (rot % 360) + 360 * 6 + target;
      btn.disabled = true; $('#pk-win', view).innerHTML = '';
      w.style.transition = 'transform 4.2s cubic-bezier(.17,.67,.2,1)';
      w.style.transform = `rotate(${rot}deg)`;
      setTimeout(() => {
        btn.disabled = false;
        $('#pk-win', view).innerHTML = `<div class="muted small" style="margin-bottom:6px;text-align:center">🎉 Çark bunu seçti:</div>${card(wheel[i], 'top')}`;
        hydrateCovers(view);
      }, 4300);
    });
    view.onclick = async e => {
      const q = e.target.closest('[data-queue]'); if (!q) return;
      const b = state.books.find(x => x.id === q.dataset.queue); if (!b || b.priority) return;
      const max = Math.max(0, ...state.books.filter(x => x.priority && !DONE.has(x.status)).map(x => x.priority));
      b.priority = max + 1; await saveBooks([b]);
      $$(`[data-queue="${CSS.escape(b.id)}"]`, view).forEach(x => { x.disabled = true; x.textContent = `Sırada #${b.priority}`; });
      toast(`Okuma sırasına #${b.priority} olarak eklendi`);
    };
  };
  draw();
}
