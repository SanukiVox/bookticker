// Ayarlar → Eksik kapak ve özetleri internetten toplu doldur.
import { state, saveBooks, displayTitle, norm } from '../store.js';
import { db } from '../db.js';
import { candidates, imageOk } from '../lookup.js';
import { fetchAsBlob } from './edit.js';
import { sheet, toast, $ } from '../ui.js';

const wait = ms => new Promise(r => setTimeout(r, ms));

async function firstGoodImage(list) {
  for (const r of list) {
    if (r.img && await imageOk(r.img)) return r.img;
  }
  return null;
}

async function saveCover(book, which, url) {
  const blob = await fetchAsBlob(url);
  if (!blob) return url; // adres olarak sakla
  const key = `${book.id}-${which}-${Date.now().toString(36)}`;
  await db.putCover(key, blob);
  return key;
}

export function openAutofill() {
  const missTr = state.books.filter(b => !b.coverTr).length;
  const missOrig = state.books.filter(b => b.originalTitle && !b.coverOrig).length;
  const missSum = state.books.filter(b => !b.summary).length;
  const missYear = state.books.filter(b => !b.pubYear).length;
  let stop = false;
  sheet({
    title: 'Eksikleri internetten bul',
    body: `
      <p class="small muted">Google Books ve Open Library'de her kitabı adı ve yazarıyla arar, ilk uygun sonucu ekler. Bazı sonuçlar yanlış çıkabilir; kitap sayfasından <b>Düzenle → 🔍 Bul</b> ile değiştirebilirsin. Var olan kapak ve özetlere dokunulmaz.</p>
      <div class="form-group">
        <div class="set-row"><span>Türkçe kapak <span class="muted small">(${missTr} eksik)</span></span><span class="toggle"><input type="checkbox" id="af-tr" ${missTr ? 'checked' : ''}><span></span></span></div>
        <div class="set-row"><span>Orijinal kapak <span class="muted small">(${missOrig} eksik)</span></span><span class="toggle"><input type="checkbox" id="af-orig" ${missOrig ? 'checked' : ''}><span></span></span></div>
        <div class="set-row"><span>Özet <span class="muted small">(${missSum} eksik)</span></span><span class="toggle"><input type="checkbox" id="af-sum" ${missSum ? 'checked' : ''}><span></span></span></div>
        <div class="set-row"><span>Yayın yılı <span class="muted small">(${missYear} eksik)</span></span><span class="toggle"><input type="checkbox" id="af-year" ${missYear ? 'checked' : ''}><span></span></span></div>
        <div class="set-row"><span>Türkçe özet yoksa İngilizce kullan</span><span class="toggle"><input type="checkbox" id="af-en"><span></span></span></div>
      </div>
      <div id="af-prog" class="hidden"><div class="small" id="af-txt" style="margin-bottom:6px"></div><div class="progress" style="height:10px"><span id="af-bar" style="width:0%"></span></div>
        <div class="small muted" id="af-cur" style="margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></div></div>
      <p class="small muted">Wi-Fi'de yapmanı öneririm. Uygulamayı açık tut; durdurursan o ana kadar bulunanlar kaydedilir.</p>`,
    foot: '<button class="btn" id="af-stop">Kapat</button><button class="btn primary" id="af-go">Başlat</button>',
    onMount: (el, close) => {
      $('#af-stop', el).addEventListener('click', () => { stop = true; close(); });
      $('#af-go', el).addEventListener('click', async () => {
        if (!navigator.onLine) { toast('İnternet bağlantısı gerekiyor'); return; }
        const o = { tr: $('#af-tr', el).checked, orig: $('#af-orig', el).checked, sum: $('#af-sum', el).checked, en: $('#af-en', el).checked, year: $('#af-year', el).checked };
        const todo = state.books.filter(b => (o.tr && !b.coverTr) || (o.orig && b.originalTitle && !b.coverOrig) || (o.sum && !b.summary) || (o.year && !b.pubYear));
        if (!todo.length) { toast('Eksik bir şey yok'); return; }
        $('#af-go', el).disabled = true; $('#af-go', el).textContent = 'Çalışıyor…';
        $('#af-stop', el).textContent = 'Durdur';
        $('#af-prog', el).classList.remove('hidden');
        let found = { tr: 0, orig: 0, sum: 0, year: 0 }, batch = [];
        for (let i = 0; i < todo.length && !stop; i++) {
          const b = todo[i];
          $('#af-txt', el).textContent = `${i + 1} / ${todo.length} kitap · ${found.tr + found.orig} kapak, ${found.sum} özet bulundu`;
          $('#af-bar', el).style.width = `${((i + 1) / todo.length) * 100}%`;
          $('#af-cur', el).textContent = displayTitle(b);
          let changed = false;
          try {
            let trList = [];
            if ((o.tr && !b.coverTr) || (o.sum && !b.summary) || (o.year && !b.pubYear && !b.originalTitle)) trList = await candidates(b, 'tr');
            if (o.tr && !b.coverTr) {
              const trOnly = trList.filter(r => r.lang === 'tr' || r.lang === 'tur');
              const img = await firstGoodImage(trOnly.length ? trOnly : (b.originalTitle ? [] : trList));
              if (img) { b.coverTr = await saveCover(b, 'tr', img); found.tr++; changed = true; }
            }
            let origList = [];
            if ((o.orig && b.originalTitle && !b.coverOrig) || (o.sum && !b.summary && o.en) || (o.year && !b.pubYear)) origList = b.originalTitle ? await candidates(b, 'orig') : [];
            if (o.orig && b.originalTitle && !b.coverOrig) {
              const img = await firstGoodImage(origList);
              if (img) { b.coverOrig = await saveCover(b, 'orig', img); found.orig++; changed = true; }
            }
            if (o.year && !b.pubYear) {
              // İlk yayın yılı: adı eşleşen sonuçlar arasındaki en eski yıl
              const pool = (b.originalTitle ? origList : trList).filter(r => r.year && /^\d{4}$/.test(String(r.year)));
              const t = norm(b.originalTitle || b.title);
              // Adı birebir aynı olan, en çok baskısı bulunan ana kaydın yılı (derleme/boyama kitabı gibi kayıtlara takılmaz)
              const valid = r => { const y = Number(r.year); return y > 1500 && y <= new Date().getFullYear() + 1; };
              const exact = pool.filter(r => norm(r.title) === t && valid(r)).sort((a, z) => (z.editions || 0) - (a.editions || 0));
              const best = exact[0] || pool.find(valid);
              if (best) { b.pubYear = Number(best.year); found.year = (found.year || 0) + 1; changed = true; }
            }
            if (o.sum && !b.summary) {
              const tr = trList.find(r => r.description && (r.lang === 'tr' || r.lang === 'tur'));
              const any = o.en ? [...trList, ...origList].find(r => r.description) : null;
              const d = (tr || any)?.description;
              if (d) { b.summary = d; found.sum++; changed = true; }
            }
          } catch { /* bu kitabı atla */ }
          if (changed) batch.push(b);
          if (batch.length >= 15) { await saveBooks(batch); batch = []; }
          await wait(350);
        }
        if (batch.length) await saveBooks(batch);
        $('#af-txt', el).textContent = `${stop ? 'Durduruldu' : 'Bitti'} · ${found.tr} Türkçe kapak, ${found.orig} orijinal kapak, ${found.sum} özet${found.year ? `, ${found.year} yayın yılı` : ''} eklendi`;
        $('#af-cur', el).textContent = '';
        $('#af-go', el).textContent = 'Bitti'; $('#af-stop', el).textContent = 'Kapat';
        toast(`${found.tr + found.orig} kapak, ${found.sum} özet eklendi`);
      });
    },
  });
}

