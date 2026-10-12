// Optional AI answers for founders through the Anthropic API (ANTHROPIC_API_KEY).
// The response is streamed straight back to the browser as server-sent events.
import { HttpError, body } from './util.js';
import { AI_MODELS } from './config.js';

export async function aiStream(req, env) {
  if (!env.ANTHROPIC_API_KEY) throw new HttpError(503, 'not_granted', 'AI is not set up. A founder can add ANTHROPIC_API_KEY to turn it on.');
  const b = await body(req);
  const tier = ['quick', 'default', 'complex'].includes(b.tier) ? b.tier : 'default';
  const prompt = String(b.prompt || '').slice(0, 120000);
  if (prompt.length < 5) throw new HttpError(400, 'bad_request', 'Nothing to ask.');
  const model = env[`AI_MODEL_${tier.toUpperCase()}`] || AI_MODELS[tier];
  const res = await fetch(env.DEV_ANTHROPIC_API || 'https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: tier === 'quick' ? 1024 : 2048, stream: true, messages: [{ role: 'user', content: prompt }] })
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    const msg = (e.error && e.error.message) || '';
    if (res.status === 401 || res.status === 403) throw new HttpError(503, 'not_granted', 'The Anthropic API key was rejected.');
    if (res.status === 429 || res.status === 529) throw new HttpError(429, 'rate_limited', 'The AI service is busy. Try again shortly.');
    if (/too long|too many tokens/i.test(msg)) throw new HttpError(400, 'prompt_too_large', 'Too much material for one answer.');
    throw new HttpError(502, 'ai_error', msg || 'The AI service returned an error.');
  }
  return new Response(res.body, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-ai-tier': tier } });
}
