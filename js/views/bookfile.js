// Kitap sayfasındaki "Okuma" bölümü: iki dosya yuvası (orijinal metin ve çeviri), her birinin ayrı ilerlemesi.
import { saveBook } from '../store.js';
import { esc, enc, toast, sheet, confirmSheet, $, $$ } from '../ui.js';
import { attachFile, detachFile, hasLocalFile, formatSize, formatDuration, progressOf, slotBook, slotFile, slotProgress, slotForLang, langLabel, LANGS } from '../files.js';

const ACCEPT = '.pdf,.epub,application/pdf,application/epub+zip';

export function fileSectionShell() {
  return '<div class="section read-card" id="file-sec"><h3>Okuma</h3><div class="muted small">…</div></div>';
}

const filePick = (label, cls, slot, lang = '') =>
  `<label class="${cls}" style="position:relative;overflow:hidden">${label}<input type="file" accept="${ACCEPT}" data-slot="${slot}" data-lang="${lang}" ${slot === 1 && !lang ? 'id="file-in"' : ''} style="position:absolute;inset:0;opacity:0"></label>`;

async function slotCard(b, slot, both) {
  const f = slotFile(b, slot);
  const local = await hasLocalFile(slotBook(b, slot));
  const pct = progressOf(b, slot);
  const p = slotProgress(b, slot) || {};
  const bms = (slot === 2 ? b.bookmarks2 : b.bookmarks) || [];
  const href = `#/read/${enc(b.id)}${slot === 2 ? '?f=2' : ''}`;
  const head = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><b style="flex:1">${esc(langLabel(f))}</b>
    ${!f.lang ? Object.entries(LANGS).map(([k, l]) => `<button class="chip" data-setlang="${k}" data-slot="${slot}">${l}</button>`).join('') : ''}</div>`;
  const progressLine = pct != null
    ? `<div><div style="display:flex;justify-content:space-between;font-size:14px"><span>${p.page && p.pages ? `Sayfa ${p.page} / ${p.pages}` : p.chapter ? esc(p.chapter) : 'İlerleme'}</span><b>%${Math.floor(pct)}</b></div>
       <div class="progress" style="height:8px"><span style="width:${pct}%"></span></div></div>` : '';
  if (!local) {
    return `<div class="slot-card">${head}<div class="warn">📄 <span><b>${esc(f.name)}</b> başka bir cihazda eklenmiş. Dosyalar sadece eklendiği cihazda saklanır; burada okumak için yeniden ekle. İlerlemen korunur.</span></div>
      ${progressLine}<div class="btn-row">${filePick('📎 Yeniden ekle', 'btn', slot, f.lang || '')}<button class="mini-btn" data-rm="${slot}" style="color:var(--danger);background:transparent">Kaldır</button></div></div>`;
  }
  return `<div class="slot-card">${head}
      <div class="read-cta"><a class="btn primary" href="${href}">📖 ${b.status === 'Okundu' && pct >= 100 ? 'Yeniden oku' : pct ? `Devam et · %${Math.floor(pct)}` : p.loc ? 'Devam et' : 'Okumaya başla'}</a></div>
      ${progressLine}
      <div class="file-chip">📄 <b>${esc(f.name)}</b><span>${f.type.toUpperCase()} · ${formatSize(f.size)}${bms.length ? ` · 🔖 ${bms.length}` : ''}</span></div>
      <div class="btn-row"><button class="mini-btn" data-ai="${slot}">🤖 Yapay zekâya gönder</button>${filePick('Değiştir', 'mini-btn', slot, f.lang || '')}<button class="mini-btn" data-rm="${slot}" style="color:var(--danger);background:transparent">Kaldır</button></div>
    </div>`;
}

export async function fillFileSection(view, b) {
  const sec = $('#file-sec', view);
  if (!sec) return;
  const slots = [1, 2].filter(s => slotFile(b, s));
  const both = slots.length === 2;
  const time = b.readingSeconds ? `<div class="muted small">⏱ Toplam okuma süresi: <b>${formatDuration(b.readingSeconds)}</b></div>` : '';

  let html = '<h3>Okuma</h3>';
  if (both) html += `<a class="btn block" href="#/read/${enc(b.id)}?split=1">◫ Orijinal ve çeviriyi aynı anda oku</a>`;
  for (const s of slots) html += await slotCard(b, s, both);

  // Eksik dil için ekleme düğmeleri
  const langs = slots.map(s => slotFile(b, s).lang);
  const addable = Object.keys(LANGS).filter(l => !langs.includes(l));
  if (slots.length < 2 && addable.length) {
    html += `<div class="btn-row">${addable.map(l => filePick(`📎 ${l === 'orig' ? 'Orijinal metin' : 'Çeviri'} ekle`, slots.length ? 'btn' : 'btn primary', slotForLang(b, l), l)).join('')}</div>`;
    html += `<div class="muted small">${slots.length ? 'İkinci dosyayı da eklersen okurken ⇄ düğmesiyle aralarında geçebilirsin; ikisinin ilerlemesi ayrı kaydedilir.' : 'Kitabın orijinal metnini ve çevirisini ayrı ayrı ekleyebilirsin (PDF / EPUB); her birinin ilerlemesi ayrı kaydedilir.'}</div>`;
  }
  if (!slots.length) {
    const pct = progressOf(b, 1);
    const p = b.progress || {};
    if (pct != null) html += `<div><div style="display:flex;justify-content:space-between;font-size:14px"><span>${p.page && p.pages ? `Sayfa ${p.page} / ${p.pages}` : 'İlerleme'}</span><b>%${Math.floor(pct)}</b></div><div class="progress" style="height:8px"><span style="width:${pct}%"></span></div></div>`;
    html += '<button class="btn" id="manual">📏 İlerlemeyi elle gir (basılı kitap)</button>';
  }
  html += time;
  sec.innerHTML = html;

  $$('input[type=file]', sec).forEach(inp => inp.addEventListener('change', async e => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const slot = Number(inp.dataset.slot) || 1, lang = inp.dataset.lang || undefined;
    toast('Dosya ekleniyor…');
    try { const r = await attachFile(slotBook(b, slot), f, lang); toast(r?.sameFile ? '📎 Dosya eklendi · ilerlemen korundu' : '📎 Dosya eklendi'); }
    catch (err) { toast(err.message); }
  }));
  $$('[data-rm]', sec).forEach(btn => btn.addEventListener('click', async () => {
    const slot = Number(btn.dataset.rm);
    if (!(await confirmSheet('Dosyayı kaldır', `${langLabel(slotFile(b, slot))} dosyası bu cihazdan silinecek. İlerlemen, yer imlerin ve notların kalır.`, 'Kaldır'))) return;
    await detachFile(slotBook(b, slot)); toast('Dosya kaldırıldı');
  }));
  $$('[data-ai]', sec).forEach(btn => btn.addEventListener('click', async () => (await import('./sendbook.js')).openSendBook(slotBook(b, Number(btn.dataset.ai)))));
  $$('[data-setlang]', sec).forEach(btn => btn.addEventListener('click', async () => {
    const slot = Number(btn.dataset.slot), lang = btn.dataset.setlang;
    const other = slotFile(b, slot === 2 ? 1 : 2);
    slotFile(b, slot).lang = lang;
    if (other && other.lang === lang) other.lang = lang === 'orig' ? 'tr' : 'orig';
    await saveBook(b); toast(`${LANGS[lang]} olarak işaretlendi`);
  }));
  $('#manual', sec)?.addEventListener('click', () => manualProgress(b));
}

function manualProgress(b) {
  const p = b.progress || {};
  sheet({
    title: 'Okuma ilerlemesi',
    body: `<div class="form-group">
        <div class="field inline"><label for="mp-page">Kaldığım sayfa</label><input id="mp-page" type="number" inputmode="numeric" min="0" value="${p.page ?? ''}"></div>
        <div class="field inline"><label for="mp-pages">Toplam sayfa</label><input id="mp-pages" type="number" inputmode="numeric" min="1" value="${p.pages ?? ''}"></div></div>`,
    foot: '<button class="btn" data-close>Vazgeç</button><button class="btn primary" id="mp-save">Kaydet</button>',
    onMount: (el, close) => $('#mp-save', el).addEventListener('click', async () => {
      const page = Number($('#mp-page', el).value), pages = Number($('#mp-pages', el).value);
      if (!pages || page < 0 || page > pages) { toast('Sayfa sayılarını kontrol et'); return; }
      b.progress = { manual: true, page, pages, loc: page, percent: (page / pages) * 100, label: `Sayfa ${page} / ${pages}`, updatedAt: Date.now() };
      if (page > 0 && b.status !== 'Okunuyor' && b.status !== 'Okundu') b.status = 'Okunuyor';
      if (page === pages && b.status !== 'Okundu') {
        close();
        if (await confirmSheet('Kitabı bitirdin mi?', 'Son sayfaya geldin. Okundu olarak işaretleyeyim mi?', '✅ Okundu', false)) b.status = 'Okundu';
      } else close();
      await saveBook(b);
      toast('İlerleme kaydedildi');
    }),
  });
}
