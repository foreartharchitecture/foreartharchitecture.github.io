// Small helpers: encoding, HMAC tokens, cookies, JSON responses.
export const enc = new TextEncoder();
export const dec = new TextDecoder();

export function b64url(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64urlDecode(str) {
  str = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function randomId(bytes = 18) { const a = new Uint8Array(bytes); crypto.getRandomValues(a); return b64url(a); }
export function randomDigits(n = 6) {
  const a = new Uint32Array(1); let s = '';
  while (s.length < n) { crypto.getRandomValues(a); if (a[0] < 4294967290) s += String(a[0] % 10); }
  return s;
}

const keyCache = new Map();
async function hmacKey(secret) {
  let k = keyCache.get(secret);
  if (!k) { k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); keyCache.set(secret, k); }
  return k;
}
export async function hmac(secret, data) { return b64url(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(data))); }
export async function sha256(data) { return b64url(await crypto.subtle.digest('SHA-256', enc.encode(data))); }
export function safeEqual(a, b) {
  a = String(a ?? ''); b = String(b ?? '');
  let r = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) r |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return r === 0;
}
export async function signToken(secret, obj) { const p = b64url(enc.encode(JSON.stringify(obj))); return p + '.' + await hmac(secret, 'tok:' + p); }
export async function readToken(secret, tok) {
  if (!tok || typeof tok !== 'string' || tok.length > 2048) return null;
  const i = tok.lastIndexOf('.'); if (i < 1) return null;
  const p = tok.slice(0, i), s = tok.slice(i + 1);
  if (!safeEqual(s, await hmac(secret, 'tok:' + p))) return null;
  try { const o = JSON.parse(dec.decode(b64urlDecode(p))); if (!o || (o.exp && o.exp < Date.now())) return null; return o; } catch (e) { return null; }
}

export function parseCookies(req) {
  const out = {}, h = req.headers.get('cookie') || '';
  h.split(/;\s*/).forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
export function cookie(name, value, maxAgeSec) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

export class HttpError extends Error {
  constructor(status, code, message, extra) { super(message || code); this.status = status; this.code = code; this.extra = extra; }
}
export function json(data, status = 200, headers) {
  const h = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  if (headers) for (const [k, v] of (headers instanceof Headers ? headers.entries() : Object.entries(headers))) h.append(k, v);
  return new Response(JSON.stringify(data), { status, headers: h });
}
export async function body(req) {
  const ct = req.headers.get('content-type') || '';
  if (!ct.includes('application/json')) throw new HttpError(415, 'bad_request', 'Send JSON.');
  const text = await req.text();
  if (text.length > 200000) throw new HttpError(413, 'too_large', 'Request too large.');
  try { const o = JSON.parse(text || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { throw new HttpError(400, 'bad_request', 'Invalid JSON.'); }
}
export const str = (v, max = 200) => (typeof v === 'string' ? v : '').trim().slice(0, max);
export const lower = v => str(v).toLowerCase();
export const isEmail = v => /^[^@\s<>"']{1,64}@[^@\s<>"']{1,190}\.[a-z]{2,}$/i.test(v || '');
export function maskEmail(e) {
  const [u, d] = String(e || '').split('@'); if (!d) return 'your email';
  return (u.length <= 2 ? u[0] + '•' : u.slice(0, 2) + '•'.repeat(Math.min(6, u.length - 2))) + '@' + d;
}
export const clientIp = req => req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || 'local';
export const now = () => Date.now();
