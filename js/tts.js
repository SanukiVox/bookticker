// EPUB → sesli kitap: metni bölüm bölüm yapay zekâ ses servisine (Azure / OpenAI) gönderip MP3 bölümleri üretir.
// Anahtarlar yalnızca bu cihazda (IndexedDB 'meta' → 'tts') saklanır; GitHub'a eşitlenmez.
// Üretilen bölümler kitaba sesli kitap olarak eklenir (audio.js); oynatıcı, kaldığın yer ve Drive yedeği aynen çalışır.
import { db } from './db.js';
import { getBook } from './store.js';

export const PROVIDERS = {
  azure: {
    label: 'Microsoft Azure',
    note: 'Ayda 500 bin karakter ücretsiz, sonrası 1 milyon karakter yaklaşık 16 $',
    perM: 16, free: 500000,
    voices: [
      ['tr-TR-EmelNeural', 'Emel (kadın, Türkçe)'],
      ['tr-TR-AhmetNeural', 'Ahmet (erkek, Türkçe)'],
      ['en-US-AvaMultilingualNeural', 'Ava (kadın, çok dilli · daha duygulu)'],
      ['en-US-AndrewMultilingualNeural', 'Andrew (erkek, çok dilli · daha duygulu)'],
      ['en-US-EmmaMultilingualNeural', 'Emma (kadın, çok dilli)'],
      ['en-US-BrianMultilingualNeural', 'Brian (erkek, çok dilli)'],
    ],
    chunk: 2800,
  },
  openai: {
    label: 'OpenAI',
    note: 'Ücretsiz kota yok; bu modelde yaklaşık dakikası 0,015 $',
    perMin: 0.015,
    voices: [['coral', 'Coral (kadın, sıcak)'], ['sage', 'Sage (kadın, sakin)'], ['shimmer', 'Shimmer (kadın)'], ['nova', 'Nova (kadın, canlı)'],
      ['ballad', 'Ballad (erkek, yumuşak)'], ['ash', 'Ash (erkek)'], ['onyx', 'Onyx (erkek, kalın)'], ['fable', 'Fable (anlatıcı)']],
    chunk: 3800,
  },
};
const DEFAULT = { provider: 'azure', azureKey: '', azureRegion: 'westeurope', azureVoice: 'tr-TR-EmelNeural', openaiKey: '', openaiVoice: 'coral',
  rate: 0, style: 'Türkçe bir romanı, sıcak ve samimi bir sesli kitap anlatıcısı gibi oku. Acele etme; diyaloglarda karakterin duygusunu hissettir, sahnelerin havasına göre tonunu değiştir.' };
let cfg = null;
export async function ttsConfig() { return (cfg ||= { ...DEFAULT, ...((await db.getMeta('tts')) || {}) }); }
export async function saveTtsConfig(patch) { cfg = { ...(await ttsConfig()), ...patch }; await db.putMeta('tts', cfg); return cfg; }

// Tahmini süre ve maliyet (karakter sayısından). Türkçe sesli okuma ≈ dakikada 150 kelime ≈ 1100 karakter.
export function estimate(chars) {
  const minutes = chars / 1100;
  const az = PROVIDERS.azure, oa = PROVIDERS.openai;
  const azFree = Math.max(0, chars - az.free) / 1e6 * az.perM;
  return { minutes, azure: { paid: chars / 1e6 * az.perM, withFree: azFree }, openai: minutes * oa.perMin };
}

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Metni paragraf sınırlarından parçalara böl
export function chunks(text, max) {
  const paras = text.split(/\n{2,}|\n/).map(s => s.trim()).filter(Boolean);
  const out = []; let cur = '';
  for (let p of paras) {
    while (p.length > max) { // çok uzun paragraf: cümle sınırından kes
      const cut = Math.max(p.lastIndexOf('. ', max), p.lastIndexOf('! ', max), p.lastIndexOf('? ', max), Math.floor(max * 0.8));
      const head = p.slice(0, cut + 1); p = p.slice(cut + 1).trim();
      if (cur) { out.push(cur); cur = ''; }
      out.push(head);
    }
    if ((cur + '\n' + p).length > max && cur) { out.push(cur); cur = p; } else cur = cur ? `${cur}\n${p}` : p;
  }
  if (cur) out.push(cur);
  return out;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function withRetry(fn, signal) {
  for (let i = 0; ; i++) {
    if (signal?.aborted) throw new DOMException('Durduruldu', 'AbortError');
    const r = await fn();
    if (r.ok) return r;
    if ((r.status === 429 || r.status >= 500) && i < 6) { await sleep(Math.min(60000, 3000 * 2 ** i)); continue; }
    let msg = '';
    try { msg = (await r.text()).slice(0, 200); } catch { /* yok */ }
    if (r.status === 401 || r.status === 403) throw new Error('API anahtarı geçersiz ya da bu bölge/servis için yetkisiz');
    throw new Error(`Ses servisi hatası (${r.status})${msg ? `: ${msg}` : ''}`);
  }
}

// Tek parça metni sese çevir → Uint8Array (MP3)
export async function synth(text, c, signal) {
  if (c.provider === 'openai') {
    if (!c.openaiKey) throw new Error('OpenAI API anahtarı girilmedi');
    const r = await withRetry(() => fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST', signal,
      headers: { Authorization: `Bearer ${c.openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: c.openaiVoice, input: text, instructions: c.style, response_format: 'mp3', speed: 1 + (c.rate || 0) / 100 }),
    }), signal);
    return new Uint8Array(await r.arrayBuffer());
  }
  if (!c.azureKey) throw new Error('Azure anahtarı girilmedi');
  const multi = /Multilingual/.test(c.azureVoice);
  const inner = `<prosody rate="${c.rate >= 0 ? '+' : ''}${c.rate || 0}%">${esc(text).replace(/\n/g, '<break time="500ms"/>')}</prosody>`;
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="tr-TR"><voice name="${c.azureVoice}">${multi ? `<lang xml:lang="tr-TR">${inner}</lang>` : inner}</voice></speak>`;
  const r = await withRetry(() => fetch(`https://${c.azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST', signal,
    headers: { 'Ocp-Apim-Subscription-Key': c.azureKey, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3' },
    body: ssml,
  }), signal);
  return new Uint8Array(await r.arrayBuffer());
}

// Örnek: kitabın ilk gerçek bölümünden ~1 dakikalık metin
export async function sample(book, c) {
  const { epubChapters } = await import('./booktext.js');
  const ch = await epubChapters(book);
  const first = ch.find(x => x.text.length > 1500) || ch[0];
  const text = chunks(first.text, 1100)[0];
  const bytes = await synth(text, c);
  return { blob: new Blob([bytes], { type: 'audio/mpeg' }), text, chapters: ch, chars: ch.reduce((t, x) => t + x.text.length, 0) };
}

// ---------- Arka planda tüm kitap ----------
// İş durumu: { bookId, total, done, label, error, running }. Bölümler bittikçe kitaba eklenir; yarıda kalırsa kaldığı bölümden devam eder.
const jobs = new Map();
const listeners = new Set();
export const onJob = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach(f => { try { f(); } catch { /* yok */ } });
export const jobOf = id => jobs.get(id);

export async function convertBook(bookId, { fresh = false } = {}) {
  if (jobs.get(bookId)?.running) return;
  const c = await ttsConfig();
  const ctl = new AbortController();
  const job = { bookId, total: 0, done: 0, label: 'Bölümler hazırlanıyor…', running: true, error: '', ctl, startedAt: Date.now() };
  jobs.set(bookId, job); emit();
  try {
    const book = getBook(bookId);
    const { epubChapters } = await import('./booktext.js');
    const A = await import('./audio.js');
    const chapters = await epubChapters(book);
    const meta = (!fresh && (await db.getMeta(`ttsjob:${bookId}`))) || { provider: c.provider, voice: c.provider === 'azure' ? c.azureVoice : c.openaiVoice, done: 0 };
    if (fresh || !meta.done) { if (A.hasAudio(book)) await A.removeAudio(book); meta.done = 0; }
    job.total = chapters.length; job.done = meta.done; emit();
    for (let i = meta.done; i < chapters.length; i++) {
      const ch = chapters[i];
      job.label = `${i + 1}/${chapters.length} · ${ch.label}`; emit();
      const parts = chunks(ch.text, PROVIDERS[c.provider].chunk);
      const bufs = [];
      for (const [k, p] of parts.entries()) {
        job.sub = (k + 1) / parts.length; emit();
        bufs.push(await synth(p, c, ctl.signal));
      }
      const name = `${String(i + 1).padStart(3, '0')} - ${ch.label.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 60)}.mp3`;
      const file = new File(bufs, name, { type: 'audio/mpeg' });
      await A.attachAudio(getBook(bookId), [file], { replace: false });
      meta.done = i + 1; await db.putMeta(`ttsjob:${bookId}`, meta);
      job.done = i + 1; job.sub = 0; emit();
    }
    job.label = 'Tamamlandı'; await db.putMeta(`ttsjob:${bookId}`, null);
  } catch (e) {
    job.error = e.name === 'AbortError' ? 'Durduruldu; kaldığı bölümden devam edebilirsin' : (e.message || String(e));
  } finally { job.running = false; emit(); }
}
export const stopJob = id => jobs.get(id)?.ctl.abort();
export async function pendingJob(id) { return db.getMeta(`ttsjob:${id}`); }
