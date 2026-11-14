// Vurgular ve notlar (EPUB). Her dosyanın kendi listesi: book.highlights / book.highlights2
// = [{ id, cfi, text, note, color, at, upd }], silinenler book.highlightsDel(2) = { id: zaman }.
import { saveBook } from '../store.js';
import { esc, enc, toast, promptSheet, confirmSheet, $$ } from '../ui.js';
import { slotBook, slotFile, langLabel } from '../files.js';

export const HL_COLORS = { yellow: '#ffd84d', green: '#8fdc8f', blue: '#8cc8ff', pink: '#ffa3c4' };

export async function newHighlight(book, ctrl, { color = 'yellow', askNote = false } = {}) {
  const sel = ctrl?.selection?.();
  if (!sel) { toast('Önce metni seç'); return null; }
  let note = '';
  if (askNote) {
    note = await promptSheet('📝 Not ekle', { placeholder: `“${sel.text.length > 60 ? `${sel.text.slice(0, 60)}…` : sel.text}” için notun` });
    if (note === null) return null;
  }
  const now = Date.now();
  const h = { id: `h${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, cfi: sel.cfi, text: sel.text.replace(/\s+/g, ' ').trim().slice(0, 1000), note: (note || '').trim(), color, at: now, upd: now };
  (book.highlights ||= []).push(h);
  ctrl.highlight?.(h);
  sel.clear?.();
  await saveBook(book);
  return h;
}

export async function removeHighlight(book, id) {
  book.highlights = (book.highlights || []).filter(h => h.id !== id);
  (book.highlightsDel ||= {})[id] = Date.now();
  await saveBook(book);
}

// ---------- Kitap sayfası ----------
export function highlightsSection(b) {
  const groups = [1, 2].map(slot => ({ slot, list: (slot === 2 ? b.highlights2 : b.highlights) || [] })).filter(g => g.list.length);
  if (!groups.length) return '';
  const total = groups.reduce((n, g) => n + g.list.length, 0);
  const both = groups.length > 1;
  return `<div class="section" id="hl-sec"><h3>🖍 Vurgular ve notlar · ${total}</h3>
    ${groups.map(g => `${both ? `<div class="muted small" style="margin:6px 0">${esc(langLabel(slotFile(b, g.slot)))}</div>` : ''}
      <div class="list" style="box-shadow:none;margin:0 -14px">${g.list.slice().sort((x, y) => x.at - y.at).map(h => `
        <div class="row" style="align-items:flex-start">
          <a class="body" href="#/read/${enc(b.id)}?${g.slot === 2 ? 'f=2&' : ''}loc=${encodeURIComponent(h.cfi)}" style="color:inherit;min-width:0">
            <div class="hl-quote" style="border-left-color:${HL_COLORS[h.color] || HL_COLORS.yellow}">${esc(h.text)}</div>
            ${h.note ? `<div class="small" style="margin-top:4px">📝 ${esc(h.note)}</div>` : ''}
          </a>
          <button class="icon-btn" data-hlnote="${h.id}" data-slot="${g.slot}" aria-label="Not" style="font-size:16px">📝</button>
          <button class="icon-btn" data-hlrm="${h.id}" data-slot="${g.slot}" aria-label="Sil" style="color:var(--text-3)">✕</button>
        </div>`).join('')}</div>`).join('')}
  </div>`;
}

export function wireHighlights(view, b) {
  $$('[data-hlrm]', view).forEach(btn => btn.addEventListener('click', async () => {
    if (!(await confirmSheet('Vurguyu sil', 'Bu vurgu ve notu silinsin mi?', 'Sil'))) return;
    await removeHighlight(slotBook(b, Number(btn.dataset.slot)), btn.dataset.hlrm);
    toast('Vurgu silindi');
  }));
  $$('[data-hlnote]', view).forEach(btn => btn.addEventListener('click', async () => {
    const sb = slotBook(b, Number(btn.dataset.slot));
    const h = (sb.highlights || []).find(x => x.id === btn.dataset.hlnote);
    if (!h) return;
    const note = await promptSheet('📝 Not', { value: h.note || '', placeholder: 'Notun…' });
    if (note === null) return;
    h.note = note.trim(); h.upd = Date.now();
    await saveBook(sb);
    toast('Not kaydedildi');
  }));
}
