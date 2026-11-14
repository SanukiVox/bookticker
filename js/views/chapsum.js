// Bölüm özeti: içinde bulunulan bölüm (kalınan yere kadar) ya da önceki bölüm, spoilersız kısa Türkçe özet.
// Claude anahtarı varsa uygulama içinde; yoksa istem + bölüm metni panoya kopyalanır (ücretsiz yol).
import { displayTitle } from '../store.js';
import { esc, sheet, toast, $, $$ } from '../ui.js';

const promptFor = (book, label, partial) => [
  `Aşağıda "${displayTitle(book)}"${book.author ? ` (${book.author})` : ''} kitabının ${label ? `"${label}" bölümünün` : 'bir bölümünün'} ${partial ? 'şu ana kadar okuduğum kısmı' : 'tamamı'} var.`,
  'Bunu Türkçe olarak özetle:',
  '- 5–8 madde, her madde tek cümle; olayları sırasıyla anlat.',
  '- Karakter ve yer adlarını kitaptaki gibi bırak.',
  '- En sona "Bu bölümde öne çıkan:" diye tek cümlelik bir not ekle (ilişki gelişimi, önemli ipucu vb.).',
  '- Metnin sonrasında olacaklar hakkında kesinlikle spoiler verme, tahmin yürütme.',
  '- Metinden uzun alıntı yapma.',
].join('\n');

// Okuyucudaki 🤖 düğmesi: EPUB'da seçenekler
export function openAiMenu(book, { onSendBook }) {
  sheet({
    title: '🤖 Yapay zekâ',
    body: `<div class="list">
      <button class="row" data-a="current" style="width:100%;border:0;background:none;text-align:left"><span style="font-size:22px">📄</span><div class="body"><div class="t">Bu bölümü özetle</div><div class="s">Okuduğun yere kadar · spoiler yok</div></div></button>
      <button class="row" data-a="prev" style="width:100%;border:0;background:none;text-align:left"><span style="font-size:22px">⏮</span><div class="body"><div class="t">Önceki bölümü özetle</div><div class="s">Bölüm bitince hatırlamak için</div></div></button>
      <button class="row" data-a="send" style="width:100%;border:0;background:none;text-align:left"><span style="font-size:22px">📤</span><div class="body"><div class="t">Kitabı yapay zekâya gönder</div><div class="s">Okuduğun yere kadar ya da tamamı, soru sormak için</div></div></button>
    </div>`,
    onMount: (el, close) => $$('[data-a]', el).forEach(b => b.addEventListener('click', () => {
      close();
      if (b.dataset.a === 'send') onSendBook();
      else setTimeout(() => openChapterSummary(book, b.dataset.a), 250);
    })),
  });
}

export async function openChapterSummary(book, which = 'current') {
  const { hasKey, chat } = await import('../ai.js');
  const keyed = await hasKey();
  sheet({
    title: which === 'prev' ? '⏮ Önceki bölümün özeti' : '📄 Bu bölümün özeti',
    body: `<div id="cs-body"><div class="muted">Bölüm metni hazırlanıyor…</div></div>`,
    onMount: async (el, close) => {
      const body = $('#cs-body', el);
      let ch;
      try { ch = await (await import('../booktext.js')).chapterText(book, { which }); }
      catch (e) { body.innerHTML = `<div class="warn">${esc(e.message || 'Bölüm okunamadı')}</div>`; return; }
      const prompt = promptFor(book, ch.label, ch.partial);
      const full = `${prompt}\n\n---\n${ch.text}`;
      const k = Math.round(ch.text.length / 1000);
      body.innerHTML = `<div class="small muted" style="margin-bottom:10px">${ch.label ? `<b>${esc(ch.label)}</b> · ` : ''}~${k} bin karakter${ch.partial ? ' · okuduğun yere kadar' : ''}</div>
        ${keyed ? '<button class="btn primary block" id="cs-run">🤖 Claude ile özetle</button><div class="small muted" style="margin:6px 0 12px">Anahtarındaki bakiyeden kısa bir istek harcar.</div>' : ''}
        <div id="cs-out" class="prose"></div>
        <details ${keyed ? '' : 'open'} style="margin-top:10px"><summary class="small">Ücretsiz yol: kopyala, Claude ya da ChatGPT'ye yapıştır</summary>
          <div class="btn-row" style="margin-top:8px"><button class="btn" id="cs-copy">📋 Bölümü ve istemi kopyala</button><a class="btn" href="https://claude.ai/new" target="_blank" rel="noopener">Claude ↗</a><a class="btn" href="https://chatgpt.com/" target="_blank" rel="noopener">ChatGPT ↗</a></div></details>`;
      $('#cs-copy', el).addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(full); toast('📋 Kopyalandı; sohbete yapıştır'); } catch { toast('Kopyalanamadı'); }
      });
      $('#cs-run', el)?.addEventListener('click', async e => {
        const btn = e.currentTarget, out = $('#cs-out', el);
        btn.disabled = true; btn.textContent = '🤖 Özetleniyor…';
        let acc = '';
        try {
          const res = await chat({
            system: 'Kitap okuyan birine bölüm özetleri hazırlayan bir asistansın. Spoiler vermez, metinden uzun alıntı yapmazsın.',
            messages: [{ role: 'user', content: full }],
            onText: t => { acc += t; out.textContent = acc; },
          });
          out.textContent = res.text || acc;
          btn.remove();
        } catch (err) { btn.disabled = false; btn.textContent = '🤖 Tekrar dene'; toast(err.message || 'İstek başarısız'); }
      });
    },
  });
}
