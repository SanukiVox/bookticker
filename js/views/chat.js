// Uygulama içi Claude sohbeti.
import { state, getBook, displayTitle, norm, newBook, addBooks, saveOptions } from '../store.js';
import { db } from '../db.js';
import { esc, ICON, toast, confirmSheet, $, $$ } from '../ui.js';
import { chat, hasKey, aiConfig, MODELS } from '../ai.js';
import { libraryContext, bookContext, quickQuestions, parseSuggestions } from './ask.js';

const TAG = 'asistan önerisi';

// Basit ve güvenli markdown: önce kaçış, sonra kalın/italik/başlık/liste.
function md(text) {
  const lines = esc(text).split('\n');
  let html = '', inList = false;
  for (const raw of lines) {
    let l = raw.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, '$1<i>$2</i>');
    const li = l.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (li) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${li[1]}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    const h = l.match(/^#{1,4}\s+(.*)$/);
    if (h) html += `<p><b>${h[1]}</b></p>`;
    else if (l.trim()) html += `<p>${l}</p>`;
  }
  if (inList) html += '</ul>';
  return html;
}

// ÖNERİLER bloğunu metinden ayır
function splitSuggestions(text) {
  const i = text.search(/^\s*[#*\s]*(ÖNERİLER|ONERILER)\b/mi);
  if (i < 0) return { body: text, sugg: [] };
  return { body: text.slice(0, i).trim(), sugg: parseSuggestions(text.slice(i)) };
}

const fmt$ = v => (v < 0.01 ? '<$0,01' : `$${v.toFixed(2).replace('.', ',')}`);

export async function renderChat(view, _p, query) {
  if (!(await hasKey())) { location.replace('#/settings'); toast('Önce Claude API anahtarını ekle'); return; }
  const saved = (await db.getMeta('chat')) || { bookId: null, messages: [] };
  const wantBook = query.get('book');
  let conv = saved;
  if (wantBook && wantBook !== saved.bookId) conv = { bookId: wantBook, messages: [] };
  if (!wantBook && query.get('new')) conv = { bookId: null, messages: [] };
  const book = conv.bookId ? getBook(conv.bookId) : null;
  const conf = await aiConfig();
  let controller = null;

  view.innerHTML = `
    <div class="chat">
      <div class="topbar"><button class="icon-btn" id="c-back" aria-label="Geri">${ICON.back}</button>
        <div class="title">🤖 ${book ? esc(displayTitle(book)) : 'Kitap asistanı'}</div>
        <button class="icon-btn" id="c-new">Yeni</button></div>
      <div class="chat-msgs" id="msgs"></div>
      <form class="chat-bar" id="bar" onsubmit="return false">
        <textarea id="c-in" rows="1" placeholder="Bir şey sor…" enterkeyhint="send"></textarea>
        <button class="chat-send" id="c-send" aria-label="Gönder"><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>
      </form>
    </div>`;
  const msgs = $('#msgs', view), input = $('#c-in', view), send = $('#c-send', view);

  const save = () => db.putMeta('chat', conv);
  const known = () => new Set(state.books.flatMap(b => [norm(b.title), norm(b.originalTitle)]).filter(Boolean));

  function suggCards(sugg) {
    if (!sugg.length) return '';
    const k = known();
    return `<div class="sugg">${sugg.map((s, i) => {
      const dup = k.has(norm(s.title)) || (s.originalTitle && k.has(norm(s.originalTitle)));
      return `<div class="sugg-row"><div class="body"><div class="t">${esc(s.title)}</div><div class="s">${esc([s.originalTitle, s.author, s.genre].filter(Boolean).join(' · '))}</div></div>
        ${dup ? '<span class="muted small">Listende</span>' : `<button class="mini-btn" data-add="${i}">＋ Ekle</button>`}</div>`;
    }).join('')}</div>`;
  }

  function render() {
    if (!conv.messages.length) {
      msgs.innerHTML = `<div class="chat-empty"><div style="font-size:40px">🤖</div>
        <p>Kitaplığını, notlarını ve beğenilerini biliyorum. ${book ? `<b>${esc(displayTitle(book))}</b> hakkında` : 'Kitaplarınla ilgili'} ne istersen sor.</p>
        <div class="chip-wrap">${quickQuestions(book).map((q, i) => `<button class="chip q-chip" data-q="${i}">${esc(q)}</button>`).join('')}</div>
        <p class="muted small">${esc(MODELS[conf.model]?.label || conf.model)} · Harcanan (tahmini): ${fmt$(conf.spent || 0)}</p></div>`;
      $$('[data-q]', msgs).forEach(c => c.addEventListener('click', () => ask(quickQuestions(book)[Number(c.dataset.q)])));
      return;
    }
    msgs.innerHTML = conv.messages.map((m, mi) => {
      if (m.role === 'user') return `<div class="msg me">${esc(m.shown ?? m.content).replace(/\n/g, '<br>')}</div>`;
      const { body, sugg } = splitSuggestions(m.content);
      return `<div class="msg ai${m.error ? ' err' : ''}" data-mi="${mi}">${md(body)}${suggCards(sugg)}${m.cost ? `<div class="cost">${fmt$(m.cost)}</div>` : ''}</div>`;
    }).join('');
    $$('[data-add]', msgs).forEach(b => b.addEventListener('click', async () => {
      const mi = Number(b.closest('[data-mi]').dataset.mi);
      const s = splitSuggestions(conv.messages[mi].content).sugg[Number(b.dataset.add)];
      if (!state.options.tags.some(t => t.name === TAG)) { state.options.tags.push({ name: TAG }); await saveOptions(); }
      await addBooks([newBook({ title: s.title, originalTitle: s.originalTitle, author: s.author, genre: s.genre, status: 'Okunacak', tags: [TAG] })]);
      b.replaceWith(Object.assign(document.createElement('span'), { className: 'muted small', textContent: '✓ Eklendi' }));
      toast(`📚 "${s.title}" listene eklendi`);
    }));
    msgs.scrollTop = msgs.scrollHeight;
    window.scrollTo(0, document.body.scrollHeight);
  }

  async function ask(text) {
    text = text.trim();
    if (!text || controller) return;
    if (!navigator.onLine) { toast('İnternet bağlantısı yok'); return; }
    // İlk mesaja kitap bilgisi eklenir (sistem kısmı tüm sohbetlerde aynı kalsın, önbellek bozulmasın).
    const content = !conv.messages.length && book ? `${bookContext(book)}\n\n${text}` : text;
    conv.messages.push({ role: 'user', content, shown: text });
    const pending = { role: 'assistant', content: '' };
    conv.messages.push(pending);
    render();
    const bubble = msgs.lastElementChild;
    bubble.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    input.value = ''; autosize();
    controller = new AbortController();
    send.classList.add('stop'); send.setAttribute('aria-label', 'Durdur');
    let acc = '', raf = 0;
    try {
      const history = conv.messages.slice(0, -1).filter(m => !m.error && m.content).map(m => ({ role: m.role, content: m.content }));
      const res = await chat({
        system: [{ type: 'text', text: libraryContext(), cache_control: { type: 'ephemeral' } }],
        messages: history,
        signal: controller.signal,
        onText: t => {
          acc += t;
          if (!raf) raf = requestAnimationFrame(() => { raf = 0; bubble.innerHTML = md(splitSuggestions(acc).body); msgs.scrollTop = msgs.scrollHeight; window.scrollTo(0, document.body.scrollHeight); });
        },
      });
      if (res.stop === 'aborted') { pending.content = acc || '(durduruldu)'; }
      else { pending.content = res.text; pending.cost = res.cost; conf.spent = (await aiConfig()).spent; }
    } catch (e) {
      pending.content = `⚠️ ${e.message}`; pending.error = true;
    } finally {
      controller = null;
      send.classList.remove('stop'); send.setAttribute('aria-label', 'Gönder');
      await save();
      render();
    }
  }

  function autosize() { input.style.height = 'auto'; input.style.height = `${Math.min(140, input.scrollHeight)}px`; }
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(pointer: fine)').matches) { e.preventDefault(); ask(input.value); } });
  send.addEventListener('click', () => { if (controller) controller.abort(); else ask(input.value); });
  $('#c-new', view).addEventListener('click', async () => {
    if (conv.messages.length && !(await confirmSheet('Yeni sohbet', 'Bu sohbet silinecek.', 'Yeni sohbet', false))) return;
    conv = { bookId: null, messages: [] }; await save();
    if (location.hash !== '#/chat') location.hash = '#/chat'; else render();
  });
  $('#c-back', view).addEventListener('click', () => { if ((window.__navCount || 0) > 1) history.back(); else location.hash = '#/reading'; });

  if (conv !== saved) await save();
  render();
  return () => { controller?.abort(); };
}
