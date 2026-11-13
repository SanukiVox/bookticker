// Ortak arayüz parçaları: kapaklar, kartlar, bildirim, alttan açılan paneller.
import { db } from './db.js';
import { state, displayTitle, statusInfo, genreColor, colorFor, computeScore } from './store.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const enc = encodeURIComponent;

export const ICON = {
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/></svg>',
  grid: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg>',
  filter: '<svg viewBox="0 0 24 24"><path d="M4 6h16M7 12h10M10 18h4"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
  heartFill: '<svg viewBox="0 0 24 24" style="fill:currentColor"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
};

// ---------- Kapaklar ----------
const urlCache = new Map();
async function coverUrl(key) {
  if (/^https?:\/\//.test(key)) return key; // internetten bulunan kapak (adres olarak saklanır)
  if (urlCache.has(key)) return urlCache.get(key);
  const blob = await db.getCover(key);
  const url = blob ? URL.createObjectURL(blob) : null;
  urlCache.set(key, url);
  return url;
}
export function forgetCover(key) {
  const u = urlCache.get(key);
  if (u) URL.revokeObjectURL(u);
  urlCache.delete(key);
}

// Ayarlar → Kapak olarak göster (tr | orig); seçilen yoksa diğeri.
export function coverKeyOf(book, prefer = state.settings.coverPref || 'tr') {
  return prefer === 'orig' ? (book.coverOrig || book.coverTr) : (book.coverTr || book.coverOrig);
}

// Kapak yoksa türün renginde, adı yazan zarif bir yer tutucu.
export function coverHTML(book, { key, badge = true } = {}) {
  const k = key === undefined ? coverKeyOf(book) : key;
  const c = `color-mix(in srgb, ${genreColor(book.genre)} 78%, ${colorFor(displayTitle(book))})`;
  const st = statusInfo(book.status);
  const ph = `<div class="ph" style="background:linear-gradient(160deg, ${c}, color-mix(in srgb, ${c} 55%, #000))"><b>${esc(displayTitle(book))}</b><i>${esc(book.author || '')}</i></div>`;
  const badges = badge
    ? `${book.status && book.status !== 'Okunacak' ? `<span class="badge" title="${esc(st.name)}">${st.emoji}</span>` : ''}${book.favorite ? '<span class="badge l">❤️</span>' : ''}`
    : '';
  const pct = book.status === 'Okunuyor' && typeof book.progress?.percent === 'number' ? Math.min(100, book.progress.percent) : null;
  const prog = badge && pct !== null ? `<div class="cprog"><span style="width:${pct}%"></span></div>` : '';
  return `<div class="cover"${k ? ` data-cover="${esc(k)}"` : ''}>${ph}${badges}${prog}</div>`;
}

const io = 'IntersectionObserver' in window
  ? new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) { io.unobserve(e.target); fillCover(e.target); }
    }, { rootMargin: '300px' })
  : null;

async function fillCover(el) {
  const url = await coverUrl(el.dataset.cover);
  if (!url) return;
  const img = new Image();
  img.alt = '';
  img.decoding = 'async';
  img.onload = () => {
    if (el.querySelector('img')) return;
    const ph = el.querySelector('.ph');
    if (ph) ph.replaceWith(img); else el.prepend(img);
  };
  img.src = url; // yüklenemezse yer tutucu kalır
}

export function hydrateCovers(root = document) {
  for (const el of $$('.cover[data-cover]', root)) {
    if (el.querySelector('img')) continue;
    if (io) io.observe(el); else fillCover(el);
  }
}

// ---------- Kitap kartı ve satırı ----------
// Orijinal ad Türkçe addan farklıysa (ve ayar açıksa) gösterilir.
const origOf = b => (state.settings.showOriginal !== false && b.title && b.originalTitle && b.originalTitle !== b.title ? b.originalTitle : '');

export function bookCard(b, extra = '', note = '') {
  const o = origOf(b);
  return `<a class="card ${extra}" href="#/book/${enc(b.id)}">${coverHTML(b)}<div class="t">${esc(displayTitle(b))}</div>${o ? `<div class="o">${esc(o)}</div>` : ''}<div class="a">${esc(b.author || '')}</div>${note ? `<div class="why-note">${esc(note)}</div>` : ''}</a>`;
}

export function bookRow(b, { sub } = {}) {
  const s = computeScore(b);
  const st = statusInfo(b.status);
  const subline = sub ?? [b.author, b.series ? `${b.series}${b.seriesOrder ? ' #' + b.seriesOrder : ''}` : ''].filter(Boolean).join(' · ');
  return `<a class="row" href="#/book/${enc(b.id)}">${coverHTML(b, { badge: false })}
    <div class="body"><div class="t">${b.favorite ? '❤️ ' : ''}${esc(displayTitle(b))}</div>${origOf(b) ? `<div class="o">${esc(origOf(b))}</div>` : ''}<div class="s">${esc(subline)}</div>
    <div class="s">${st.emoji} ${esc(st.name)}${typeof b.progress?.percent === 'number' && b.status === 'Okunuyor' ? ` · %${Math.floor(b.progress.percent)}` : ''}${b.file ? ' · 📄' : ''}</div></div>
    <div class="end">${s !== null ? `<span class="score">${s.toFixed(1)}</span>` : ''}${b.goodreads ? `<div class="small" style="margin-top:4px">★ ${b.goodreads.toFixed(2).replace('.', ',')}</div>` : ''}</div></a>`;
}

export function booksView(books, view) {
  if (view === 'list') return `<div class="list">${books.map(b => bookRow(b)).join('')}</div>`;
  return `<div class="grid">${books.map(b => bookCard(b)).join('')}</div>`;
}

// ---------- Bildirim ----------
let toastT;
export function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), 2200);
}

// ---------- Alttan açılan panel ----------
export function sheet({ title, body, foot = '', onMount, onClose }) {
  const root = $('#sheet-root');
  const wrap = document.createElement('div');
  wrap.className = 'sheet-backdrop';
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="sheet-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Kapat">${ICON.close}</button></div>
    <div class="sheet-body">${body}</div>${foot ? `<div class="sheet-foot">${foot}</div>` : ''}</div>`;
  root.appendChild(wrap);
  document.body.style.overflow = 'hidden';
  const close = () => {
    wrap.remove();
    if (!root.children.length) document.body.style.overflow = '';
    onClose?.();
  };
  wrap.addEventListener('click', e => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
  onMount?.(wrap, close);
  return close;
}

export function confirmSheet(title, message, okLabel = 'Evet', danger = true) {
  return new Promise(resolve => {
    let answered = false;
    sheet({
      title,
      body: `<p>${esc(message)}</p>`,
      foot: `<button class="btn" data-close>Vazgeç</button><button class="btn ${danger ? 'primary' : 'primary'}" data-ok style="${danger ? 'background:var(--danger)' : ''}">${esc(okLabel)}</button>`,
      onMount: (el, close) => el.querySelector('[data-ok]').addEventListener('click', () => { answered = true; resolve(true); close(); }),
      onClose: () => { if (!answered) resolve(false); },
    });
  });
}

export function promptSheet(title, { value = '', placeholder = '', okLabel = 'Kaydet' } = {}) {
  return new Promise(resolve => {
    let answered = false;
    sheet({
      title,
      body: `<div class="form-group"><div class="field"><input id="prompt-in" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off"></div></div>`,
      foot: `<button class="btn" data-close>Vazgeç</button><button class="btn primary" data-ok>${esc(okLabel)}</button>`,
      onMount: (el, close) => {
        const inp = el.querySelector('#prompt-in');
        setTimeout(() => inp.focus(), 50);
        const ok = () => { const v = inp.value.trim(); if (!v) return; answered = true; resolve(v); close(); };
        el.querySelector('[data-ok]').addEventListener('click', ok);
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
      },
      onClose: () => { if (!answered) resolve(null); },
    });
  });
}

export const fmtScore = v => (v === null || v === undefined || v === '' ? '' : String(Math.round(Number(v) * 10) / 10).replace('.', ','));
export const peppers = n => (n === null || n === undefined || n === '' ? '—' : Number(n) === 0 ? '0 · yok'
  : `${'🌶️'.repeat(Math.floor(n))}${Number(n) % 1 ? '½' : ''}`);

export function applyTheme() {
  const t = state.settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = t;
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  $$('meta[name="theme-color"]').forEach(m => m.setAttribute('content', dark ? '#16131a' : '#f7f3ee'));
}
