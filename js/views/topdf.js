// "📄 PDF'e çevir" penceresi: EPUB'ı küçük, gerçek metinli bir PDF'e dönüştürür.
import { saveBook, displayTitle } from '../store.js';
import { esc, toast, sheet, $, $$ } from '../ui.js';
import { getFileBlob, attachFile, slotBook, slotFile, progressOf, formatSize } from '../files.js';

export function openToPdf(b, slot) {
  const book = slotBook(b, slot);
  const f = slotFile(b, slot);
  let size = localStorage.getItem('topdf.size') || 'phone', fs = localStorage.getItem('topdf.fs') || 'm';
  let result = null;
  sheet({
    title: '📄 PDF\'e çevir',
    body: `<div id="tp-body">
      <p class="small muted" style="margin-top:0">EPUB, kitap gibi dizilmiş gerçek metinli bir PDF'e çevrilir: iki yana yaslı, bölümler yeni sayfada, içindekiler ve resimler yerinde. Dosya küçük olur; internet gerektirmez (ilk seferde yazı tipi indirilir).</p>
      <div class="f-block"><h3>Sayfa boyutu</h3><div class="chip-wrap" id="tp-size"></div></div>
      <div class="f-block"><h3>Yazı boyutu</h3><div class="chip-wrap" id="tp-fs"></div></div>
    </div>`,
    foot: '<button class="btn" data-close>Vazgeç</button><button class="btn primary" id="tp-go">Çevir</button>',
    onMount: async (el, close) => {
      const { SIZES, FONT_SIZES } = await import('../epub2pdf.js');
      const chips = () => {
        $('#tp-size', el).innerHTML = Object.entries(SIZES).map(([k, s]) => `<button class="chip ${k === size ? 'on' : ''}" data-size="${k}">${s.label}</button>`).join('');
        $('#tp-fs', el).innerHTML = Object.entries(FONT_SIZES).map(([k, [l]]) => `<button class="chip ${k === fs ? 'on' : ''}" data-fs="${k}">${l}</button>`).join('');
        $$('[data-size]', el).forEach(x => x.addEventListener('click', () => { size = x.dataset.size; chips(); }));
        $$('[data-fs]', el).forEach(x => x.addEventListener('click', () => { fs = x.dataset.fs; chips(); }));
      };
      chips();
      const go = $('#tp-go', el);
      go.addEventListener('click', async () => {
        if (result) return;
        try { localStorage.setItem('topdf.size', size); localStorage.setItem('topdf.fs', fs); } catch { /* yok */ }
        go.disabled = true;
        $('#tp-body', el).innerHTML = '<p><b id="tp-msg">Hazırlanıyor…</b></p><div class="progress" style="height:8px"><span id="tp-bar" style="width:2%"></span></div><p class="small muted">Uzun kitaplarda bir iki dakika sürebilir; bu pencereyi açık tut.</p>';
        try {
          const blob = await getFileBlob(book);
          if (!blob) throw new Error('EPUB dosyası bu cihazda yok');
          const { epubToPdf } = await import('../epub2pdf.js');
          const t0 = Date.now();
          result = await epubToPdf(blob, {
            size, fontSize: fs, lang: f.lang === 'orig' ? 'en' : 'tr', title: displayTitle(b), author: b.author || '',
            onProgress: (p, msg) => { const bar = $('#tp-bar', el); if (bar) bar.style.width = `${Math.round(p * 100)}%`; const m = $('#tp-msg', el); if (m && msg) m.textContent = msg; },
          });
          const name = `${(displayTitle(b) || 'kitap').replace(/[\\/:*?"<>|]+/g, ' ').trim()}.pdf`;
          result.file = new File([result.blob], name, { type: 'application/pdf' });
          $('#tp-body', el).innerHTML = `<p>✅ <b>${esc(name)}</b><br><span class="muted">${result.pages} sayfa · ${formatSize(result.blob.size)} · ${Math.max(1, Math.round((Date.now() - t0) / 1000))} sn</span><br><span class="small muted">EPUB: ${formatSize(f.size || blob.size)}</span></p>
            <div class="btn-row" style="flex-direction:column;align-items:stretch">
              <button class="btn" id="tp-preview">👁 Önizle</button>
              <button class="btn primary" id="tp-use">📎 EPUB yerine bu PDF'i kullan</button>
              <button class="btn" id="tp-save">📥 Dosyalara kaydet / paylaş</button>
            </div>
            <p class="small muted">"EPUB yerine kullan" dersen kitabın dosyası bu PDF olur; okumada kaldığın yer yaklaşık aynı sayfaya taşınır. EPUB silinir, istersen önce Dosyalara kaydet.</p>`;
          go.remove();
          $('#tp-preview', el).addEventListener('click', () => { const u = URL.createObjectURL(result.blob); window.open(u, '_blank'); setTimeout(() => URL.revokeObjectURL(u), 60000); });
          $('#tp-save', el).addEventListener('click', async () => {
            try {
              if (navigator.canShare?.({ files: [result.file] })) { await navigator.share({ files: [result.file], title: name }); return; }
            } catch (e) { if (e?.name === 'AbortError') return; }
            const a = document.createElement('a'); a.href = URL.createObjectURL(result.blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 60000);
          });
          $('#tp-use', el).addEventListener('click', async e => {
            e.currentTarget.disabled = true;
            const pct = progressOf(b, slot);
            try {
              await attachFile(book, result.file, f.lang || undefined);
              if (pct != null && pct > 0) {
                const pages = result.pages, page = Math.min(pages, Math.max(1, Math.round((pct / 100) * pages)));
                const target = slotBook(b, slot);
                target.progress = { loc: page, page, pages, percent: (page / pages) * 100, label: `Sayfa ${page} / ${pages}`, chapter: '', atEnd: page === pages, updatedAt: Date.now() };
                await saveBook(b);
              }
              toast('📄 Kitabın dosyası artık PDF');
              close();
            } catch (err) { toast(err.message); e.currentTarget.disabled = false; }
          });
        } catch (err) {
          console.error(err);
          $('#tp-body', el).innerHTML = `<p class="warn">⚠️ ${esc(err.message || 'Çevrilemedi')}</p>`;
          go.disabled = false; go.textContent = 'Tekrar dene'; result = null;
        }
      });
    },
  });
}
