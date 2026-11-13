// Kitap sayfasındaki "Kitap dosyası ve ilerleme" bölümü.
import { saveBook } from '../store.js';
import { esc, enc, toast, sheet, confirmSheet, $ } from '../ui.js';
import { attachFile, detachFile, hasLocalFile, formatSize, formatDuration, progressOf } from '../files.js';

const ACCEPT = '.pdf,.epub,application/pdf,application/epub+zip';

export function fileSectionShell() {
  return '<div class="section read-card" id="file-sec"><h3>Okuma</h3><div class="muted small">…</div></div>';
}

export async function fillFileSection(view, b) {
  const sec = $('#file-sec', view);
  if (!sec) return;
  const local = await hasLocalFile(b);
  const pct = progressOf(b);
  const p = b.progress || {};
  const progressLine = pct != null
    ? `<div><div style="display:flex;justify-content:space-between;font-size:14px"><span>${p.page && p.pages ? `Sayfa ${p.page} / ${p.pages}` : 'İlerleme'}</span><b>%${Math.floor(pct)}</b></div>
       <div class="progress" style="height:8px"><span style="width:${pct}%"></span></div></div>` : '';
  const time = b.readingSeconds ? `<div class="muted small">⏱ Toplam okuma süresi: <b>${formatDuration(b.readingSeconds)}</b>${(b.bookmarks || []).length ? ` · 🔖 ${b.bookmarks.length} yer imi` : ''}</div>` : '';
  const filePick = (label, cls = 'btn') => `<label class="${cls}" style="position:relative;overflow:hidden">${label}<input type="file" accept="${ACCEPT}" id="file-in" style="position:absolute;inset:0;opacity:0"></label>`;

  let html = '<h3>Okuma</h3>';
  if (b.file && local) {
    html += `
      <div class="read-cta"><a class="btn primary" href="#/read/${enc(b.id)}">📖 ${b.status === 'Okundu' && pct >= 100 ? 'Yeniden oku' : pct ? `Okumaya devam et · %${Math.floor(pct)}` : 'Okumaya başla'}</a></div>
      ${progressLine}${time}
      <button class="btn block" id="send-ai">🤖 Kitabı yapay zekâya gönder (ücretsiz)</button>
      <div class="file-chip">📄 <b>${esc(b.file.name)}</b><span>${b.file.type.toUpperCase()} · ${formatSize(b.file.size)}</span></div>
      <div class="btn-row">${filePick('Dosyayı değiştir', 'mini-btn')}<button class="mini-btn" id="file-rm" style="color:var(--danger);background:transparent">Dosyayı kaldır</button></div>`;
  } else if (b.file) {
    html += `<div class="warn">📄 <span><b>${esc(b.file.name)}</b> başka bir telefonda eklenmiş. Dosyalar sadece eklendiği telefonda saklanır; burada okumak için yeniden ekle. İlerlemen korunur.</span></div>
      ${progressLine}${time}${filePick('📎 Dosyayı yeniden ekle', 'btn block')}`;
  } else {
    html += `${progressLine}${time}
      <div class="btn-row">${filePick('📎 PDF / EPUB ekle', 'btn primary')}<button class="btn" id="manual">📏 İlerlemeyi elle gir</button></div>
      <div class="muted small">Dosya eklersen kitabı uygulamanın içinde okuyabilirsin. Basılı kitap okuyorsan sayfanı elle girebilirsin.</div>`;
  }
  sec.innerHTML = html;

  $('#file-in', sec)?.addEventListener('change', async e => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    toast('Dosya ekleniyor…');
    try { const r = await attachFile(b, f); toast(r?.sameFile ? '📎 Dosya eklendi · ilerlemen korundu' : '📎 Dosya eklendi'); }
    catch (err) { toast(err.message); }
  });
  $('#file-rm', sec)?.addEventListener('click', async () => {
    if (!(await confirmSheet('Dosyayı kaldır', 'Kitap dosyası bu telefondan silinecek. İlerlemen, yer imlerin ve notların kalır.', 'Kaldır'))) return;
    await detachFile(b); toast('Dosya kaldırıldı');
  });
  $('#manual', sec)?.addEventListener('click', () => manualProgress(b));
  $('#send-ai', sec)?.addEventListener('click', async () => (await import('./sendbook.js')).openSendBook(b));
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
