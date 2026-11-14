// "Okudum, nasıldı?" — kitap Okundu olunca: kendi puanım, kriterlerde beklentiyle karşılaştırma, kısa yorum.
// İlk açılışta önceki (okumadan önceki) puanlar book.expected olarak saklanır; zevk analizi bunu kullanır.
import { CRITERIA, SPICY_LABELS, saveBook, computeScore, displayTitle, state, today } from '../store.js';
import { esc, sheet, toast, fmtScore, $, $$ } from '../ui.js';

const HALF = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

export function openFinished(b) {
  b = b?.__real || b;
  if (!b) return;
  const exp = b.expected || { scores: { ...(b.scores || {}) }, spicy: b.spicy ?? null, score: computeScore(b), at: Date.now() };
  const scores = { ...(b.scores || {}) };
  let spicy = b.spicy ?? null, rating = b.myRating ?? null;
  const row = (key, label, val, min, max, step, before) => `
    <div class="fin-row" data-k="${key}"><span class="fin-l">${esc(label)}</span>
      ${before != null && before !== val ? `<span class="fin-was">${fmtScore(before)} →</span>` : ''}
      <button class="mini-btn" data-d="-${step}" data-min="${min}" data-max="${max}">−</button><b class="fin-v">${val == null ? '—' : fmtScore(val)}</b><button class="mini-btn" data-d="${step}" data-min="${min}" data-max="${max}">+</button></div>`;
  sheet({
    title: '🎉 Okudum, nasıldı?',
    body: `<div class="muted small" style="margin-bottom:8px">${esc(displayTitle(b))}</div>
      <div class="f-block"><h3>Puanım</h3><div class="chip-wrap" id="fin-rate">${HALF.map(n => `<button class="chip ${rating === n ? 'on' : ''}" data-r="${n}">${fmtScore(n)}${n % 1 ? '' : '★'}</button>`).join('')}</div></div>
      <div class="f-block"><h3>Kriterler: beklenti → gerçek</h3>
        <div class="muted small" style="margin-bottom:6px">Okumadan önceki puanlar başlangıç değeri; okuduktan sonraki fikrine göre düzelt.</div>
        <div id="fin-crit">${CRITERIA.map(c => row(c.key, c.title || c.label, scores[c.key] ?? null, 1, 5, 0.5, exp.scores?.[c.key] ?? null)).join('')}
        ${row('spicy', '🌶️ Spicy', spicy, 0, 5, 1, exp.spicy)}</div>
        <div class="small muted" id="fin-sp" style="margin-top:4px">${spicy != null ? esc(SPICY_LABELS[spicy] || '') : ''}</div></div>
      <div class="f-block"><h3>Kısa yorumum</h3><textarea id="fin-note" rows="3" placeholder="Ne sevdin, ne eksikti?" style="width:100%;border-radius:12px;border:1px solid var(--line);padding:10px;background:var(--surface);color:var(--text);font:inherit"></textarea></div>`,
    foot: '<button class="btn" data-close>Sonra</button><button class="btn primary" id="fin-save">Kaydet</button>',
    onMount: (el, close) => {
      $$('[data-r]', el).forEach(btn => btn.addEventListener('click', () => {
        rating = Number(btn.dataset.r);
        $$('[data-r]', el).forEach(x => x.classList.toggle('on', x === btn));
      }));
      $$('.fin-row [data-d]', el).forEach(btn => btn.addEventListener('click', () => {
        const r = btn.closest('.fin-row'), k = r.dataset.k, d = Number(btn.dataset.d);
        const min = Number(btn.dataset.min), max = Number(btn.dataset.max);
        const cur = k === 'spicy' ? spicy : scores[k];
        const v = Math.max(min, Math.min(max, (cur ?? (k === 'spicy' ? 0 : 3)) + (cur == null ? 0 : d)));
        if (k === 'spicy') { spicy = v; $('#fin-sp', el).textContent = SPICY_LABELS[v] || ''; } else scores[k] = v;
        $('.fin-v', r).textContent = fmtScore(v);
      }));
      $('#fin-save', el).addEventListener('click', async () => {
        if (!b.expected) b.expected = exp;
        b.scores = scores; b.spicy = spicy;
        if (rating != null) b.myRating = rating;
        const note = $('#fin-note', el).value.trim();
        if (note) b.notes = `${b.notes ? `${b.notes}\n\n` : ''}[${today()}] ${note}`;
        await saveBook(b);
        close();
        toast('✅ Kaydedildi');
      });
    },
  });
}

// ---------- Zevk analizi (Okuma sekmesi) ----------
function pearson(xs, ys) {
  const n = xs.length; if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

export function tasteSection() {
  const rated = state.books.filter(b => b.status === 'Okundu' && typeof b.myRating === 'number');
  if (rated.length < 4) return '';
  const corr = CRITERIA.map(c => {
    const pts = rated.filter(b => typeof b.scores?.[c.key] === 'number');
    return { c, r: pearson(pts.map(b => b.scores[c.key]), pts.map(b => b.myRating)), n: pts.length };
  }).filter(x => x.r != null && x.n >= 4).sort((a, b) => b.r - a.r);
  const withExp = rated.filter(b => typeof b.expected?.score === 'number').map(b => ({ b, gap: b.myRating - b.expected.score }));
  const better = withExp.filter(x => x.gap >= 0.75).sort((a, b) => b.gap - a.gap).slice(0, 3);
  const worse = withExp.filter(x => x.gap <= -0.75).sort((a, b) => a.gap - b.gap).slice(0, 3);
  const avgGap = withExp.length ? withExp.reduce((t, x) => t + x.gap, 0) / withExp.length : null;
  if (!corr.length && !withExp.length) return '';
  return `<div class="section"><h3>🎯 Zevk analizim</h3>
    ${corr.length ? `<div class="muted small" style="margin-bottom:6px">Puanımı en çok etkileyen kriterler (${rated.length} okunmuş kitaptan)</div>
      ${corr.slice(0, 4).map(x => `<div class="taste-row"><span>${esc(x.c.title || x.c.label)}</span><div class="progress" style="flex:1;height:8px"><span style="width:${Math.max(0, Math.round(x.r * 100))}%"></span></div><b class="small">${x.r > 0 ? Math.round(x.r * 100) : 0}%</b></div>`).join('')}` : ''}
    ${avgGap != null ? `<div class="small" style="margin-top:10px">Beklentiyle karşılaştırma (${withExp.length} kitap): ortalama ${avgGap >= 0 ? '+' : ''}${fmtScore(Math.round(avgGap * 10) / 10)} puan</div>` : ''}
    ${better.length ? `<div class="small" style="margin-top:4px">📈 Beklentimi aşanlar: ${better.map(x => `<a href="#/book/${encodeURIComponent(x.b.id)}">${esc(displayTitle(x.b))}</a>`).join(', ')}</div>` : ''}
    ${worse.length ? `<div class="small" style="margin-top:4px">📉 Beklentimin altında kalanlar: ${worse.map(x => `<a href="#/book/${encodeURIComponent(x.b.id)}">${esc(displayTitle(x.b))}</a>`).join(', ')}</div>` : ''}
  </div>`;
}
