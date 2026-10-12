// Builds public/app/index.html from dashboard/dashboard.html (the same dashboard used on claude.ai)
// by applying small, checked patches for the standalone site: access levels, read-only staff mode,
// standalone wording, the window.claude bridge and installable-app tags. Also writes public/sw.js.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(root, p), 'utf8');
const hash = s => createHash('sha256').update(s).digest('hex').slice(0, 10);

let html = read('dashboard/dashboard.html');
let applied = 0;
function patch(name, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`Patch "${name}": expected 1 match, found ${n}. The dashboard source changed; update build/build.mjs.`);
  html = html.replace(find, replace); applied++;
}

// 1. Access levels: allowed sections, allowed Notion lists, read-only flag, deep links (?view=tasks).
patch('access-levels',
  "if (!VIEW_NAME[S.ui.view]) S.ui.view = 'overview';",
  `if (!VIEW_NAME[S.ui.view]) S.ui.view = 'overview';
const FEU = window.FE_USER || { groups: Object.keys(GROUPS), home: 'overview', perms: { write: true, search: true, views: '*' } };
const viewOk = v => !!VIEW_NAME[v] && FEU.groups.includes(groupOf(v));
const keyOk = k => FEU.perms.views === '*' || (FEU.perms.views || []).includes(k);
const RO = !FEU.perms.write;
{ const q = new URLSearchParams(location.search).get('view'); if (q && viewOk(q)) S.ui.view = q; }
if (!viewOk(S.ui.view)) S.ui.view = FEU.home;`);
patch('goView-guard', 'function goView(v) { S.ui.view = v;', 'function goView(v) { if (!viewOk(v)) v = FEU.home; S.ui.view = v;');
patch('act-readonly', "const a = el.dataset.act, D = derive();\n  switch (a) {",
  "const a = el.dataset.act, D = derive();\n  if (RO && ['new', 'convert', 'task-done', 'save-task-dates', 'save-ev-date'].includes(a)) { toast('Your access is view-only.', 'bad'); return; }\n  switch (a) {");
patch('drag-readonly', "document.addEventListener('dragstart', e => {", "document.addEventListener('dragstart', e => { if (RO) { e.preventDefault(); return; }");
patch('update-readonly', "if (!S.mcp) { toast('Connect Notion to make changes.', 'bad'); return false; }",
  "if (RO) { toast('Your access is view-only.', 'bad'); return false; }\n  if (!S.mcp) { toast('Connect Notion to make changes.', 'bad'); return false; }");
patch('create-readonly', "if (!S.mcp) { toast('Connect Notion to add records.', 'bad'); return null; }",
  "if (RO) { toast('Your access is view-only.', 'bad'); return null; }\n  if (!S.mcp) { toast('Connect Notion to add records.', 'bad'); return null; }");
patch('watch-allowed', 'NOTION_KEYS.forEach(watchNotion);', 'NOTION_KEYS.filter(keyOk).forEach(watchNotion);');
patch('updateConn-allowed', 'const errs = NOTION_KEYS.map(k => S.err[k]).filter(Boolean);', 'const errs = NOTION_KEYS.filter(keyOk).map(k => S.err[k]).filter(Boolean);');
patch('updateConn-live', "NOTION_KEYS.some(k => S.loaded[k]) ? 'live' : 'wait';", "NOTION_KEYS.filter(keyOk).some(k => S.loaded[k]) ? 'live' : 'wait';");
patch('hide-sections', '/* ================= Boot ================= */\nrenderAll();',
  `/* ================= Boot ================= */
Object.keys(GROUPS).forEach(g => { const t = $('#tab-' + g); if (t && !FEU.groups.includes(g)) t.hidden = true; });
if (RO) document.body.classList.add('ro');
if (!FEU.perms.search) { const b = document.querySelector('.pal-modes [data-v="search"]'); if (b) b.hidden = true; }
renderAll();`);

// 2. Search across Notion & Drive is a founder feature.
patch('search-guard', "q = String(q || '').trim(); if (q.length < 2) return;",
  "q = String(q || '').trim(); if (q.length < 2) return;\n  if (!FEU.perms.search) { toast('Searching Notion and Drive is available to founders. Use Find in dashboard instead.', 'bad'); return; }");
patch('pal-mode-guard', "case 'pal-mode': if (el.dataset.v === 'ai' && !aiAvailable()) break;", "case 'pal-mode': if (el.dataset.v === 'ai' && !aiAvailable()) break; if (el.dataset.v === 'search' && !FEU.perms.search) break;");
patch('pal-cycle', "const order = ['find', 'search'].concat(aiAvailable() ? ['ai'] : []);", "const order = ['find'].concat(FEU.perms.search ? ['search'] : [], aiAvailable() ? ['ai'] : []);");
patch('pal-items', "if (q.length >= 2) { items.push({ action: 'search' });", "if (q.length >= 2) { if (FEU.perms.search) items.push({ action: 'search' });");

// 3. Wording for the standalone site.
patch('err-codes', "    case 'cancelled': return 'Request cancelled.';",
  `    case 'cancelled': return 'Request cancelled.';
    case 'unauthorized': return 'Your session has ended. Sign in again.';
    case 'forbidden': return e.message || 'Your access level does not include this.';
    case 'not_configured': return (e.message || \`\${server} is not connected yet.\`) + ' A founder can check Access → System status.';`);
patch('deny-codes', "const DENY = new Set(['needs_reauth',", "const DENY = new Set(['not_configured', 'forbidden', 'unauthorized', 'needs_reauth',");
patch('ai-rate', "case 'rate_limited': return 'Your Claude usage limit has been reached for now. Try again later.';", "case 'rate_limited': return 'The AI service is busy or has reached its limit. Try again shortly.';");
patch('ai-session', "case 'session_expired': return 'Sign in to claude.ai again, then try once more.';", "case 'session_expired': case 'unauthorized': return 'Your session has ended. Sign in again.';");
patch('ai-hint', 'It runs on your own Claude usage.', 'It uses the firm’s Anthropic API key.');
patch('ai-off-hint', 'AI answers are not available in this view; keyword search still works.', 'AI answers are not turned on for this site; keyword search still works.');
patch('search-noconn', "toast('Open the dashboard in claude.ai to search Notion and Drive.', 'bad');", "toast('Search is not available right now.', 'bad');");

// 4. Page shell: document head, app tags, bridge before the dashboard script, account menu after.
const files = ['app/bridge.js', 'app/account.js'];
const v = Object.fromEntries(files.map(f => [f, hash(read('public/' + f))]));
const head = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#101311" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#ecebe4" media="(prefers-color-scheme: light)">
<meta name="robots" content="noindex">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icons/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Forearth">
<style>[hidden]{display:none!important}html,body{margin:0}
body.ro [data-act="new"],body.ro [data-act="convert"],body.ro [data-act="task-done"],body.ro [data-act="save-task-dates"],body.ro [data-act="save-ev-date"]{display:none!important}
@media (display-mode: standalone){.wrap{padding-top:max(18px,env(safe-area-inset-top))}}</style>
`;
if (!html.startsWith('<title>')) throw new Error('Dashboard source should start with <title>.');
html = head + html.replace('</style>', '</style>\n</head>\n<body>');
patch('bridge-script', '<script>\n(() => {\n\'use strict\';', `<script src="/app/bridge.js?v=${v['app/bridge.js']}"></script>\n<script>\n(() => {\n'use strict';`);
html = html.replace(/<\/script>\s*$/, `</script>\n<script src="/app/account.js?v=${v['app/account.js']}" defer></script>\n</body>\n</html>\n`);
if (!html.includes('/app/account.js')) throw new Error('Could not append the account script.');
for (const [, code] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(code, { filename: 'dashboard-inline.js' }); // throws on syntax errors
writeFileSync(join(root, 'public/app/index.html'), html);

// 5. Service worker with a version tied to the built files.
const pub = join(root, 'public');
const walk = d => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const version = hash(walk(pub).filter(p => !p.endsWith('sw.js')).sort().map(p => p + ':' + hash(readFileSync(p))).join('|'));
const precache = ['/login', '/login.js', '/manifest.webmanifest', '/favicon.ico', ...readdirSync(join(pub, 'icons')).map(n => '/icons/' + n)];
writeFileSync(join(pub, 'sw.js'), read('build/sw.template.js').replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(precache)));
console.log(`Built public/app/index.html (${applied} patches, ${(html.length / 1024).toFixed(0)} KB) and sw.js (version ${version}).`);
