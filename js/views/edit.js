// Kitap ekleme / düzenleme formu.
import { goodreadsUrl } from '../store.js';
import { state, getBook, newBook, saveBook, deleteBook, CRITERIA, SPICY_LABELS, OPTION_LISTS, computeScore, authors, seriesList, norm, displayTitle, saveOptions } from '../store.js';
import { db } from '../db.js';
import { candidates, summaryCandidates, isUrl, imageOk } from '../lookup.js';
import { cropImage } from './cropper.js';
import { esc, enc, coverHTML, forgetCover, toast, confirmSheet, promptSheet, sheet, $, $$, fmtScore } from '../ui.js';

// Fotoğrafı küçültüp JPEG'e çevir (telefonda yer kaplamasın).
export async function shrinkImage(file, maxH = 900) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Görsel okunamadı')); i.src = url; });
    const scale = Math.min(1, maxH / img.naturalHeight);
    const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return await new Promise(res => c.toBlob(res, 'image/jpeg', 0.85));
  } finally { URL.revokeObjectURL(url); }
}

// 1–5 (spicy 0–5) ve ½: önce tam sayıyı seç, ½ ile yarım ekle (4 → 4,5)
const hasVal = v => v !== null && v !== '' && v !== undefined;
const scoreRow = (key, label, val, min = 1) => `
  <div class="field"><span class="lbl">${label} <b class="rate-val" data-val="${key}">${hasVal(val) ? fmtScore(val) : ''}</b></span>
    <div class="rating" data-rate="${key}" data-min="${min}">${Array.from({ length: 6 - min }, (_, i) => i + min).map(n => `<button type="button" class="${hasVal(val) && Math.floor(Number(val)) === n ? 'on' : ''}" data-n="${n}">${n}</button>`).join('')}
    <button type="button" class="half ${hasVal(val) && Number(val) % 1 ? 'on' : ''}" data-half aria-label="Yarım puan">½</button>
    <button type="button" class="clear" data-n="" aria-label="Temizle">✕</button></div></div>`;

export async function renderEdit(view, [id], query) {
  const isNew = id === 'new';
  const orig = isNew ? null : getBook(id);
  if (!isNew && !orig) { location.replace('#/'); return; }
  const b = isNew
    ? newBook({ author: query.get('author') || '', series: query.get('series') || '', seriesOrder: query.get('order') ? Number(query.get('order')) : null })
    : structuredClone(orig);
  b.scores ||= {}; b.warnings ||= []; b.tags ||= [];

  // Kapaklar kaydedilene kadar hafızada tutulur.
  const covers = { tr: { blob: undefined, url: null }, orig: { blob: undefined, url: null } };
  let dirty = false;

  const selectField = (key, label, field) => {
    const opts = state.options[key];
    const cur = b[field] || '';
    const has = opts.some(o => o.name === cur);
    return `<div class="field"><label for="f-${field}">${label}</label><div class="with-add">
      <select id="f-${field}" data-field="${field}"><option value="">— Seç —</option>${!has && cur ? `<option selected>${esc(cur)}</option>` : ''}
      ${opts.map(o => `<option ${o.name === cur ? 'selected' : ''} value="${esc(o.name)}">${o.emoji ? o.emoji + ' ' : ''}${esc(o.name)}</option>`).join('')}</select>
      <button type="button" class="mini-btn" data-newopt="${key}" data-for="${field}">＋ Yeni</button></div></div>`;
  };

  const multiField = (key, label) => {
    const field = OPTION_LISTS[key].field;
    return `<div class="field"><span class="lbl">${label}</span><div class="check-list" data-multi="${field}">
      ${state.options[key].map(o => `<button type="button" class="chip ${b[field].includes(o.name) ? 'on' : ''}" data-v="${esc(o.name)}">${esc(o.name)}</button>`).join('')}
      <button type="button" class="chip" data-newmulti="${key}" style="border-style:dashed">＋ Yeni</button></div></div>`;
  };

  const coverSlot = (which, label) => `
    <div class="slot" data-slot="${which}"><div class="cover-holder">${coverHTML(b, { key: which === 'tr' ? b.coverTr : b.coverOrig, badge: false })}</div>
      <div class="small muted" style="margin-bottom:6px">${label}</div>
      <div class="btn-row"><button type="button" class="mini-btn" data-add="${which}">＋ Kapak</button>
      <button type="button" class="mini-btn" data-rmcover="${which}" style="color:var(--danger);background:transparent">Kaldır</button></div></div>`;

  view.innerHTML = `
    <div class="topbar"><button class="icon-btn" id="cancel">Vazgeç</button><div class="title">${isNew ? 'Yeni kitap' : 'Düzenle'}</div><button class="icon-btn" id="save" style="font-weight:700">Kaydet</button></div>
    <form id="form" autocomplete="off" onsubmit="return false">
      <div class="form-group-title">Kapaklar</div>
      <div class="form-group"><div class="cover-edit">${coverSlot('tr', 'Türkçe kapak')}${coverSlot('orig', 'Orijinal kapak')}</div></div>

      <div class="form-group-title">Kitap</div>
      <div class="form-group">
        <div class="field"><label for="f-title">Kitap adı (Türkçe) <span class="req">*</span></label><input id="f-title" data-field="title" value="${esc(b.title)}" placeholder="Örn. Cam Şato"><div class="small" id="dup" style="color:var(--danger)"></div></div>
        <div class="field"><label for="f-originalTitle">Orijinal adı</label><input id="f-originalTitle" data-field="originalTitle" value="${esc(b.originalTitle)}" placeholder="Örn. Throne of Glass"></div>
        <div class="field"><label for="f-author">Yazar</label><input id="f-author" data-field="author" data-suggest="author" value="${esc(b.author)}" placeholder="Yazmaya başla…"></div>
        <div class="field"><label for="f-series">Seri</label><input id="f-series" data-field="series" data-suggest="series" value="${esc(b.series)}" placeholder="Seri değilse boş bırak"></div>
        <div class="field inline"><label for="f-seriesOrder">Serideki sırası</label><input id="f-seriesOrder" data-field="seriesOrder" type="number" inputmode="decimal" min="0" step="0.5" value="${b.seriesOrder ?? ''}"></div>
        <div class="field inline"><label for="f-pubYear">Yayın yılı (orijinal)</label><input id="f-pubYear" data-field="pubYear" type="number" inputmode="numeric" min="1000" max="2100" placeholder="örn. 2019" value="${b.pubYear ?? ''}"></div>
        <div class="field inline"><label for="f-trDate">Türkçe çıkış tarihi</label><input id="f-trDate" data-field="trDate" inputmode="numeric" placeholder="2025 ya da 2025-06-20" value="${esc(b.trDate || '')}" style="width:150px;text-align:right"></div>
      </div>

      <div class="form-group-title">Durum ve sınıflandırma</div>
      <div class="form-group">
        ${selectField('statuses', 'Okuma durumu', 'status')}
        ${selectField('genres', 'Tür', 'genre')}
        ${selectField('translations', 'Türkçe çeviri', 'translation')}
        ${selectField('publishers', 'Türkçe yayınevi', 'publisher')}
        ${selectField('confidences', 'Güven', 'confidence')}
        <div class="field"><label for="f-inVisuals">Görsellerde var mı</label><input id="f-inVisuals" data-field="inVisuals" data-suggest="inVisuals" value="${esc(b.inVisuals)}"></div>
        <div class="field inline"><label for="f-priority">Okuma önceliği (1, 2, 3…)</label><input id="f-priority" data-field="priority" type="number" inputmode="numeric" min="1" value="${b.priority ?? ''}"></div>
        <div class="field inline"><label>❤️ Favori</label><span class="toggle"><input type="checkbox" id="f-favorite" ${b.favorite ? 'checked' : ''}><span></span></span></div>
      </div>

      <div class="form-group-title">Puanlar (1–5) · Genel uyum: <b id="live-score">${computeScore(b)?.toFixed(1) ?? '—'}</b></div>
      <div class="form-group">
        ${CRITERIA.map(c => scoreRow(c.key, c.label, b.scores[c.key])).join('')}
        ${scoreRow('spicy', 'Spicy / +18 (0–5)', b.spicy, 0)}
        <div class="small muted" id="spicy-hint" style="padding:0 14px 10px">${b.spicy !== null && b.spicy !== undefined ? esc(SPICY_LABELS[Math.floor(b.spicy)]) : ''}</div>
        <div class="field inline"><label for="f-goodreads">⭐ Goodreads puanı</label><input id="f-goodreads" data-field="goodreads" type="number" inputmode="decimal" min="0" max="5" step="0.01" placeholder="örn. 4,21" value="${b.goodreads ?? ''}"></div>
        <div class="field inline"><label for="f-goodreadsVotes">Goodreads oy sayısı</label><input id="f-goodreadsVotes" data-field="goodreadsVotes" type="number" inputmode="numeric" min="0" placeholder="isteğe bağlı" value="${b.goodreadsVotes ?? ''}"></div>
        <div style="padding:4px 14px 12px"><a class="mini-btn" id="gr-open" href="${goodreadsUrl(b)}" target="_blank" rel="noopener" style="display:inline-block">📗 Goodreads'te aç</a></div>
      </div>

      <div class="form-group-title">Özet ve değerlendirme</div>
      <div class="form-group">
        <div class="field"><label for="f-summary">Özet</label><textarea id="f-summary" data-field="summary" placeholder="Kitabın konusu…">${esc(b.summary)}</textarea>
          <div class="btn-row"><button type="button" class="mini-btn" id="paste-summary">📋 Yapıştır</button><button type="button" class="mini-btn" id="find-summary">＋ Özet bul</button></div></div>
        <div class="field"><label for="f-review">Kısa değerlendirme</label><textarea id="f-review" data-field="review" placeholder="Neden okumalı / okumamalı?">${esc(b.review)}</textarea></div>
      </div>

      <div class="form-group-title">Uyarılar ve etiketler</div>
      <div class="form-group">${multiField('warnings', 'İçerik uyarıları')}${multiField('tags', 'Etiketler (örn. düşmandan âşığa)')}</div>

      <div class="form-group-title">Benim okumam</div>
      <div class="form-group">
        <div class="field inline"><label for="f-startDate">Başlama tarihi</label><input id="f-startDate" type="date" data-field="startDate" value="${esc(b.startDate)}" style="width:auto"></div>
        <div class="field inline"><label for="f-endDate">Bitirme tarihi</label><input id="f-endDate" type="date" data-field="endDate" value="${esc(b.endDate)}" style="width:auto"></div>
        ${scoreRow('myRating', 'Benim puanım', b.myRating)}
        <div class="field"><label for="f-notes">Notlarım</label><textarea id="f-notes" data-field="notes">${esc(b.notes)}</textarea></div>
        <div class="field"><label for="f-quotes">Sevdiğim alıntılar</label><textarea id="f-quotes" data-field="quotes">${esc(b.quotes)}</textarea></div>
      </div>
      ${isNew ? '' : '<button type="button" class="btn block danger" id="delete" style="margin-top:6px">Kitabı sil</button>'}
      <button type="button" class="btn block primary" id="save2" style="margin-top:12px">Kaydet</button>
    </form>`;

  const form = $('#form', view);

  // Metin / seçim alanları
  $$('[data-field]', form).forEach(el => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
    const f = el.dataset.field;
    let v = el.value;
    if (['seriesOrder', 'priority', 'goodreadsVotes', 'pubYear'].includes(f)) v = v === '' ? null : Number(v);
    if (f === 'trDate') v = v.trim();
    if (f === 'goodreads') v = v === '' ? null : Math.max(0, Math.min(5, Number(String(v).replace(',', '.'))));
    if (['title', 'originalTitle', 'author'].includes(f)) setTimeout(() => { const a = $('#gr-open', form); if (a) a.href = goodreadsUrl(b); });
    b[f] = v; dirty = true;
    if (f === 'title' || f === 'originalTitle') checkDup();
  }));
  $('#f-favorite', form).addEventListener('change', e => { b.favorite = e.target.checked; dirty = true; });

  function checkDup() {
    const t = norm(b.title), o = norm(b.originalTitle);
    const d = state.books.find(x => x.id !== b.id && ((t && norm(x.title) === t) || (o && norm(x.originalTitle) === o)));
    $('#dup', form).innerHTML = d ? `Bu kitap zaten kayıtlı olabilir: <a href="#/book/${enc(d.id)}" style="text-decoration:underline">${esc(displayTitle(d))}</a>` : '';
  }

  // Puan butonları
  $$('[data-rate]', form).forEach(row => row.addEventListener('click', e => {
    const btn = e.target.closest('button[data-n], button[data-half]');
    if (!btn) return;
    const key = row.dataset.rate;
    const cur = key === 'spicy' ? b.spicy : key === 'myRating' ? b.myRating : b.scores[key];
    let n;
    if (btn.dataset.half !== undefined) {
      if (!hasVal(cur)) { toast('Önce bir puan seç, sonra ½ ekle'); return; }
      const whole = Math.floor(Number(cur));
      n = Number(cur) % 1 ? whole : (whole >= 5 ? 5 : whole + 0.5); // ½ aç/kapat; 5'in üstüne çıkmaz
      if (whole >= 5 && !(Number(cur) % 1)) { toast('5 en yüksek puan'); return; }
    } else {
      n = btn.dataset.n === '' ? null : Number(btn.dataset.n);
      // Tam sayıya basınca varsa yarımı koru (3,5 iken 4'e basınca 4,5)
      if (n !== null && hasVal(cur) && Number(cur) % 1 && n < 5) n += 0.5;
    }
    if (key === 'spicy') { b.spicy = n; $('#spicy-hint', form).textContent = n === null ? '' : SPICY_LABELS[Math.floor(n)]; }
    else if (key === 'myRating') b.myRating = n;
    else { if (n === null) delete b.scores[key]; else b.scores[key] = n; }
    $$('button[data-n]', row).forEach(x => x.classList.toggle('on', x.dataset.n !== '' && n !== null && Math.floor(n) === Number(x.dataset.n)));
    $('button[data-half]', row).classList.toggle('on', n !== null && n % 1 !== 0);
    $(`[data-val="${key}"]`, form).textContent = n === null ? '' : fmtScore(n);
    $('#live-score', view).textContent = computeScore(b)?.toFixed(1) ?? '—';
    dirty = true;
  }));

  // Çoklu seçim (uyarılar, etiketler)
  $$('[data-multi]', form).forEach(box => box.addEventListener('click', async e => {
    const c = e.target.closest('.chip');
    if (!c) return;
    const field = box.dataset.multi;
    if (c.dataset.newmulti) {
      const key = c.dataset.newmulti;
      const name = await promptSheet(`Yeni: ${OPTION_LISTS[key].label}`);
      if (!name) return;
      if (!state.options[key].some(o => o.name === name)) { state.options[key].push({ name }); await saveOptions(); }
      if (!b[field].includes(name)) b[field].push(name);
      const nc = document.createElement('button');
      nc.type = 'button'; nc.className = 'chip on'; nc.dataset.v = name; nc.textContent = name;
      c.before(nc); dirty = true;
      return;
    }
    const v = c.dataset.v;
    b[field] = b[field].includes(v) ? b[field].filter(x => x !== v) : [...b[field], v];
    c.classList.toggle('on'); dirty = true;
  }));

  // Seçenek listesine yeni değer ekle
  $$('[data-newopt]', form).forEach(btn => btn.addEventListener('click', async () => {
    const key = btn.dataset.newopt, field = btn.dataset.for;
    const name = await promptSheet(`Yeni: ${OPTION_LISTS[key].label}`);
    if (!name) return;
    if (!state.options[key].some(o => o.name === name)) {
      state.options[key].push(key === 'statuses' ? { name, emoji: '•', color: '#6b6370' } : { name });
      await saveOptions();
    }
    const sel = $(`#f-${field}`, form);
    if (![...sel.options].some(o => o.value === name)) sel.add(new Option(name, name));
    sel.value = name; b[field] = name; dirty = true;
  }));

  // Otomatik tamamlama (yazar, seri)
  $$('[data-suggest]', form).forEach(inp => {
    const field = inp.parentElement;
    const source = () => inp.dataset.suggest === 'author' ? authors().map(a => a.name).filter(n => n !== 'Yazarı bilinmiyor')
      : inp.dataset.suggest === 'series' ? seriesList().map(s => s.name)
      : [...new Set(state.books.map(x => x.inVisuals).filter(Boolean))];
    const close = () => field.querySelector('.suggest')?.remove();
    const show = () => {
      close();
      const q = norm(inp.value);
      const list = source().filter(n => (!q || norm(n).includes(q)) && n !== inp.value).slice(0, 8);
      if (!list.length) return;
      const box = document.createElement('div');
      box.className = 'suggest';
      box.innerHTML = list.map(n => `<button type="button">${esc(n)}</button>`).join('');
      box.addEventListener('pointerdown', e => {
        const t = e.target.closest('button'); if (!t) return;
        e.preventDefault();
        inp.value = t.textContent; b[inp.dataset.field] = inp.value; dirty = true; close();
        if (inp.dataset.suggest === 'series') fillFromSeries(inp.value);
      });
      field.appendChild(box);
    };
    inp.addEventListener('input', show);
    inp.addEventListener('focus', show);
    inp.addEventListener('blur', () => setTimeout(close, 150));
  });

  // Seri seçilince yazar/tür/sıra boşsa doldur.
  function fillFromSeries(name) {
    const sib = state.books.filter(x => x.series === name);
    if (!sib.length) return;
    if (!b.author) { b.author = sib[0].author; $('#f-author', form).value = b.author; }
    if (!b.genre) { b.genre = sib[0].genre; $('#f-genre', form).value = b.genre; }
    if (b.seriesOrder === null || b.seriesOrder === undefined) { b.seriesOrder = Math.max(0, ...sib.map(x => Number(x.seriesOrder) || 0)) + 1; $('#f-seriesOrder', form).value = b.seriesOrder; }
  }

  // Kapak ekleme menüsü
  const setCover = (which, c) => {
    if (covers[which].url?.startsWith('blob:')) URL.revokeObjectURL(covers[which].url);
    covers[which] = c;
    $(`[data-slot="${which}"] .cover-holder`, form).innerHTML = `<div class="cover"><img src="${esc(c.url)}" alt=""></div>`;
    dirty = true;
  };
  const useBlob = async (which, raw, crop = true) => {
    const cropped = crop ? await cropImage(raw) : raw;
    if (!cropped) return;
    const blob = crop ? cropped : await shrinkImage(cropped);
    setCover(which, { blob, url: URL.createObjectURL(blob) });
  };
  const currentBlob = async which => {
    const c = covers[which];
    if (c.blob) return c.blob;
    if (c.blob === null) return null;
    const key = which === 'tr' ? b.coverTr : b.coverOrig;
    return key && !isUrl(key) ? db.getCover(key) : null;
  };
  $$('[data-add]', form).forEach(btn => btn.addEventListener('click', () => openAddCover(btn.dataset.add)));

  function openAddCover(which) {
    const tr = which === 'tr';
    const name = tr ? (b.title || b.originalTitle) : (b.originalTitle || b.title);
    const q = encodeURIComponent(`${name} ${b.author || ''} ${tr ? 'kitap kapağı' : 'book cover'}`.trim());
    const shop = tr
      ? ['🛒 Kitapyurdu\'nda ara', `https://www.kitapyurdu.com/index.php?route=product/search&filter_name=${encodeURIComponent(name)}`]
      : ['📗 Goodreads\'te ara', `https://www.goodreads.com/search?q=${encodeURIComponent(`${name} ${b.author || ''}`.trim())}`];
    sheet({
      title: tr ? 'Türkçe kapak ekle' : 'Orijinal kapak ekle',
      body: `<div class="list">
          <button class="row" data-act="find" style="width:100%;border:0;background:none;text-align:left"><div class="body"><div class="t">🔍 Otomatik bul</div><div class="s">Google Books ve Open Library'de ara, seç</div></div><span class="chev"></span></button>
          <a class="row" href="https://www.google.com/search?tbm=isch&q=${q}" target="_blank" rel="noopener"><div class="body"><div class="t">🌐 Google Görseller'de ara</div><div class="s">Safari'de açılır</div></div><span class="chev"></span></a>
          <a class="row" href="${shop[1]}" target="_blank" rel="noopener"><div class="body"><div class="t">${shop[0]}</div><div class="s">Safari'de açılır</div></div><span class="chev"></span></a>
          <button class="row" data-act="paste" style="width:100%;border:0;background:none;text-align:left"><div class="body"><div class="t">📋 Kopyaladığım görseli yapıştır</div><div class="s">Kırparak eklenir</div></div><span class="chev"></span></button>
          <label class="row" style="position:relative"><div class="body"><div class="t">📷 Fotoğraflardan seç / çek</div><div class="s">Kırparak eklenir</div></div><span class="chev"></span><input type="file" accept="image/*" id="ac-file" style="position:absolute;inset:0;opacity:0"></label>
          <button class="row hidden" data-act="crop" style="width:100%;border:0;background:none;text-align:left"><div class="body"><div class="t">✂️ Mevcut kapağı kırp</div></div><span class="chev"></span></button>
        </div>
        <div class="paste-box" id="ac-pastebox" contenteditable="true" inputmode="none" aria-label="Görseli buraya yapıştır">Yapıştır çalışmazsa buraya uzun basıp <b>Yapıştır</b>'a dokun</div>
        <p class="muted small"><b>Google ya da Kitapyurdu'ndan eklemek için:</b> istediğin kapağı aç, görsele <b>uzun bas → Kopyala</b>. Sonra uygulamaya dönüp <b>📋 Kopyaladığım görseli yapıştır</b>'a dokun.</p>`,
      onMount: (el, close) => {
        currentBlob(which).then(bl => { if (bl) $('[data-act="crop"]', el).classList.remove('hidden'); });
        $('[data-act="find"]', el).addEventListener('click', () => {
          close();
          findCover(b, which, async url => {
            const blob = await fetchAsBlob(url);
            setCover(which, blob ? { blob, url: URL.createObjectURL(blob) } : { blob: null, remote: url, url });
          });
        });
        $('[data-act="crop"]', el).addEventListener('click', async () => {
          const bl = await currentBlob(which);
          close();
          if (bl) await useBlob(which, bl);
        });
        $('#ac-file', el).addEventListener('change', async e => {
          const f = e.target.files?.[0];
          if (!f) return;
          close();
          await useBlob(which, f);
        });
        const fromPaste = async img => { close(); await useBlob(which, img); };
        $('[data-act="paste"]', el).addEventListener('click', async () => {
          try {
            const img = await readClipboardImage();
            if (img) return fromPaste(img);
            toast('Panoda görsel yok. Önce görsele uzun basıp Kopyala de.');
          } catch {
            toast('Yapıştırma izni verilmedi. Aşağıdaki kutuya uzun basıp Yapıştır\'ı dene.');
            $('#ac-pastebox', el).focus();
          }
        });
        $('#ac-pastebox', el).addEventListener('paste', async e => {
          e.preventDefault();
          const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
          const file = item?.getAsFile();
          if (file) return fromPaste(file);
          toast('Panoda görsel yok. Önce görsele uzun basıp Kopyala de.');
        });
      },
    });
  }

  $$('[data-rmcover]', form).forEach(btn => btn.addEventListener('click', () => {
    const which = btn.dataset.rmcover;
    covers[which] = { blob: null, url: null };
    $(`[data-slot="${which}"] .cover-holder`, form).innerHTML = coverHTML({ ...b, coverTr: null, coverOrig: null }, { key: null, badge: false });
    dirty = true;
  }));

  // Var olan kapakları göster
  for (const [which, key] of [['tr', b.coverTr], ['orig', b.coverOrig]]) {
    if (!key) continue;
    if (isUrl(key)) { $(`[data-slot="${which}"] .cover-holder`, form).innerHTML = `<div class="cover"><img src="${esc(key)}" alt=""></div>`; continue; }
    db.getCover(key).then(blob => {
      if (!blob || covers[which].blob !== undefined) return;
      $(`[data-slot="${which}"] .cover-holder`, form).innerHTML = `<div class="cover"><img src="${URL.createObjectURL(blob)}" alt=""></div>`;
    });
  }

  const setSummary = text => { b.summary = text; $('#f-summary', form).value = text; dirty = true; };
  const pasteSummary = async () => {
    try {
      const t = (await navigator.clipboard.readText()).trim();
      if (!t) { toast('Panoda yazı yok. Önce tanıtım yazısını seçip Kopyala de.'); return; }
      if (b.summary && !(await confirmSheet('Özeti değiştir', 'Mevcut özet, kopyaladığın yazıyla değiştirilsin mi?', 'Değiştir', false))) return;
      setSummary(cleanBlurb(t)); toast('📋 Özet yapıştırıldı');
    } catch {
      toast('Yapıştırma izni verilmedi. Özet kutusuna uzun basıp Yapıştır de.');
      $('#f-summary', form).focus();
    }
  };
  $('#paste-summary', form).addEventListener('click', pasteSummary);
  $('#find-summary', form).addEventListener('click', () => openAddSummary());

  function openAddSummary() {
    const name = b.title || b.originalTitle;
    const q = encodeURIComponent(`${name} ${b.author || ''}`.trim());
    sheet({
      title: 'Özet / tanıtım yazısı ekle',
      body: `<div class="list">
          <button class="row" data-s="auto" style="width:100%;border:0;background:none;text-align:left"><div class="body"><div class="t">🔍 Otomatik bul</div><div class="s">Google Books'ta ara, seç</div></div><span class="chev"></span></button>
          <a class="row" href="https://www.kitapyurdu.com/index.php?route=product/search&filter_name=${encodeURIComponent(name)}" target="_blank" rel="noopener"><div class="body"><div class="t">🛒 Kitapyurdu'nda aç</div><div class="s">Safari'de açılır</div></div><span class="chev"></span></a>
          <a class="row" href="https://www.google.com/search?q=${q}%20konusu" target="_blank" rel="noopener"><div class="body"><div class="t">🌐 Google'da ara</div><div class="s">Safari'de açılır</div></div><span class="chev"></span></a>
          <button class="row" data-s="paste" style="width:100%;border:0;background:none;text-align:left"><div class="body"><div class="t">📋 Kopyaladığım yazıyı yapıştır</div><div class="s">Book Love veya herhangi bir uygulamadan</div></div><span class="chev"></span></button>
        </div>
        <p class="muted small"><b>Başka bir uygulamadan eklemek için:</b> tanıtım yazısının üstüne uzun bas, seçimi tüm yazıyı kapsayacak şekilde genişlet, <b>Kopyala</b> de. Sonra buraya dönüp <b>📋 Yapıştır</b>'a dokun.</p>`,
      onMount: (el, close) => {
        $('[data-s="auto"]', el).addEventListener('click', () => { close(); findSummary(b, setSummary); });
        $('[data-s="paste"]', el).addEventListener('click', () => { close(); pasteSummary(); });
      },
    });
  }

  async function save() {
    b.title = b.title.trim(); b.originalTitle = b.originalTitle.trim(); b.author = b.author.trim(); b.series = b.series.trim();
    if (!b.title && !b.originalTitle) { toast('Kitap adını yaz'); $('#f-title', form).focus(); return; }
    for (const which of ['tr', 'orig']) {
      const prop = which === 'tr' ? 'coverTr' : 'coverOrig';
      const c = covers[which];
      if (c.blob === undefined) continue;
      if (b[prop]) { await db.deleteCover(b[prop]); forgetCover(b[prop]); }
      if (c.remote) b[prop] = c.remote;
      else if (c.blob) { const key = `${b.id}-${which}-${Date.now().toString(36)}`; await db.putCover(key, c.blob); b[prop] = key; }
      else b[prop] = null;
    }
    await saveBook(b);
    dirty = false;
    toast(isNew ? 'Kitap eklendi' : 'Kaydedildi');
    if (isNew) location.replace(`#/book/${enc(b.id)}`); else history.back();
  }
  $('#save', view).addEventListener('click', save);
  $('#save2', view).addEventListener('click', save);
  $('#cancel', view).addEventListener('click', async () => {
    if (dirty && !(await confirmSheet('Değişiklikler kaydedilmedi', 'Çıkarsan yaptığın değişiklikler kaybolacak.', 'Çık'))) return;
    if ((window.__navCount || 0) > 1) history.back(); else location.hash = '#/';
  });
  $('#delete', view)?.addEventListener('click', async () => {
    if (!(await confirmSheet('Kitabı sil', `"${displayTitle(b)}" kalıcı olarak silinsin mi?`, 'Sil'))) return;
    await deleteBook(b.id);
    toast('Kitap silindi');
    location.replace('#/');
  });

  if (query.get('find')) setTimeout(() => openAddCover(query.get('find') === 'orig' ? 'orig' : 'tr'), 100);
  else if (query.get('summary')) setTimeout(() => { $('#f-summary', form).scrollIntoView({ block: 'center' }); openAddSummary(); }, 100);
  else if (query.get('focus') === 'notes') setTimeout(() => $('#f-notes', form).scrollIntoView({ block: 'center' }), 50);
  else if (isNew) setTimeout(() => $('#f-title', form).focus(), 50);
}

// Görseli indirip küçült (site izin vermezse null → adres olarak saklanır).
export async function fetchAsBlob(url) {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    const raw = await res.blob();
    if (!raw.type.startsWith('image/') || raw.size < 1500) return null;
    return await shrinkImage(raw);
  } catch { return null; }
}

const offlineMsg = '<div class="empty">İnternet bağlantısı gerekiyor.</div>';

function findCover(book, which, onPick) {
  const t0 = which === 'tr' ? book.title : (book.originalTitle || book.title);
  sheet({
    title: which === 'tr' ? 'Türkçe kapak bul' : 'Orijinal kapak bul',
    body: `<div class="form-group"><div class="field"><label>Kitap adı</label><input id="lk-t" value="${esc(t0)}"></div>
      <div class="field"><label>Yazar</label><input id="lk-a" value="${esc(book.author)}"></div></div>
      <button class="btn block" id="lk-go" style="margin-bottom:14px">🔍 Ara</button><div id="lk-res"></div>
      <p class="muted small">Kaynak: Google Books ve Open Library. Doğru kapağa dokun.</p>`,
    onMount: (el, close) => {
      const run = async () => {
        const box = $('#lk-res', el);
        if (!navigator.onLine) { box.innerHTML = offlineMsg; return; }
        box.innerHTML = '<div class="empty">Aranıyor…</div>';
        let list = [];
        try { list = (await candidates(book, which, { title: $('#lk-t', el).value.trim(), author: $('#lk-a', el).value.trim() })).filter(r => r.img).slice(0, 18); }
        catch { box.innerHTML = '<div class="empty">Arama yapılamadı.</div>'; return; }
        if (!list.length) { box.innerHTML = '<div class="empty">Kapak bulunamadı. Adı ya da yazarı değiştirip tekrar dene.</div>'; return; }
        box.innerHTML = `<div class="grid">${list.map((r, i) => `<button type="button" class="card" data-i="${i}" style="border:0;background:none;padding:0;text-align:left">
          <div class="cover"><img src="${esc(r.img)}" alt="" loading="lazy"></div>
          <div class="a">${esc([r.lang, r.year, r.publisher].filter(Boolean).join(' · '))}</div></button>`).join('')}</div>`;
        // Yüklenemeyen (kapaksız) sonuçları gizle
        list.forEach((r, i) => imageOk(r.img).then(ok => { const c = $(`[data-i="${i}"]`, box); if (!ok && c) c.style.display = 'none'; }));
        box.querySelectorAll('[data-i]').forEach(c => c.addEventListener('click', async () => {
          close(); toast('Kapak ekleniyor…');
          await onPick(list[Number(c.dataset.i)].img);
        }));
      };
      $('#lk-go', el).addEventListener('click', run);
      run();
    },
  });
}

function findSummary(book, onPick) {
  sheet({
    title: 'Özet bul',
    body: '<div id="sm-res"><div class="empty">Aranıyor…</div></div><p class="muted small">Kaynak: Google Books. Kullanmak istediğin özete dokun; sonra düzenleyebilirsin.</p>',
    onMount: async (el, close) => {
      const box = $('#sm-res', el);
      if (!navigator.onLine) { box.innerHTML = offlineMsg; return; }
      let list = [];
      try { list = await summaryCandidates(book); } catch { /* yok */ }
      if (!list.length) { box.innerHTML = '<div class="empty">Özet bulunamadı.</div>'; return; }
      box.innerHTML = list.slice(0, 8).map((r, i) => `<button type="button" class="section" data-i="${i}" style="display:block;width:100%;text-align:left;border:0">
        <div class="small muted" style="margin-bottom:4px">${esc([r.title, r.lang === 'tr' ? 'Türkçe' : r.lang, r.publisher].filter(Boolean).join(' · '))}</div>
        <div class="prose" style="font-size:14px;max-height:9em;overflow:hidden">${esc(r.description)}</div></button>`).join('');
      box.querySelectorAll('[data-i]').forEach(c => c.addEventListener('click', () => { onPick(list[Number(c.dataset.i)].description); close(); }));
    },
  });
}

// Panodaki görseli oku (iPhone'da "Yapıştır" onayı çıkar).
async function readClipboardImage() {
  if (!navigator.clipboard?.read) throw new Error('desteklenmiyor');
  const items = await navigator.clipboard.read();
  for (const it of items) {
    const type = it.types.find(t => t.startsWith('image/'));
    if (type) return it.getType(type);
  }
  return null;
}

function cleanBlurb(t) {
  return t.replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/(devamını oku|daha fazla göster|devamı|read more)\s*\.*\s*$/i, '')
    .trim();
}
