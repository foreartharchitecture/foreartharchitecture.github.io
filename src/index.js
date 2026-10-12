// Forearth Studio — Cloudflare Worker entry point.
// Serves the sign-in pages and the installable dashboard, and proxies Notion and Google Drive
// for signed-in users with server-side permission checks.
import { HttpError, json, body, randomId } from './util.js';
import { handleAuth, handleAdmin, currentUser, refreshCookie, publicUser } from './auth.js';
import { queryView, updatePage, createPages, search as notionSearch, fetchPage } from './notion.js';
import { searchFiles, recentFiles, fileMeta, fileBytes } from './drive.js';
import { aiStream } from './ai.js';
import { roleOf } from './config.js';

export { Store } from './store.js';

const PUBLIC_PAGES = { '/login': '/login.html', '/setup': '/login.html', '/invite': '/login.html', '/reset': '/login.html', '/keygen': '/keygen.html' };
const PUBLIC_FILES = /^\/(manifest\.webmanifest|sw\.js|login\.js|keygen\.js|favicon\.ico|robots\.txt|icons\/[\w.-]+)$/;

const csp = nonce => [
  "default-src 'self'", nonce ? `script-src 'self' 'nonce-${nonce}'` : "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data: blob:", "connect-src 'self'", "worker-src 'self'",
  "manifest-src 'self'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'"
].join('; ');

function harden(res, extra, nonce) {
  const r = new Response(res.body, res);
  const h = r.headers;
  h.set('x-content-type-options', 'nosniff');
  h.set('referrer-policy', 'same-origin');
  h.set('x-robots-tag', 'noindex, nofollow');
  h.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  if ((h.get('content-type') || '').includes('text/html')) { h.set('content-security-policy', csp(nonce)); h.set('x-frame-options', 'DENY'); h.set('cache-control', 'no-store'); }
  if (extra) for (const [k, v] of Object.entries(extra)) if (v) h.append(k, v);
  return r;
}
const asset = (env, req, path) => env.ASSETS.fetch(new Request(new URL(path, req.url), { headers: req.headers }));

async function serveApp(req, env, sess) {
  const res = await asset(env, req, '/app/index.html');
  const fresh = await refreshCookie(env, sess), nonce = randomId(16);
  const boot = JSON.stringify(Object.assign(publicUser(sess.user), { aiEnabled: !!env.ANTHROPIC_API_KEY, sessionExp: fresh.exp })).replace(/</g, '\\u003c');
  // Only scripts shipped in the page (marked with this request's nonce) may run.
  const out = new HTMLRewriter()
    .on('script', { element(el) { el.setAttribute('nonce', nonce); } })
    .on('head', { element(el) { el.prepend(`<script nonce="${nonce}">window.FE_USER=${boot};</script>`, { html: true }); } })
    .transform(res);
  return harden(new Response(out.body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }), { 'set-cookie': fresh.cookie }, nonce);
}

async function api(req, env, path, sess) {
  const perms = roleOf(sess.user.role);
  if (path === '/api/tool' && req.method === 'POST') {
    const b = await body(req);
    const input = b.input || {};
    let payload;
    switch (`${b.server}|${b.tool}`) {
      case 'Notion|notion-query-data-sources': payload = await queryView(env, input, perms); break;
      case 'Notion|notion-update-page': need(perms.write); payload = await updatePage(env, input); break;
      case 'Notion|notion-create-pages': need(perms.write); payload = await createPages(env, input); break;
      case 'Notion|notion-search': need(perms.search); payload = await notionSearch(env, input); break;
      case 'Notion|notion-fetch': need(perms.search); payload = await fetchPage(env, input); break;
      case 'Google Drive|search_files': payload = await searchFiles(env, input, perms); break;
      case 'Google Drive|list_recent_files': payload = await recentFiles(env, input, perms); break;
      default: throw new HttpError(400, 'tool_error', 'Unknown request.');
    }
    return json({ payload, storedAt: Date.now() });
  }
  const m = path.match(/^\/api\/drive\/(meta|file)\/([\w-]{10,120})$/);
  if (m && req.method === 'GET') {
    if (m[1] === 'meta') return json(await fileMeta(env, m[2], perms));
    return fileBytes(env, m[2], perms, req.headers.get('range'));
  }
  if (path === '/api/ai' && req.method === 'POST') { need(perms.ai); return aiStream(req, env); }
  throw new HttpError(404, 'not_found', 'Not found.');
}
function need(ok) { if (!ok) throw new HttpError(403, 'forbidden', 'Your access level is view-only.'); }

async function route(req, env) {
  const url = new URL(req.url), path = url.pathname;
  const isCall = /^\/(auth|admin|api)\//.test(path);

  if (isCall && req.method !== 'GET') {
    const origin = req.headers.get('origin');
    if (origin && origin !== url.origin) throw new HttpError(403, 'forbidden', 'Cross-site request blocked.');
  }
  if (path.startsWith('/auth/')) return handleAuth(req, env, path);

  if (PUBLIC_PAGES[path]) return harden(await asset(env, req, PUBLIC_PAGES[path]));
  if (PUBLIC_FILES.test(path)) return harden(await asset(env, req, path));

  const sess = await currentUser(req, env);
  if (path === '/' || path === '/index.html') {
    if (!sess) return Response.redirect(new URL('/login', url).toString(), 302);
    return serveApp(req, env, sess);
  }
  if (!sess) {
    if (isCall || path.startsWith('/app/')) throw new HttpError(401, 'unauthorized', 'Sign in to continue.');
    return Response.redirect(new URL('/login', url).toString(), 302);
  }
  if (path.startsWith('/admin/')) return handleAdmin(req, env, path, sess, url.origin);
  if (path.startsWith('/api/')) return api(req, env, path, sess);
  if (path.startsWith('/app/') && path !== '/app/index.html') return harden(await asset(env, req, path));
  return harden(new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } }));
}

function base(res) {
  const r = new Response(res.body, res);
  if (!r.headers.has('x-content-type-options')) r.headers.set('x-content-type-options', 'nosniff');
  if (!r.headers.has('x-robots-tag')) r.headers.set('x-robots-tag', 'noindex, nofollow');
  if (!r.headers.has('referrer-policy')) r.headers.set('referrer-policy', 'same-origin');
  return r;
}

export default {
  async fetch(req, env) {
    try { return base(await route(req, env)); }
    catch (e) {
      if (e instanceof HttpError) return base(json(Object.assign({ error: e.code, message: e.message }, e.extra || {}), e.status));
      console.error(e && e.stack || e);
      return base(json({ error: 'server_error', message: 'Something went wrong on the server. Try again.' }, 500));
    }
  }
};
