// "Kitabı yapay zekâya gönder": metni .txt yapıp paylaşım menüsüyle Claude/ChatGPT/Gemini'ye verir (ücretsiz).
import { displayTitle } from '../store.js';
import { esc, sheet, toast, $, $$ } from '../ui.js';
import { extractText, bookTextFile } from '../booktext.js';

const QUESTIONS = [
  'Şu ana kadar olanları kısaca özetle.',
  'Karakterleri ve aralarındaki ilişkileri hatırlat.',
  'Son okuduğum bölümde neler oldu?',
  'Şu ana kadarki önemli olayları ve ipuçlarını madde madde yaz.',
];

function promptFor(book, partial, q) {
  return [
    `Ekteki dosya, okuduğum "${displayTitle(book)}"${book.author ? ` (${book.author})` : ''} kitabının ${partial ? 'şu ana kadar okuduğum kısmı' : 'tamamı'}.`,
    partial ? 'Bu kısmın sonrasında olacaklarla ilgili kesinlikle spoiler verme; sadece dosyadaki bilgiye dayan.' : '',
    'Kitaptan uzun bölümleri aynen aktarma; özetle ve kendi cümlelerinle anlat. Türkçe cevap ver.',
    '',
    `Sorum: ${q}`,
  ].filter(Boolean).join('\n');
}

export function openSendBook(book) {
  const p = book.progress || {};
  const hasPos = !!p.loc && (p.percent ?? 0) > 0 && (p.percent ?? 0) < 100;
  let file = null, partial = hasPos;
  sheet({
    title: 'Kitabı yapay zekâya gönder',
    body: `
      <p class="muted small">Kitabın metni bir dosyaya çevrilir; paylaşım menüsünden <b>Claude</b>, <b>ChatGPT</b> ya da <b>Gemini</b> uygulamasını seçip ücretsiz hakkınla sorarsın. Kitap Kitaplığım'dan başka yere gönderilmez.</p>
      <div class="seg" style="margin-top:10px">
        <button data-mode="part" class="${hasPos ? 'on' : ''}" ${hasPos ? '' : 'disabled style="opacity:.4"'}>Okuduğum yere kadar${hasPos ? ` · %${Math.floor(p.percent)}` : ''}</button>
        <button data-mode="all" class="${hasPos ? '' : 'on'}">Tüm kitap</button></div>
      <p class="muted small" id="sb-hint">${hasPos ? '🙈 Spoiler yok: sadece okuduğun kısım gider.' : 'Henüz okuyucuda ilerleme yok; tüm kitap gönderilir.'}</p>
      <button class="btn block primary" id="sb-make">📄 Dosyayı hazırla</button>
      <div id="sb-prog" class="hidden" style="margin-top:12px"><div class="progress" style="height:8px"><span id="sb-bar" style="width:0%"></span></div><div class="small muted" id="sb-ptxt" style="margin-top:6px">Metin çıkarılıyor…</div></div>
      <div id="sb-ready" class="hidden" style="margin-top:14px">
        <div class="small" id="sb-size"></div>
        <h3 style="margin:14px 0 8px">1. Sorunu seç ve kopyala</h3>
        <div class="chip-wrap">${QUESTIONS.map((q, i) => `<button class="chip q-chip" data-q="${i}">${esc(q)}</button>`).join('')}</div>
        <div class="form-group" style="margin-top:10px"><div class="field"><textarea id="sb-q" placeholder="ya da kendi sorunu yaz">${esc(QUESTIONS[0])}</textarea></div></div>
        <button class="btn block" id="sb-copy">📋 Soruyu kopyala</button>
        <h3 style="margin:16px 0 8px">2. Dosyayı gönder</h3>
        <button class="btn block primary" id="sb-share">📤 Paylaş → Claude / ChatGPT / Gemini</button>
        <button class="btn block" id="sb-dl" style="margin-top:8px">⬇️ Dosyayı indir</button>
        <p class="muted small" style="margin-top:10px">Açılan sohbette mesaj kutusuna uzun basıp <b>Yapıştır</b> de ve gönder. Dosya sohbete eklenmiş olur.</p>
      </div>`,
    onMount: el => {
      $$('[data-mode]', el).forEach(b => b.addEventListener('click', () => {
        if (b.disabled) return;
        partial = b.dataset.mode === 'part';
        $$('[data-mode]', el).forEach(x => x.classList.toggle('on', x === b));
        $('#sb-hint', el).textContent = partial ? '🙈 Spoiler yok: sadece okuduğun kısım gider.' : '⚠️ Tüm kitap gider; asistan sonrasını da bilir.';
        file = null; $('#sb-ready', el).classList.add('hidden'); $('#sb-make', el).classList.remove('hidden');
      }));
      $('#sb-make', el).addEventListener('click', async () => {
        $('#sb-make', el).classList.add('hidden');
        $('#sb-prog', el).classList.remove('hidden');
        try {
          const res = await extractText(book, { upToProgress: partial, onProgress: f => { $('#sb-bar', el).style.width = `${Math.round(f * 100)}%`; } });
          if (!res.text || res.text.length < 50) throw new Error('Bu dosyadan metin çıkarılamadı (taranmış/görsel PDF olabilir)');
          file = bookTextFile(book, res);
          const k = Math.round(res.text.length / 1000);
          $('#sb-size', el).innerHTML = `✅ Hazır: <b>${esc(file.name)}</b> · ~${k} bin karakter${k > 400 ? '<br><span style="color:var(--danger)">Çok uzun; ücretsiz planlar kabul etmeyebilir. Sorun olursa "Okuduğum yere kadar"ı dene.</span>' : ''}`;
          $('#sb-prog', el).classList.add('hidden');
          $('#sb-ready', el).classList.remove('hidden');
        } catch (e) {
          $('#sb-ptxt', el).textContent = `⚠️ ${e.message}`;
          $('#sb-make', el).classList.remove('hidden');
        }
      });
      $$('[data-q]', el).forEach(c => c.addEventListener('click', () => { $('#sb-q', el).value = QUESTIONS[Number(c.dataset.q)]; }));
      $('#sb-copy', el).addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(promptFor(book, partial, $('#sb-q', el).value.trim() || QUESTIONS[0])); toast('📋 Soru kopyalandı'); }
        catch { toast('Kopyalanamadı'); }
      });
      $('#sb-share', el).addEventListener('click', async () => {
        if (!file) return;
        if (navigator.canShare?.({ files: [file] })) {
          try { await navigator.share({ files: [file], title: displayTitle(book) }); } catch { /* vazgeçildi */ }
        } else download(file);
      });
      $('#sb-dl', el).addEventListener('click', () => file && download(file));
    },
  });
}

function download(file) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast('⬇️ Dosya indirildi');
}
