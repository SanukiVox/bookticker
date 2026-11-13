// "Asistana sor": kitaplık bilgisini hazır metin olarak Claude / ChatGPT / Gemini'ye taşır.
// Cevaptaki önerileri tekrar yapıştırınca listeye ekler.
import { state, CRITERIA, SPICY_LABELS, computeScore, displayTitle, norm, newBook, addBooks, saveOptions } from '../store.js';
import { esc, sheet, toast, $, $$ } from '../ui.js';

const APPS = [
  ['claude', 'Claude', 'https://claude.ai/new'],
  ['chatgpt', 'ChatGPT', 'https://chatgpt.com/'],
  ['gemini', 'Gemini', 'https://gemini.google.com/app'],
];

const QUICK = [
  'Okuduklarıma ve notlarıma göre zevkimi kısaca analiz et.',
  'Listemdeki okunacaklardan sıradaki 3 kitabımı öner, nedenini yaz.',
  'Zevkime göre listemde OLMAYAN 5 kitap öner. Türkçesi yayımlanmış olanları öne al.',
  'Listemde düşmandan âşığa temalı, Türkçesi olan, spicy 2 ve altı kitaplar hangileri?',
];

const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

function bookLine(b, withNotes) {
  const sc = computeScore(b);
  const parts = [
    displayTitle(b),
    b.originalTitle && b.originalTitle !== b.title ? b.originalTitle : '',
    b.author,
    b.series ? `${b.series}${b.seriesOrder ? ' #' + b.seriesOrder : ''}` : '',
    b.genre,
    b.status,
    b.translation ? `TR: ${b.translation}` : '',
    sc !== null ? `uyum ${sc.toFixed(1)}` : '',
    b.spicy != null ? `spicy ${b.spicy}` : '',
    b.goodreads ? `GR ${b.goodreads}` : '',
    b.myRating ? `puanım ${b.myRating}/5` : '',
    b.favorite ? 'favori' : '',
    (b.tags || []).length ? `etiket: ${b.tags.join(', ')}` : '',
  ];
  if (withNotes) {
    if (b.notes) parts.push(`notum: ${clip(b.notes, 220)}`);
    if (b.review) parts.push(`değerlendirme: ${clip(b.review, 160)}`);
  }
  return '- ' + parts.filter(Boolean).join(' | ');
}

// Sıra her zaman aynı olmalı: metin değişmezse Claude önbelleği tutar, sohbet ucuzlar.
const stableOrder = books => [...books].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

function pickBooks(scope) {
  if (scope === 'all') return stableOrder(state.books);
  // Kısa liste: okuduğum/okuduğum/beğendiğim + en uyumlu 60 okunacak
  const core = state.books.filter(b => b.status !== 'Okunacak' || b.favorite || b.myRating || b.notes);
  const rest = state.books.filter(b => !core.includes(b)).sort((a, b) => (computeScore(b) ?? 0) - (computeScore(a) ?? 0)).slice(0, 60);
  return stableOrder([...core, ...rest]);
}

// Kitaplığın sabit kısmı (sohbette önbelleğe alınır; her mesajda tekrar ücretlendirilmez).
export function libraryContext({ scope = 'all', withNotes = true } = {}) {
  const w = state.settings.weights;
  const books = pickBooks(scope);
  return [
    'Sen benim kişisel kitap asistanımsın. Aşağıda kişisel kitaplığımın listesi var. Türkçe ve samimi cevap ver; kısa ve öz yaz, gerekirse madde işaretleri kullan.',
    'Kitaplardan uzun bölümler ya da metinler aktarma; özetle, yorumla ve öner.',
    '',
    `Puanlama: ${CRITERIA.map(c => c.label).join(', ')} kriterleri 1–5 arası. "Uyum" bu kriterlerin ağırlıklı ortalaması (ağırlıklar: ${CRITERIA.map(c => `${c.label} ${w[c.key]}`).join(', ')}). Spicy 0–5 (${SPICY_LABELS[0].split(':')[0]} … ${SPICY_LABELS[5].split(':')[0]}). GR = Goodreads puanı. "Puanım" kitabı okuduktan sonra verdiğim puan.`,
    state.settings.rules?.length ? `Okuma kurallarım: ${state.settings.rules.map((r, i) => `${i + 1}) ${r}`).join(' ')}` : '',
    '',
    'Listemde OLMAYAN bir kitap önerirsen cevabının en sonuna, uygulamama aktarabilmem için şu biçimde bir blok ekle (her satıra bir kitap, bilmediğin alanı boş bırak):',
    'ÖNERİLER',
    '- Türkçe adı | Orijinal adı | Yazar | Tür',
    'Türkçe çevirisinin yayımlanıp yayımlanmadığından emin değilsen bunu açıkça söyle.',
    '',
    `Kitaplığım (${books.length} kitap${scope === 'all' ? '' : `, toplam ${state.books.length} kitaptan seçilmiş kısa liste`}):`,
    ...books.map(b => bookLine(b, withNotes)),
  ].join('\n');
}

export function bookContext(book, withNotes = true) {
  const lines = [`Şu an bu kitap hakkında konuşuyoruz: ${displayTitle(book)}${book.author ? ' — ' + book.author : ''}`];
  if (book.summary) lines.push(`Özeti: ${clip(book.summary, 1200)}`);
  if (book.notes && withNotes) lines.push(`Bu kitaptaki notlarım: ${clip(book.notes, 1200)}`);
  if (book.quotes && withNotes) lines.push(`Sevdiğim alıntılar: ${clip(book.quotes, 600)}`);
  return lines.join('\n');
}

export const quickQuestions = book => (book
  ? [`"${displayTitle(book)}" kitabına benzeyen kitaplar öner (listemdekiler ve listemde olmayanlar ayrı ayrı).`, `"${displayTitle(book)}" bana uygun mu? Notlarıma ve zevkime göre değerlendir.`, `"${displayTitle(book)}" hakkındaki notlarımı özetle, öne çıkan temaları söyle.`]
  : QUICK);

export function buildPrompt({ question, book, scope = 'all', withNotes = true }) {
  return [libraryContext({ scope, withNotes }), book ? '\n' + bookContext(book, withNotes) : '', '', `Sorum: ${question}`].join('\n');
}

export function openAsk({ book } = {}) {
  const quick = quickQuestions(book);
  sheet({
    title: book ? `Asistana sor · ${displayTitle(book)}` : 'Asistana sor',
    body: `
      <div class="chip-wrap" style="margin-bottom:10px">${quick.map((q, i) => `<button class="chip q-chip" data-q="${i}">${esc(q)}</button>`).join('')}</div>
      <div class="form-group"><div class="field"><label for="ask-q">Sorun</label><textarea id="ask-q" placeholder="Örn. ACOTAR'ı bitirdim, sıradaki ne olsun?"></textarea></div>
        <div class="set-row"><span>Notlarımı da ekle</span><span class="toggle"><input type="checkbox" id="ask-notes" checked><span></span></span></div>
        <div class="set-row"><span>Liste</span><select id="ask-scope"><option value="all">Bütün kitaplar</option><option value="short">Kısa liste</option></select></div></div>
      <p class="muted small" id="ask-size"></p>
      <h3 style="margin:6px 0 8px">Nereye soralım?</h3>
      <div class="btn-row" style="margin-bottom:10px">${APPS.map(([k, l, u]) => `<a class="btn" data-app="${k}" href="${u}" target="_blank" rel="noopener" style="flex:1">${l}</a>`).join('')}</div>
      ${navigator.share ? '<button class="btn block" id="ask-share">📤 Paylaş… (Claude/ChatGPT uygulamasına gönder)</button>' : ''}
      <p class="muted small" style="margin-top:12px">Soru ve kitaplığın kopyalanır, seçtiğin uygulama açılır: sohbete <b>uzun bas → Yapıştır → Gönder</b>. Asistan listende olmayan kitap önerirse cevabı kopyalayıp burada <b>Önerileri listeme ekle</b>'yi kullan.</p>
      <button class="btn block" id="ask-import" style="margin-top:6px">📥 Önerileri listeme ekle</button>
      <p class="muted small" style="margin-top:12px">💡 Sohbeti uygulamanın içinde yapmak için <a href="#/settings" style="color:var(--accent)">Ayarlar → Asistan</a> bölümüne Claude API anahtarını ekle.</p>`,
    onMount: (el, close) => {
      const q = $('#ask-q', el);
      const text = () => buildPrompt({ question: q.value.trim() || quick[0], book, scope: $('#ask-scope', el).value, withNotes: $('#ask-notes', el).checked });
      const size = () => {
        const n = text().length;
        $('#ask-size', el).textContent = `Gönderilecek metin: ~${Math.round(n / 1000)} bin karakter.${n > 30000 ? ' Ücretsiz planlarda uzun gelebilir; sorun olursa "Kısa liste"yi seç.' : ''}`;
      };
      $$('[data-q]', el).forEach(c => c.addEventListener('click', () => { q.value = quick[Number(c.dataset.q)]; size(); }));
      q.addEventListener('input', size);
      $('#ask-notes', el).addEventListener('change', size);
      $('#ask-scope', el).addEventListener('change', size);
      size();
      // Bağlantıya dokunulunca metni kopyala; sayfa yeni sekmede/uygulamada açılır.
      $$('[data-app]', el).forEach(a => a.addEventListener('click', () => {
        const t = text();
        navigator.clipboard?.writeText(t).then(() => toast('📋 Kopyalandı · sohbete yapıştır'), () => toast('Kopyalanamadı'));
      }));
      $('#ask-share', el)?.addEventListener('click', async () => {
        try { await navigator.share({ text: text() }); } catch { /* vazgeçildi */ }
      });
      $('#ask-import', el).addEventListener('click', () => { close(); openImportSuggestions(); });
    },
  });
}

// ---------- Cevaptaki önerileri listeye ekle ----------
export function parseSuggestions(text) {
  const lines = String(text || '').split(/\r?\n/);
  let start = lines.findIndex(l => /^\s*[#*\s]*ÖNERİLER\b/i.test(l) || /^\s*[#*\s]*ONERILER\b/i.test(l));
  const body = start >= 0 ? lines.slice(start + 1) : lines;
  const out = [];
  for (let l of body) {
    l = l.trim();
    if (!/^([-*•]|\d+[.)])\s+/.test(l)) { if (start >= 0 && out.length && l === '') break; continue; }
    l = l.replace(/^([-*•]|\d+[.)])\s+/, '').replace(/\*\*/g, '').trim();
    let title = '', orig = '', author = '', genre = '';
    if (l.includes('|')) [title, orig, author, genre] = l.split('|').map(s => s.trim());
    else {
      const m = l.match(/^(.+?)\s+[—–-]\s+(.+?)(?:\s*\((.+)\))?$/);
      if (!m) continue;
      title = m[1]; author = m[2];
    }
    title = title.replace(/^["“]|["”]$/g, '').trim();
    if (!title || /türkçe adı/i.test(title)) continue;
    out.push({ title, originalTitle: orig || '', author: author || '', genre: genre || '' });
  }
  return out;
}

export function openImportSuggestions() {
  sheet({
    title: 'Önerileri listeme ekle',
    body: `<p class="muted small">Asistanın cevabını (ya da sadece ÖNERİLER kısmını) kopyala, sonra yapıştır.</p>
      <button class="btn block" id="imp-paste" style="margin-bottom:10px">📋 Kopyaladığım cevabı yapıştır</button>
      <div class="form-group"><div class="field"><textarea id="imp-text" placeholder="…ya da buraya yapıştır" style="min-height:110px"></textarea></div></div>
      <div id="imp-list"></div>`,
    foot: '<button class="btn" data-close>Vazgeç</button><button class="btn primary" id="imp-add" disabled>Ekle</button>',
    onMount: (el, close) => {
      let found = [];
      const known = new Set(state.books.flatMap(b => [norm(b.title), norm(b.originalTitle)]).filter(Boolean));
      const render = () => {
        found = parseSuggestions($('#imp-text', el).value);
        const box = $('#imp-list', el);
        if (!found.length) { box.innerHTML = $('#imp-text', el).value.trim() ? '<div class="empty" style="padding:16px">Öneri bulunamadı. Cevapta "ÖNERİLER" bloğu ya da "- Kitap — Yazar" satırları olmalı.</div>' : ''; $('#imp-add', el).disabled = true; return; }
        box.innerHTML = `<div class="list">${found.map((f, i) => {
          const dup = known.has(norm(f.title)) || (f.originalTitle && known.has(norm(f.originalTitle)));
          return `<label class="row"><input type="checkbox" data-i="${i}" ${dup ? '' : 'checked'} style="width:20px;height:20px">
            <div class="body"><div class="t">${esc(f.title)}</div><div class="s">${esc([f.originalTitle, f.author, f.genre].filter(Boolean).join(' · '))}</div>${dup ? '<div class="s" style="color:var(--danger)">Zaten listende olabilir</div>' : ''}</div></label>`;
        }).join('')}</div>`;
        $('#imp-add', el).disabled = false;
      };
      $('#imp-text', el).addEventListener('input', render);
      $('#imp-paste', el).addEventListener('click', async () => {
        try { $('#imp-text', el).value = await navigator.clipboard.readText(); render(); }
        catch { toast('Yapıştırma izni verilmedi; kutuya uzun basıp Yapıştır de'); $('#imp-text', el).focus(); }
      });
      $('#imp-add', el).addEventListener('click', async () => {
        const picked = $$('[data-i]', el).filter(c => c.checked).map(c => found[Number(c.dataset.i)]);
        if (!picked.length) { toast('Eklenecek kitap seçmedin'); return; }
        const tag = 'asistan önerisi';
        if (!state.options.tags.some(t => t.name === tag)) { state.options.tags.push({ name: tag }); await saveOptions(); }
        const books = picked.map((p, i) => newBook({ ...p, status: 'Okunacak', tags: [tag], createdAt: Date.now() + i }));
        await addBooks(books);
        close();
        toast(`${books.length} kitap listene eklendi`);
        location.hash = '#/search?tags=' + encodeURIComponent(tag);
      });
    },
  });
}
