// Sesli kitap ekranları: tam ekran oynatıcı (#/listen/:id), kitap sayfasındaki 🎧 bölümü ve alttaki küçük oynatıcı.
import { getBook, displayTitle } from '../store.js';
import { esc, enc, toast, sheet, confirmSheet, coverHTML, hydrateCovers, $, $$ } from '../ui.js';
import { formatSize, formatDuration } from '../files.js';
import * as A from '../audio.js';
import { openTts, ttsStatusHTML, wireTtsStatus } from './ttsview.js';
import { db } from '../db.js';
import { backButton, wireBack } from './detail.js';

const SLEEPS = [[0, 'Kapalı'], [15, '15 dk'], [30, '30 dk'], [45, '45 dk'], [60, '1 saat'], ['end', 'Bölüm sonunda']];
const rateLabel = r => `${String(r).replace('.', ',')}×`;

// ---------- Tam ekran oynatıcı ----------
let unsub = null;
export async function renderListen(view, [id]) {
  unsub?.(); unsub = null;
  const b = getBook(id);
  if (!b) { view.innerHTML = '<div class="empty">Kitap bulunamadı</div>'; return; }
  if (!A.hasAudio(b)) { location.replace(`#/book/${enc(id)}`); return; }
  const hasBook = !!(b.file || b.file2);
  view.innerHTML = `
    <div class="topbar">${backButton(`#/book/${enc(id)}`)}<div class="title">🎧 Sesli kitap</div>
      ${hasBook ? `<a class="icon-btn" href="#/read/${enc(id)}" aria-label="Kitabı aç">📖 Kitap</a>` : ''}</div>
    <div class="ls-wrap">
      <div class="ls-cover">${coverHTML(b, { badge: false })}</div>
      <div class="ls-title"><h2>${esc(displayTitle(b))}</h2>${b.author ? `<div class="muted">${esc(b.author)}</div>` : ''}<div class="small muted" id="ls-track"></div></div>
      <div class="ls-seek"><input type="range" id="ls-range" min="0" max="1000" value="0" aria-label="Konum"><div class="ls-times"><span id="ls-cur">0:00</span><span id="ls-left">0:00</span></div></div>
      <div class="ls-ctrl">
        <button class="ls-b" id="ls-prev" aria-label="Önceki bölüm">⏮</button>
        <button class="ls-b" id="ls-back" aria-label="15 saniye geri"><span>↺</span><small>15</small></button>
        <button class="ls-play" id="ls-play" aria-label="Çal">▶</button>
        <button class="ls-b" id="ls-fwd" aria-label="30 saniye ileri"><span>↻</span><small>30</small></button>
        <button class="ls-b" id="ls-next" aria-label="Sonraki bölüm">⏭</button>
      </div>
      <div class="ls-opts"><button class="chip" id="ls-rate">⚡ 1×</button><button class="chip" id="ls-sleep">🌙 Uyku</button></div>
      <div class="warn" id="ls-err" style="display:none"></div>
      <div class="small muted" id="ls-total" style="text-align:center"></div>
      <details class="ls-diag"><summary class="small muted">🔧 Sorun giderme</summary><pre id="ls-diag"></pre>
        <button class="mini-btn" id="ls-diag-copy">📋 Kopyala</button></details>
    </div>
    <div class="section"><div style="display:flex;align-items:center;gap:8px"><h3 style="flex:1;margin:0">Bölümler</h3>
      <button class="mini-btn" id="ls-edit">✏️ Düzenle</button></div><div id="ls-list" class="ls-list"></div></div>`;
  wireBack(view);
  hydrateCovers(view);
  const range = $('#ls-range', view);
  let dragging = false;

  const drawList = () => {
    const cur = A.player.book?.id === b.id ? A.player.idx : b.audioPos?.t ?? -1;
    $('#ls-list', view).innerHTML = b.audio.tracks.map((t, i) => `<button class="ls-row ${i === cur ? 'on' : ''}" data-i="${i}">
      <span class="ls-n">${i === cur && A.player.playing && A.player.book?.id === b.id ? '🔊' : i + 1}</span><span class="ls-name">${esc(t.name.replace(/\.[a-z0-9]+$/i, ''))}</span>
      <span class="small muted">${t.dur ? A.fmtTime(t.dur) : ''}</span></button>`).join('');
    $$('.ls-row', view).forEach(r => r.addEventListener('click', async () => {
      A.unlock();
      try { await A.open(b, Number(r.dataset.i), 0, true); } catch (e) { toast(e.message); }
    }));
  };
  let lastIdx = -1, lastPlaying = null;
  const update = () => {
    if (!view.isConnected) { unsub?.(); unsub = null; return; }
    const mine = A.player.book?.id === b.id;
    const pos = b.audioPos || {};
    const idx = mine ? A.player.idx : pos.t || 0;
    const t = b.audio.tracks[idx] || {};
    const time = mine ? A.player.time : pos.s || 0;
    const dur = mine ? A.player.duration : t.dur || 0;
    $('#ls-track', view).textContent = b.audio.tracks.length > 1 ? `Bölüm ${idx + 1} / ${b.audio.tracks.length} · ${t.name?.replace(/\.[a-z0-9]+$/i, '') || ''}` : '';
    if (!dragging) range.value = dur ? Math.round((time / dur) * 1000) : 0;
    $('#ls-cur', view).textContent = A.fmtTime(time);
    $('#ls-left', view).textContent = dur ? `-${A.fmtTime(dur - time)}` : '';
    $('#ls-play', view).textContent = mine && A.player.playing ? '⏸' : '▶';
    $('#ls-rate', view).textContent = `⚡ ${rateLabel(mine ? A.player.rate : b.audioPos?.rate || 1)}`;
    const sl = mine ? A.player.sleep : 0;
    $('#ls-sleep', view).textContent = sl === 'end' ? '🌙 Bölüm sonunda' : sl ? `🌙 ${Math.ceil(sl / 60000)} dk` : '🌙 Uyku';
    $('#ls-sleep', view).classList.toggle('on', !!sl);
    const err = mine ? A.player.error : '';
    $('#ls-err', view).style.display = err ? '' : 'none'; $('#ls-err', view).textContent = err;
    const total = A.audioTotal(b), pct = mine ? A.percentAt(b, idx, time) : A.audioPercent(b) || 0;
    $('#ls-total', view).textContent = `${total ? `Toplam ${formatDuration(total)} · ` : ''}%${Math.floor(pct)} dinlendi${b.listenSeconds ? ` · ${formatDuration(b.listenSeconds)} dinleme` : ''}`;
    const dg = $('#ls-diag', view);
    if (dg && dg.closest('details').open) dg.textContent = `${A.diagInfo()}\n\n${A.diagLog.join('\n')}`;
    if (idx !== lastIdx || (mine && A.player.playing) !== lastPlaying) { lastIdx = idx; lastPlaying = mine && A.player.playing; drawList(); }
  };
  unsub = A.onPlayer(update);
  update();
  $('.ls-diag', view).addEventListener('toggle', update);
  $('#ls-diag-copy', view).addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#ls-diag', view).textContent); toast('📋 Kopyalandı'); } catch { toast('Kopyalanamadı; ekran görüntüsü alabilirsin'); }
  });
  A.prepare(b).then(update);

  const ensure = async (autoplay = false) => {
    if (A.player.book?.id === b.id) return true;
    try { await A.resume(b, autoplay); return true; } catch (e) { toast(e.message); return false; }
  };
  $('#ls-play', view).addEventListener('click', async () => {
    // Dosya hazırsa çalma dokunuşun içinde, beklemeden başlar (iPhone bunu şart koşuyor)
    if (A.player.book?.id === b.id && !A.isPreparing()) { A.toggle(); return; }
    A.unlock();
    if (A.isPreparing()) { await A.whenPrepared(); if (A.player.book?.id === b.id) { A.play(); return; } }
    if (A.player.book?.id !== b.id) { await ensure(true); return; }
    A.toggle();
  });
  $('#ls-back', view).addEventListener('click', async () => { A.unlock(); if (await ensure()) A.seek(-15); });
  $('#ls-fwd', view).addEventListener('click', async () => { A.unlock(); if (await ensure()) A.seek(30); });
  $('#ls-prev', view).addEventListener('click', async () => { A.unlock(); if (await ensure()) A.prev(); });
  $('#ls-next', view).addEventListener('click', async () => { A.unlock(); if (await ensure()) A.next(); });
  range.addEventListener('input', () => {
    dragging = true;
    const dur = A.player.book?.id === b.id ? A.player.duration : b.audio.tracks[b.audioPos?.t || 0]?.dur || 0;
    $('#ls-cur', view).textContent = A.fmtTime((range.value / 1000) * dur);
  });
  range.addEventListener('change', async () => {
    dragging = false;
    A.unlock();
    if (!(await ensure())) return;
    A.seekTo((range.value / 1000) * A.player.duration);
  });
  $('#ls-rate', view).addEventListener('click', () => sheet({
    title: 'Okuma hızı',
    body: `<div class="chips">${A.RATES.map(r => `<button class="chip ${Math.abs(A.player.rate - r) < 0.01 ? 'on' : ''}" data-r="${r}">${rateLabel(r)}</button>`).join('')}</div>`,
    onMount: (el, close) => $$('[data-r]', el).forEach(c => c.addEventListener('click', async () => { await ensure(); A.setRate(Number(c.dataset.r)); close(); })),
  }));
  $('#ls-sleep', view).addEventListener('click', () => sheet({
    title: '🌙 Uyku zamanlayıcısı',
    body: `<div class="muted small" style="margin-bottom:10px">Seçtiğin süre dolunca ses kendiliğinden durur; kaldığın yer kaydedilir.</div>
      <div class="chips">${SLEEPS.map(([v, l]) => `<button class="chip" data-s="${v}">${l}</button>`).join('')}</div>`,
    onMount: (el, close) => $$('[data-s]', el).forEach(c => c.addEventListener('click', async () => {
      const v = c.dataset.s === 'end' ? 'end' : Number(c.dataset.s);
      if (v && !(await ensure())) return;
      A.setSleep(v); close();
      toast(v ? '🌙 Uyku zamanlayıcısı kuruldu' : 'Uyku zamanlayıcısı kapatıldı');
    })),
  }));
  $('#ls-edit', view).addEventListener('click', () => openTrackEditor(b, view));
}

function openTrackEditor(b, view) {
  const body = () => `<div class="muted small" style="margin-bottom:8px">Bölümlerin sırasını değiştirebilir, yanlış eklenen dosyayı çıkarabilirsin.</div>
    ${b.audio.tracks.map((t, i) => `<div class="ls-erow"><span class="ls-name">${i + 1}. ${esc(t.name)}</span>
      <button class="mini-btn" data-up="${i}" ${i ? '' : 'disabled'}>▲</button><button class="mini-btn" data-dn="${i}" ${i < b.audio.tracks.length - 1 ? '' : 'disabled'}>▼</button>
      <button class="mini-btn" data-del="${i}" style="color:var(--danger)">✕</button></div>`).join('')}`;
  sheet({
    title: '✏️ Bölümler',
    body: `<div id="te-body">${body()}</div>`,
    foot: '<button class="btn primary" data-close>Tamam</button>',
    onMount: el => {
      const wire = () => {
        $$('[data-up]', el).forEach(x => x.addEventListener('click', async () => { await A.moveTrack(b, Number(x.dataset.up), -1); redraw(); }));
        $$('[data-dn]', el).forEach(x => x.addEventListener('click', async () => { await A.moveTrack(b, Number(x.dataset.dn), 1); redraw(); }));
        $$('[data-del]', el).forEach(x => x.addEventListener('click', async () => { await A.removeTrack(b, Number(x.dataset.del)); if (!A.hasAudio(b)) location.hash = `#/book/${enc(b.id)}`; else redraw(); }));
      };
      const redraw = () => { $('#te-body', el).innerHTML = body(); wire(); };
      wire();
    },
    onClose: () => { if (view.isConnected && A.hasAudio(b)) renderListen(view, [b.id]); },
  });
}

// ---------- Kitap sayfasındaki 🎧 bölümü ----------
const picker = (label, cls, mode) => `<label class="${cls}" style="position:relative;overflow:hidden">${label}<input type="file" accept="${A.AUDIO_ACCEPT}" multiple data-mode="${mode}" style="position:absolute;inset:0;opacity:0"></label>`;

const hasEpub = b => b.file?.type === 'epub' || b.file2?.type === 'epub';
export function audioSectionHTML(b) {
  if (!A.hasAudio(b)) {
    return `<div class="section" id="audio-sec"><h3>🎧 Sesli kitap</h3>
      <div class="muted small" style="margin-bottom:8px">MP3, M4A/M4B gibi ses dosyalarını ekle; bölüm bölüm dosyalar varsa hepsini birlikte seç. Kaldığın yer kaydedilir, kitap dosyasıyla birlikte kullanabilirsin.</div>
      <div class="btn-row">${picker('🎧 Sesli kitap ekle', 'btn', 'replace')}${hasEpub(b) ? '<button class="btn" id="tts-open">🗣️ EPUB\'dan sesli kitap oluştur</button>' : ''}</div>
      ${ttsStatusHTML(b)}</div>`;
  }
  const where = A.audioWhere(b);
  const n = b.audio.tracks.length, total = A.audioTotal(b), size = b.audio.tracks.reduce((t, x) => t + (x.size || 0), 0);
  const pct = A.audioPercent(b);
  const mine = A.player.book?.id === b.id;
  const pos = b.audioPos;
  const info = `<div class="file-chip">🎧 <b>${n > 1 ? `${n} bölüm` : esc(b.audio.tracks[0].name)}</b><span>${total ? `${formatDuration(total)} · ` : ''}${formatSize(size)}${b.listenSeconds ? ` · ${formatDuration(b.listenSeconds)} dinlendi` : ''}${b.audio.tracks.every(x => x.driveId) ? ' · ☁️' : ''}</span></div>`;
  const prog = pct != null ? `<div><div style="display:flex;justify-content:space-between;font-size:14px"><span>${n > 1 && pos ? `Bölüm ${(pos.t || 0) + 1} / ${n} · ${A.fmtTime(pos.s)}` : pos ? A.fmtTime(pos.s) : ''}</span><b>%${Math.floor(pct)}</b></div><div class="progress" style="height:8px"><span style="width:${pct}%"></span></div></div>` : '';
  if (where === 'drive') {
    const miss = b.audio.tracks.filter(x => x.driveId && !(db.fileKeysSync()?.has(x.key)));
    const mb = miss.reduce((t, x) => t + (x.size || 0), 0);
    return `<div class="section" id="audio-sec"><h3>🎧 Sesli kitap</h3>
      <div class="muted small" style="margin-bottom:8px">☁️ ${miss.length === b.audio.tracks.length ? 'Ses dosyaları' : `${miss.length} bölüm`} Google Drive'da (${formatSize(mb)}). Hepsini indirebilir ya da hemen dinlemeye başlayabilirsin; çalınan bölüm o an indirilir.</div>
      <div class="read-cta"><a class="btn primary" href="#/listen/${enc(b.id)}" id="au-go">🎧 ${pct ? `Dinlemeye devam et · %${Math.floor(pct)}` : 'Dinlemeye başla'}</a></div>
      ${prog}${info}<div class="btn-row"><button class="btn" id="au-dl">☁️ Tümünü Drive'dan indir</button><button class="mini-btn" id="au-rm" style="color:var(--danger);background:transparent">Kaldır</button></div></div>`;
  }
  if (where !== 'local') {
    return `<div class="section" id="audio-sec"><h3>🎧 Sesli kitap</h3>
      <div class="warn">🎧 <span>${where === 'partial' ? 'Bazı bölümler' : 'Ses dosyaları'} başka bir cihazda eklenmiş ve henüz Drive'a yüklenmemiş. O cihazda Google Drive bağlıysa kendiliğinden yüklenir; ya da aynı dosyaları burada seç. Kaldığın yer korunur.</span></div>
      ${prog}${info}<div class="btn-row">${picker('📎 Dosyaları ekle', 'btn primary', 'replace')}<button class="mini-btn" id="au-rm" style="color:var(--danger);background:transparent">Kaldır</button></div></div>`;
  }
  return `<div class="section" id="audio-sec"><h3>🎧 Sesli kitap</h3>
    <div class="read-cta"><a class="btn primary" href="#/listen/${enc(b.id)}" id="au-go">🎧 ${mine && A.player.playing ? 'Çalıyor · oynatıcıyı aç' : pct ? `Dinlemeye devam et · %${Math.floor(pct)}` : 'Dinlemeye başla'}</a></div>
    ${prog}${info}
    ${ttsStatusHTML(b)}
    <div class="btn-row">${picker('＋ Bölüm ekle', 'mini-btn', 'append')}${picker('Değiştir', 'mini-btn', 'replace')}<button class="mini-btn" id="au-rm" style="color:var(--danger);background:transparent">Kaldır</button></div></div>`;
}

export function wireAudioSection(view, b) {
  const sec = $('#audio-sec', view);
  if (!sec) return;
  $('#tts-open', sec)?.addEventListener('click', () => openTts(b));
  wireTtsStatus(sec, b);
  $$('input[type=file]', sec).forEach(inp => inp.addEventListener('change', async e => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;
    const replace = inp.dataset.mode !== 'append';
    try {
      const n = await A.attachAudio(b, files, { replace, onProgress: (i, tot) => toast(tot > 1 ? `🎧 Ekleniyor… ${i + 1} / ${tot}` : '🎧 Ekleniyor…') });
      toast(`🎧 Sesli kitap eklendi · ${n} bölüm`);
    } catch (err) { toast(err.message || 'Eklenemedi'); }
  }));
  $('#au-go', sec)?.addEventListener('click', () => A.unlock());
  $('#au-dl', sec)?.addEventListener('click', async e => {
    const btn = e.currentTarget;
    const gd = await import('../gdrive.js');
    const c = await gd.driveConf();
    if (!c.clientId || !c.connected) { toast('Önce Ayarlar → Google Drive bölümünden bağlan'); return; }
    if (!gd.tokenValid(c)) { gd.rememberDownload(b.id, 'audio'); gd.connect({ silent: !!c.email, returnTo: location.hash }); return; }
    btn.disabled = true;
    try {
      await gd.downloadAudio(b, { onProgress: f => { btn.textContent = `☁️ İndiriliyor… %${Math.round(f * 100)}`; } });
      toast('☁️ Sesli kitap indirildi');
    } catch (err) {
      btn.disabled = false; btn.textContent = '☁️ Tümünü Drive\'dan indir';
      if (/yenilenmeli/.test(err.message)) { gd.rememberDownload(b.id, 'audio'); gd.connect({ silent: !!c.email, returnTo: location.hash }); }
      else toast(err.name === 'QuotaExceededError' ? 'Cihazda yer yok' : err.message || 'İndirilemedi');
    }
  });
  $('#au-rm', sec)?.addEventListener('click', async () => {
    if (!(await confirmSheet('Sesli kitabı kaldır', 'Ses dosyaları bu cihazdan silinecek. Kaldığın yer ve dinleme süren kalır.', 'Kaldır'))) return;
    await A.removeAudio(b); toast('Sesli kitap kaldırıldı');
  });
}

// ---------- Alttaki küçük oynatıcı ----------
export function initMiniPlayer() {
  const bar = document.createElement('div');
  bar.id = 'mini-player';
  bar.hidden = true;
  bar.innerHTML = `<a id="mp-open" class="mp-info"><span class="mp-t"></span><span class="mp-s"></span><span class="mp-bar"><span></span></span></a>
    <button id="mp-back" class="mp-btn" aria-label="15 saniye geri">↺</button><button id="mp-play" class="mp-btn mp-main" aria-label="Çal">▶</button><button id="mp-x" class="mp-btn" aria-label="Kapat">✕</button>`;
  document.getElementById('app').appendChild(bar);
  const hiddenRoute = () => /^#\/(listen|read|edit|chat)\b/.test(location.hash);
  const draw = () => {
    const b = A.player.book;
    const show = !!b && A.player.started && !hiddenRoute();
    bar.hidden = !show;
    document.body.classList.toggle('has-mini', show);
    if (!b) return;
    $('#mp-open', bar).href = `#/listen/${enc(b.id)}`;
    $('.mp-t', bar).textContent = displayTitle(b);
    const n = b.audio?.tracks?.length || 0;
    $('.mp-s', bar).textContent = `${n > 1 ? `Bölüm ${A.player.idx + 1}/${n} · ` : ''}${A.fmtTime(A.player.time)}${A.player.sleep ? ' · 🌙' : ''}`;
    $('.mp-bar span', bar).style.width = `${A.percentAt(b, A.player.idx, A.player.time)}%`;
    $('#mp-play', bar).textContent = A.player.playing ? '⏸' : '▶';
  };
  A.onPlayer(draw);
  window.addEventListener('hashchange', draw);
  $('#mp-play', bar).addEventListener('click', () => A.toggle());
  $('#mp-back', bar).addEventListener('click', () => A.seek(-15));
  $('#mp-x', bar).addEventListener('click', () => A.stop());
}
