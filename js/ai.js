// Claude API bağlantısı. Anahtar yalnızca bu cihazda (IndexedDB 'meta') saklanır:
// GitHub'a eşitlenmez, yedeğe girmez.
import { db } from './db.js';

export const MODELS = {
  'claude-opus-5-5': { label: 'Claude Opus 5.5 (en iyi)', in: 4, out: 20, cacheWrite: 5, cacheRead: 0.2, fallbacks: true },
  'claude-sonnet-5-5': { label: 'Claude Sonnet 5.5 (yarı fiyat)', in: 2, out: 10, cacheWrite: 2.5, cacheRead: 0.1, fallbacks: true },
  'claude-haiku-5-5': { label: 'Claude Haiku 5.5 (en ucuz)', in: 0.1, out: 0.5, cacheWrite: 0.125, cacheRead: 0.01, fallbacks: false },
};
export const DEPTHS = { low: 'Hızlı', medium: 'Dengeli', high: 'Derin' };

const DEFAULT = { key: '', model: 'claude-haiku-5-5', effort: 'low', spent: 0 };
let cfg = null;

export async function aiConfig() {
  if (!cfg) {
    cfg = { ...DEFAULT, ...((await db.getMeta('ai')) || {}) };
    // Bir kerelik: model elle seçilmediyse varsayılan en ucuz model (Haiku) olsun
    if (!cfg.modelChosen && !cfg.haikuDefault) { cfg.model = 'claude-haiku-5-5'; cfg.haikuDefault = true; await db.putMeta('ai', cfg); }
  }
  return cfg;
}
export async function saveAiConfig(patch) {
  cfg = { ...(await aiConfig()), ...patch };
  await db.putMeta('ai', cfg);
  return cfg;
}
export const hasKey = async () => !!(await aiConfig()).key;

let sdk = null;
async function client() {
  const { key } = await aiConfig();
  if (!key) throw new Error('Önce Ayarlar → Asistan bölümünden Claude API anahtarını ekle');
  sdk ||= (await import('../vendor/anthropic-sdk.min.mjs')).default;
  // Anahtar kullanıcının kendi telefonunda; sunucu yok, bu yüzden tarayıcıdan doğrudan çağrı.
  return { Anthropic: sdk, c: new sdk({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 2 }) };
}

// Tahmini maliyet (USD)
export function costOf(model, u) {
  const p = MODELS[model] || MODELS['claude-opus-5-5'];
  return ((u.input_tokens || 0) * p.in + (u.cache_creation_input_tokens || 0) * p.cacheWrite
    + (u.cache_read_input_tokens || 0) * p.cacheRead + (u.output_tokens || 0) * p.out) / 1e6;
}

function friendlyError(Anthropic, e) {
  if (!navigator.onLine) return 'İnternet bağlantısı yok';
  if (e instanceof Anthropic.AuthenticationError) return 'API anahtarı geçersiz. Ayarlar → Asistan bölümünden kontrol et.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'Bu anahtarın izni yok.';
  if (e instanceof Anthropic.RateLimitError) return 'Çok sık istek gönderildi, biraz sonra tekrar dene.';
  if (e instanceof Anthropic.BadRequestError) return `İstek kabul edilmedi (bakiye bitmiş olabilir): ${e.message}`;
  if (e instanceof Anthropic.APIError) return `Claude şu an yanıt veremedi (${e.status ?? 'bağlantı'}). Tekrar dene.`;
  return e?.message || 'Bilinmeyen hata';
}

// Akışlı sohbet. onText: gelen metin parçaları. Dönüş: { text, cost, stop }
export async function chat({ system, messages, onText, signal }) {
  const { Anthropic, c } = await client();
  const conf = await aiConfig();
  const model = MODELS[conf.model] ? conf.model : 'claude-haiku-5-5';
  const params = {
    model,
    max_tokens: 16000,
    system,
    messages,
    output_config: { effort: conf.effort || 'low' },
  };
  if (MODELS[model].fallbacks) {
    // Güvenlik sınıflandırıcısı reddederse istek sunucuda otomatik başka modelle tamamlanır.
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }
  try {
    const stream = c.beta.messages.stream(params, { signal });
    stream.on('text', t => onText?.(t));
    const msg = await stream.finalMessage();
    const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const cost = costOf(msg.model || model, msg.usage || {});
    await saveAiConfig({ spent: (conf.spent || 0) + cost });
    if (msg.stop_reason === 'refusal') return { text: text || 'Bu soruya yanıt veremiyorum. Farklı bir şekilde sormayı dene.', cost, stop: 'refusal' };
    return { text, cost, stop: msg.stop_reason };
  } catch (e) {
    if (e?.name === 'AbortError' || e instanceof Anthropic.APIUserAbortError) return { text: '', cost: 0, stop: 'aborted' };
    throw new Error(friendlyError(Anthropic, e));
  }
}

// Anahtarı denemek için küçük bir istek
export async function testKey() {
  const { Anthropic, c } = await client();
  try {
    await c.models.retrieve((await aiConfig()).model);
    return true;
  } catch (e) { throw new Error(friendlyError(Anthropic, e)); }
}
