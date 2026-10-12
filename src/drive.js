// Google Drive adapter (read-only). Uses a Google service account that has Viewer access
// to the firm's Studio, Finance, Sales and Human Resources folders. Nothing is ever written to Drive.
import { HttpError, b64url, enc } from './util.js';
import { DRIVE, STAFF_DRIVE_ROOTS } from './config.js';

const API = 'https://www.googleapis.com/drive/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FIELDS = 'id,name,mimeType,modifiedTime,createdTime,size,fileExtension,parents,webViewLink,owners(emailAddress)';
const FOLDER = 'application/vnd.google-apps.folder';

// ---------- service account token ----------
let tokenCache = null;
function saKey(env) {
  if (!env.GOOGLE_SA_KEY) throw new HttpError(503, 'not_configured', 'Google Drive is not connected yet. A founder needs to add GOOGLE_SA_KEY.');
  try { const k = JSON.parse(env.GOOGLE_SA_KEY); if (!k.client_email || !k.private_key) throw 0; return k; }
  catch (e) { throw new HttpError(503, 'not_configured', 'GOOGLE_SA_KEY is not a valid service-account JSON key.'); }
}
async function accessToken(env) {
  if (tokenCache && tokenCache.exp > Date.now() + 60000) return tokenCache.token;
  const k = saKey(env);
  const pem = k.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const t = Math.floor(Date.now() / 1000);
  const head = b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claim = b64url(enc.encode(JSON.stringify({ iss: k.client_email, scope: 'https://www.googleapis.com/auth/drive.readonly', aud: TOKEN_URL, iat: t, exp: t + 3600 })));
  const sig = b64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${head}.${claim}`)));
  const res = await fetch(env.DEV_GOOGLE_TOKEN || TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${head}.${claim}.${sig}` });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new HttpError(503, 'not_configured', 'Google rejected the service-account key. Check GOOGLE_SA_KEY.');
  tokenCache = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return tokenCache.token;
}
async function call(env, path, params, raw) {
  const url = new URL((env.DEV_DRIVE_API || API) + path);
  Object.entries(params || {}).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
  const headers = { authorization: `Bearer ${await accessToken(env)}` };
  if (raw && raw.range) headers.range = raw.range;
  const res = await fetch(url, { headers });
  if (raw) return res;
  if (res.ok) return res.json();
  const err = await res.json().catch(() => ({}));
  const msg = (err.error && err.error.message) || `Drive returned ${res.status}.`;
  if (res.status === 404) throw new HttpError(404, 'tool_error', 'Drive could not find that file. Check the folder is shared with the service account.');
  if (res.status === 401 || res.status === 403) throw new HttpError(503, res.status === 401 ? 'not_configured' : 'tool_error', msg);
  if (res.status === 429) throw new HttpError(429, 'rate_limited', 'Drive is busy. Trying again shortly.');
  if (res.status >= 500) throw new HttpError(502, 'server_unavailable', 'Drive did not respond.');
  throw new HttpError(400, 'tool_error', msg);
}

// ---------- query translation (dashboard syntax → Drive API v3) ----------
// The dashboard writes queries such as "parentId = 'X' and title contains 'Invoice'".
export function translate(q) {
  const parts = String(q || '').split(/('(?:\\.|[^'\\])*')/); // keep quoted strings intact
  let out = '';
  for (let i = 0; i < parts.length; i++) {
    let p = parts[i];
    if (i % 2 === 1) { out += p; continue; }
    const next = parts[i + 1];
    if (/parentId\s*(!=|=)\s*$/.test(p) && next) {
      const neg = /!=\s*$/.test(p);
      out += p.replace(/parentId\s*(!=|=)\s*$/, '') + (neg ? 'not ' : '') + next + ' in parents';
      i++; continue;
    }
    if (/owner\s*(!=|=)\s*$/.test(p) && next) {
      const neg = /!=\s*$/.test(p);
      out += p.replace(/owner\s*(!=|=)\s*$/, '') + (neg ? 'not ' : '') + next + ' in owners';
      i++; continue;
    }
    out += p.replace(/\btitle\b/g, 'name');
  }
  return out.trim();
}
const mapFile = f => ({ id: f.id, title: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime, createdTime: f.createdTime, fileSize: f.size,
  fileExtension: f.fileExtension, parentId: (f.parents || [])[0], viewUrl: f.webViewLink, owner: f.owners && f.owners[0] && f.owners[0].emailAddress });

// ---------- staff boundary: only files inside the Studio tree ----------
const parentsCache = new Map();
async function parentsOf(env, id) {
  const c = parentsCache.get(id);
  if (c && Date.now() - c.at < 120000) return c.p;
  const f = await call(env, `/files/${encodeURIComponent(id)}`, { fields: 'id,parents', supportsAllDrives: 'true' });
  const p = f.parents || []; parentsCache.set(id, { p, at: Date.now() }); return p;
}
export async function insideStudio(env, id) {
  let frontier = [id], seen = new Set();
  for (let depth = 0; depth < 12 && frontier.length; depth++) {
    const next = [];
    for (const x of frontier) {
      if (STAFF_DRIVE_ROOTS.includes(x)) return true;
      if (seen.has(x)) continue; seen.add(x);
      try { next.push(...await parentsOf(env, x)); } catch (e) { /* not visible */ }
    }
    frontier = next;
  }
  return false;
}
async function guard(env, perms, id) {
  if (perms.drive === 'all') return;
  if (!await insideStudio(env, id)) throw new HttpError(403, 'forbidden', 'Your access level only includes project folders.');
}

// ---------- tools ----------
// Staff may only list one folder at a time: "parentId = 'X'" optionally followed by a mimeType clause.
// The Drive query is rebuilt here rather than passed through, so nothing else can be OR-ed in.
const STAFF_QUERY = /^\s*parentId\s*=\s*'([\w-]{10,120})'\s*(?:and\s+mimeType\s*(=|!=)\s*'([\w.+\/-]{3,120})'\s*)?$/;
export async function searchFiles(env, input, perms) {
  const q = String((input && input.query) || '').slice(0, 1000);
  let driveQ;
  if (perms.drive !== 'all') {
    const m = q.match(STAFF_QUERY);
    if (!m) throw new HttpError(403, 'forbidden', 'Your access level only includes project folders.');
    await guard(env, perms, m[1]);
    driveQ = `'${m[1]}' in parents` + (m[2] ? ` and mimeType ${m[2]} '${m[3]}'` : '');
  } else driveQ = translate(q) || "mimeType != 'x'";
  const full = /fullText\s+contains/.test(q);
  const r = await call(env, '/files', {
    q: `(${driveQ}) and trashed = false`, fields: `nextPageToken,files(${FIELDS})`,
    pageSize: Math.min(100, Math.max(1, Number(input.pageSize) || 30)), pageToken: typeof input.pageToken === 'string' ? input.pageToken : null,
    orderBy: full ? null : 'modifiedTime desc', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', corpora: 'allDrives'
  });
  return { files: (r.files || []).map(mapFile), nextPageToken: r.nextPageToken || null };
}

export async function recentFiles(env, input, perms) {
  const scope = perms.drive === 'all' ? '' : ` and '${DRIVE.outbox}' in parents`;
  const r = await call(env, '/files', {
    q: `mimeType != '${FOLDER}' and trashed = false${scope}`, fields: `files(${FIELDS})`, orderBy: 'modifiedTime desc',
    pageSize: Math.min(50, Number(input && input.pageSize) || 15), supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', corpora: 'allDrives'
  });
  return { files: (r.files || []).map(mapFile) };
}

export async function fileMeta(env, id, perms) {
  await guard(env, perms, id);
  const f = await call(env, `/files/${encodeURIComponent(id)}`, { fields: FIELDS, supportsAllDrives: 'true' });
  return mapFile(f);
}

// Streams a file's bytes to the browser (Google files are exported first).
const EXPORT = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.presentation': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};
export async function fileBytes(env, id, perms, range) {
  const meta = await fileMeta(env, id, perms);
  const exp = EXPORT[meta.mimeType];
  if (!exp && meta.mimeType.startsWith('application/vnd.google-apps.')) throw new HttpError(415, 'tool_error', 'This kind of Google file cannot be read here.');
  if (!exp && Number(meta.fileSize) > 60 * 1048576 && !range) throw new HttpError(413, 'too_large', 'This file is too large to read here.');
  const res = exp ? await call(env, `/files/${encodeURIComponent(id)}/export`, { mimeType: exp }, {})
    : await call(env, `/files/${encodeURIComponent(id)}`, { alt: 'media', supportsAllDrives: 'true' }, { range: range && /^bytes=\d*-\d*$/.test(range) ? range : null });
  if (!res.ok && res.status !== 206) throw new HttpError(res.status === 404 ? 404 : 502, 'tool_error', `Drive returned ${res.status} for this file.`);
  // Always served as a download, never rendered on this site (a Drive file could contain HTML or SVG).
  const h = new Headers({ 'content-type': 'application/octet-stream', 'content-disposition': 'attachment', 'cache-control': 'private, no-store',
    'content-security-policy': "default-src 'none'; sandbox", 'x-content-type-options': 'nosniff',
    'x-drive-mime': meta.mimeType, 'x-drive-modified': meta.modifiedTime || '', 'x-drive-size': meta.fileSize || '' });
  ['content-length', 'content-range', 'accept-ranges'].forEach(k => { const v = res.headers.get(k); if (v && !exp) h.set(k, v); });
  return new Response(res.body, { status: res.status === 206 ? 206 : 200, headers: h });
}

export async function drivePing(env) {
  const r = await call(env, '/files', { q: `'${DRIVE.studio}' in parents and trashed = false`, fields: 'files(id)', pageSize: 5, supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', corpora: 'allDrives' });
  const f = await call(env, '/files', { q: `'${DRIVE.finance}' in parents and trashed = false`, fields: 'files(id)', pageSize: 1, supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', corpora: 'allDrives' });
  if (!(r.files || []).length) throw new Error('Connected, but the Studio folder is not shared with the service account.');
  return `Studio folder visible${(f.files || []).length ? ', Finance visible' : ' · Finance not shared yet'}`;
}
