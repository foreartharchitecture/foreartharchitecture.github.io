// End-to-end API test against `wrangler dev` + dev/mock.mjs. Run: node dev/api.test.mjs
import { webcrypto as crypto } from 'node:crypto';
const BASE = process.env.BASE || 'http://127.0.0.1:8787', MOCK = 'http://127.0.0.1:8790';
let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };
const enc = new TextEncoder();
const b64url = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function passKey(pw, salt) {
  const km = await crypto.subtle.importKey('raw', enc.encode(pw.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  return b64url(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('forearth-studio:' + salt), iterations: 210000 }, km, 256));
}
class Client {
  constructor(name) { this.name = name; this.jar = {}; }
  cookie() { return Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; '); }
  async req(method, path, body, headers = {}) {
    const res = await fetch(BASE + path, { method, redirect: 'manual', headers: Object.assign({ cookie: this.cookie() }, body !== undefined ? { 'content-type': 'application/json' } : {}, headers), body: body !== undefined ? JSON.stringify(body) : undefined });
    for (const c of res.headers.getSetCookie()) { const [kv, ...attrs] = c.split(';'); const [k, v] = kv.split('='); if (/Max-Age=0/i.test(c)) delete this.jar[k.trim()]; else this.jar[k.trim()] = v; }
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : ct.includes('event-stream') ? await res.text() : null;
    return { status: res.status, data, res };
  }
  post(p, b, h) { return this.req('POST', p, b || {}, h); }
  get(p, h) { return this.req('GET', p, undefined, h); }
  tool(server, tool, input) { return this.post('/api/tool', { server, tool, input }); }
}
const lastMail = async to => (await (await fetch(`${MOCK}/mail/last?to=${encodeURIComponent(to)}`)).json());
const codeFrom = m => (m.subject || '').match(/^(\d{6})/)[1];
const V = { projects: 'view://395eac43-053f-80bf-aea4-000cec07b988', tasks: 'view://245eac43-053f-8030-9aab-000c98f18d7b', follow: 'view://369eac43-053f-80b2-877d-000c26095248', done: 'view://34beac43-053f-80e0-85ac-000cf8cb1409',
  visits: 'view://35eeac43-053f-8012-9fbb-000c142cad44', meetings: 'view://35ceac43-053f-8051-97f5-000cacd0dbe9', team: 'view://39feac43-053f-8049-ba4a-000c181645da', crm: 'view://351eac43-053f-8086-bb13-000c1b4a22eb',
  clients: 'view://269eac43-053f-80ec-b165-000c9953c798', issues: 'view://35eeac43-053f-8068-9c0a-000c490afa8a' };
const view = (c, key) => c.tool('Notion', 'notion-query-data-sources', { data: { mode: 'view', view_url: V[key], page_size: 100 } });

console.log('Founder setup');
const A = new Client('arjun');
let r = await A.post('/auth/claim', { email: 'stranger@example.com' });
ok(r.status === 403 && r.data.error === 'not_founder', 'non-founder email cannot claim', r.data);
r = await A.post('/auth/claim', { email: 'Arjun@Example.com' });
ok(r.status === 200 && r.data.challenge, 'founder claim sends code', r.data);
let m = await lastMail('arjun@example.com');
ok(/is your Forearth Studio code/.test(m.subject), 'code email subject', m.subject);
r = await A.post('/auth/claim-verify', { challenge: r.data.challenge, code: '000000' });
ok(r.status === 400 && r.data.error === 'wrong_code', 'wrong code rejected', r.data);
r = await A.post('/auth/claim', { email: 'arjun@example.com' }); const ch = r.data.challenge; m = await lastMail('arjun@example.com');
r = await A.post('/auth/claim-verify', { challenge: ch, code: codeFrom(m) });
ok(r.status === 200 && r.data.token, 'claim verified', r.data);
const tok = r.data.token;
r = await A.get('/auth/invite-info?token=' + encodeURIComponent(tok));
ok(r.status === 200 && r.data.role === 'founder' && r.data.salt, 'invite info for founder', r.data);
const salt0 = r.data.salt;
r = await A.post('/auth/accept', { token: tok, username: 'Arjun', name: 'Arjun Menon', passKey: await passKey('correct horse battery', salt0) });
ok(r.status === 200 && A.jar.fs_s, 'account created and signed in', r.data);
r = await A.get('/auth/me');
ok(r.data.user && r.data.user.role === 'founder' && r.data.user.username === 'arjun', 'me = founder arjun', r.data);
r = await A.post('/auth/accept', { token: tok, username: 'arjun2', passKey: await passKey('x'.repeat(12), salt0) });
ok(r.status === 404, 'setup link works only once', r.data);

console.log('Sign in with password + code');
const A2 = new Client('arjun-phone');
r = await A2.post('/auth/prelogin', { login: 'arjun' }); const s1 = r.data.salt;
ok(s1 === salt0, 'prelogin returns account salt');
r = await A2.post('/auth/prelogin', { login: 'nobody' });
ok(r.data.salt && r.data.salt !== salt0, 'prelogin returns a stable fake salt for unknown users');
r = await A2.post('/auth/login', { login: 'arjun', passKey: await passKey('wrong password!!', s1) });
ok(r.status === 401 && r.data.error === 'bad_login', 'wrong password rejected', r.data);
r = await A2.post('/auth/login', { login: 'ARJUN@example.com', passKey: await passKey('correct horse battery', s1) });
ok(r.status === 200 && r.data.challenge && /^ar•/.test(r.data.hint), 'email login + right password asks for code', r.data);
m = await lastMail('arjun@example.com');
r = await A2.post('/auth/verify', { challenge: r.data.challenge, code: codeFrom(m), remember: true });
ok(r.status === 200 && A2.jar.fs_s && A2.jar.fs_d, 'code accepted, session + device cookies', A2.jar);
r = await A2.post('/auth/logout', {});
ok(!A2.jar.fs_s && A2.jar.fs_d, 'logout clears session, keeps device');
r = await A2.post('/auth/login', { login: 'arjun', passKey: await passKey('correct horse battery', s1) });
ok(r.status === 200 && r.data.done === true && A2.jar.fs_s, 'remembered device skips the code', r.data);
r = await A2.post('/auth/verify', { challenge: 'nope', code: '123456' });
ok(r.status === 400, 'bogus challenge rejected');

console.log('Cross-site and unauthenticated');
const X = new Client('anon');
r = await X.post('/api/tool', { server: 'Notion', tool: 'notion-query-data-sources', input: {} });
ok(r.status === 401, 'API needs sign-in');
r = await A.post('/api/tool', { server: 'Notion', tool: 'x' }, { origin: 'https://evil.example' });
ok(r.status === 403, 'cross-site POST blocked');
r = await X.get('/');
ok(r.status === 302 && /\/login$/.test(r.res.headers.get('location')), '/ redirects to sign-in when signed out');
r = await A.get('/');
ok(r.status === 200, 'app page served when signed in');
const html = await r.res.text();
ok(html.includes('window.FE_USER=') && html.includes('"role":"founder"'), 'app page carries user + role');
ok((r.res.headers.get('content-security-policy') || '').includes("frame-ancestors 'none'"), 'CSP header on app page');

console.log('Founder data');
const keys = Object.keys(V); const views = {};
for (const k of keys) { r = await view(A, k); views[k] = r.data && r.data.payload; ok(r.status === 200 && Array.isArray(views[k] && views[k].results), `view ${k} (${views[k] ? views[k].results.length : 0} rows)`, r.data); }
const t0 = views.tasks.results.find(t => t.Name.startsWith('Working drawings'));
ok(t0 && t0['Task ID'] === '301' && t0['date:Task Range:start'] && t0['date:Task Range:is_datetime'] === 0 && JSON.parse(t0.Projects)[0].startsWith('https://www.notion.so/'), 'task row shape matches dashboard format', t0);
ok(!views.tasks.results.some(t => t.Status === 'Done'), 'open-tasks view excludes Done');
ok(views.done.results.every(t => t.Status === 'Done') && views.done.results.length === 2, 'done view');
ok(views.follow.results.length === 1, 'follow-up view');
ok(views.team.results[0].Email && views.team.results[0]['date:DOB:start'] && !('Telegram Chat ID' in views.team.results[0]), 'founder sees team contact; Telegram ID never sent');
const v0 = views.visits.results.find(v => v.Title === 'Foundation inspection');
ok(v0 && v0['date:Date and Time:is_datetime'] === 1 && v0['date:Date and Time:start'].includes('T'), 'datetime visit flagged', v0);
ok(JSON.parse(views.crm.results[0].Scope).length >= 1, 'multi-select as JSON list');

console.log('Two-way sync');
r = await A.tool('Notion', 'notion-update-page', { page_id: t0.url, command: 'update_properties', properties: { Status: 'Done', 'date:Done:start': '2026-10-08', 'date:Done:is_datetime': 0 } });
ok(r.status === 200, 'task marked done', r.data);
r = await view(A, 'tasks'); ok(!r.data.payload.results.some(t => t.url === t0.url), 'task left the open list');
r = await A.tool('Notion', 'notion-update-page', { page_id: t0.url, command: 'update_properties', properties: { 'date:Task Range:end': '2026-10-20' } });
ok(r.status === 200, 'end-date-only change keeps start', r.data);
r = await view(A, 'done'); const t0b = r.data.payload.results.find(t => t.url === t0.url);
ok(t0b && t0b['date:Task Range:start'] && t0b['date:Task Range:end'] === '2026-10-20', 'date range merged', t0b);
const proj = views.projects.results.find(p => p.Name === 'Hillside Residence'), lead = views.team.results[0];
r = await A.tool('Notion', 'notion-create-pages', { parent: { type: 'data_source_id', data_source_id: '1ceeac43-053f-80b6-b099-000b73589415' }, pages: [{ properties: { Name: 'Test task from API', Status: 'Not started', Priority: 'P2', Projects: [proj.url], Assignee: JSON.stringify([lead.url]), 'date:Task Range:start': '2026-10-10', 'date:Task Range:is_datetime': 0, 'date:Task Range:end': '2026-10-12' } }] });
ok(r.status === 200 && r.data.payload.pages[0].url.includes('notion.so/'), 'task created', r.data);
r = await view(A, 'tasks'); const nt = r.data.payload.results.find(t => t.Name === 'Test task from API');
ok(nt && JSON.parse(nt.Projects)[0] === proj.url && nt['date:Task Range:end'] === '2026-10-12', 'created task reads back with relation + range', nt);
r = await A.tool('Notion', 'notion-create-pages', { parent: { type: 'data_source_id', data_source_id: '1ceeac43-053f-8079-901e-000bd426820c' }, pages: [{ properties: { Name: 'x' } }] });
ok(r.status === 403, 'cannot create in Team database');
r = await A.tool('Notion', 'notion-update-page', { page_id: lead.url, command: 'update_properties', properties: { Name: 'Hacked' } });
ok(r.status === 403, 'cannot edit Team pages');
r = await A.tool('Notion', 'notion-update-page', { page_id: proj.url, command: 'update_properties', properties: { 'No Such Prop': 'x' } });
ok(r.status === 400, 'unknown property rejected');
r = await A.tool('Notion', 'notion-search', { query: 'Hillside', page_size: 5 });
ok(r.status === 200 && r.data.payload.results.length > 0 && r.data.payload.results[0].title, 'Notion search', r.data);
r = await A.tool('Notion', 'notion-fetch', { id: r.data.payload.results[0].id });
ok(r.status === 200 && /budget confirmed/.test(r.data.payload.text), 'Notion page text', r.data);

console.log('Drive');
r = await A.tool('Google Drive', 'search_files', { query: "parentId = '1oy6y9ahlBETlVHQCVKs5z3BKHoduKmqz' and mimeType = 'application/vnd.google-apps.folder'", pageSize: 100, excludeContentSnippets: true });
ok(r.status === 200 && r.data.payload.files.length === 2 && r.data.payload.files[0].title.startsWith('FE-100-'), 'project folders', r.data);
r = await A.tool('Google Drive', 'search_files', { query: "title contains 'Invoice' and mimeType != 'application/vnd.google-apps.folder'", pageSize: 100 });
ok(r.status === 200 && r.data.payload.files.length === 2, 'invoice search (founder)', r.data);
r = await A.tool('Google Drive', 'list_recent_files', { orderBy: 'lastModified', pageSize: 15 });
ok(r.status === 200 && r.data.payload.files.some(f => f.title.includes('Invoice')), 'recent files include finance for founders');
r = await A.get('/api/drive/file/file-inv-hill-00002', { range: 'bytes=0-99' });
ok(r.status === 206 && r.res.headers.get('content-range'), 'ranged file read', r.res.headers.get('content-range'));
ok(r.res.headers.get('content-type') === 'application/octet-stream' && /attachment/.test(r.res.headers.get('content-disposition') || '') && /sandbox/.test(r.res.headers.get('content-security-policy') || ''), 'Drive files are served as inert downloads');
r = await A.get('/api/drive/meta/file-q3-finance-0001');
ok(r.status === 200 && r.data.mimeType.includes('spreadsheet'), 'file meta');

console.log('AI');
r = await A.post('/api/ai', { prompt: 'Brief me on this week', tier: 'quick' });
ok(r.status === 200 && /content_block_delta/.test(r.data), 'AI answer streams');

console.log('Invite staff');
r = await A.post('/admin/invite', { email: 'faris@example.com', name: 'Faris K', role: 'staff' });
ok(r.status === 200, 'invite sent', r.data);
m = await lastMail('faris@example.com');
const link = (m.text || '').match(/https?:\/\/\S+\/invite#(\S+)/);
ok(link, 'invite email has link', m.text);
const F = new Client('faris');
r = await F.get('/auth/invite-info?token=' + link[1]);
ok(r.data.role === 'staff' && r.data.name === 'Faris K', 'invite info', r.data);
r = await F.post('/auth/accept', { token: link[1], username: 'arjun', name: 'Faris', passKey: await passKey('faris password 1', r.data.salt) });
ok(r.status === 409, 'taken username rejected without using the link', r.data);
r = await F.get('/auth/invite-info?token=' + link[1]);
r = await F.post('/auth/accept', { token: link[1], username: 'faris', name: 'Faris K', passKey: await passKey('faris password 1', r.data.salt) });
ok(r.status === 200 && F.jar.fs_s, 'staff account created', r.data);
r = await F.get('/auth/me'); ok(r.data.user.role === 'staff' && r.data.groups.join() === 'studio' && r.data.perms.write === false, 'staff permissions', r.data);

console.log('Staff boundaries');
r = await view(F, 'tasks'); ok(r.status === 200, 'staff can read tasks');
r = await view(F, 'team'); const tm = r.data.payload.results[0];
ok(tm && tm.Name && !('Email' in tm) && !('Contact' in tm) && !('date:DOB:start' in tm), 'staff team view hides contact details', tm);
for (const k of ['crm', 'clients']) { r = await view(F, k); ok(r.status === 403, `staff blocked from ${k}`); }
r = await F.tool('Notion', 'notion-update-page', { page_id: proj.url, command: 'update_properties', properties: { Stage: 'Finishing' } });
ok(r.status === 403, 'staff cannot edit');
r = await F.tool('Notion', 'notion-create-pages', { parent: { type: 'data_source_id', data_source_id: '1ceeac43-053f-80b6-b099-000b73589415' }, pages: [{ properties: { Name: 'x' } }] });
ok(r.status === 403, 'staff cannot create');
r = await F.tool('Notion', 'notion-search', { query: 'x' }); ok(r.status === 403, 'staff cannot search Notion');
r = await F.tool('Google Drive', 'search_files', { query: "parentId = '1oy6y9ahlBETlVHQCVKs5z3BKHoduKmqz' and mimeType = 'application/vnd.google-apps.folder'", excludeContentSnippets: true });
ok(r.status === 200 && r.data.payload.files.length === 2, 'staff sees project folders');
r = await F.tool('Google Drive', 'search_files', { query: "parentId = 'fold-hill-0000000001'", excludeContentSnippets: true });
ok(r.status === 200 && r.data.payload.files.length === 1, 'staff opens a project folder');
r = await F.tool('Google Drive', 'search_files', { query: "parentId = '1esrOpUqQtjvXLmsqy_Tg7uNCVpy0Sx8o'" }); ok(r.status === 403, 'staff blocked from accounts folder');
r = await F.tool('Google Drive', 'search_files', { query: "title contains 'Invoice'" }); ok(r.status === 403, 'staff blocked from firm-wide search');
r = await F.tool('Google Drive', 'search_files', { query: "parentId = '1oy6y9ahlBETlVHQCVKs5z3BKHoduKmqz' or title contains 'Invoice'" }); ok(r.status === 403, 'staff cannot OR other files into a folder query');
r = await F.tool('Google Drive', 'search_files', { query: "parentId = '1oy6y9ahlBETlVHQCVKs5z3BKHoduKmqz') or (title contains 'Invoice'" }); ok(r.status === 403, 'staff cannot break out of the folder clause');
r = await F.tool('Google Drive', 'list_recent_files', { pageSize: 15 });
ok(r.status === 200 && r.data.payload.files.every(f => f.parentId === '12qr32I9yYrmsiyoKn-VPNM6ZPQStm-y4'), 'staff recent files limited to Outbox', r.data);
r = await F.get('/api/drive/file/file-inv-hill-00002'); ok(r.status === 403, 'staff blocked from invoice file');
r = await F.get('/api/drive/meta/file-hill-plan-00001'); ok(r.status === 200, 'staff can open a drawing in a project folder');
r = await F.post('/api/ai', { prompt: 'hello there' }); ok(r.status === 403, 'staff has no AI');
r = await F.get('/admin/users'); ok(r.status === 403, 'staff cannot manage access');
r = await F.get('/'); const fhtml = await r.res.text(); ok(fhtml.includes('"role":"staff"'), 'staff app page');

console.log('Access management');
r = await A.get('/admin/users'); ok(r.status === 200 && r.data.users.length === 2, 'list users', r.data);
const fid = r.data.users.find(u => u.username === 'faris').id, aid = r.data.users.find(u => u.username === 'arjun').id;
r = await A.post('/admin/update', { id: aid, status: 'disabled' }); ok(r.status === 400, 'cannot disable yourself');
r = await A.post('/admin/update', { id: aid, role: 'staff' }); ok(r.status === 400, 'last founder cannot be demoted');
r = await A.post('/admin/update', { id: fid, status: 'disabled' }); ok(r.status === 200, 'disable staff');
r = await F.get('/auth/me'); ok(r.status === 401, 'disabled account signed out immediately');
r = await A.post('/admin/update', { id: fid, status: 'active' }); ok(r.status === 200, 're-enable staff');
r = await F.get('/auth/me'); ok(r.status === 401, 're-enabled account must sign in again');
r = await A.get('/admin/status'); ok(r.status === 200 && r.data.checks.every(c => c.ok), 'system status all green', r.data.checks.filter(c => !c.ok));

console.log('Removed founder');
const N = new Client('nisha');
r = await N.post('/auth/claim', { email: 'nisha@example.com' }); m = await lastMail('nisha@example.com');
r = await N.post('/auth/claim-verify', { challenge: r.data.challenge, code: codeFrom(m) });
let ni = await N.get('/auth/invite-info?token=' + r.data.token);
r = await N.post('/auth/accept', { token: r.data.token, username: 'nisha', name: 'Nisha Rahman', passKey: await passKey('nisha password 1', ni.data.salt) });
ok(r.status === 200, 'second founder set up');
r = await A.get('/admin/users'); const nid = r.data.users.find(u => u.username === 'nisha').id;
r = await A.post('/admin/remove', { id: nid }); ok(r.status === 200, 'founder removed');
r = await N.get('/auth/me'); ok(r.status === 401, 'removed founder signed out');
r = await N.post('/auth/claim', { email: 'nisha@example.com' }); ok(r.status === 403, 'removed founder cannot re-create the account via founder setup', r.data);
r = await A.get('/admin/users'); ok(!r.data.users.some(u => u.email === 'nisha@example.com'), 'removed account hidden from the list');
r = await A.post('/admin/invite', { email: 'nisha@example.com', name: 'Nisha Rahman', role: 'staff' }); ok(r.status === 200, 'removed person can be invited again');
r = await N.post('/auth/claim', { email: 'nisha@example.com' }); ok(r.status === 409, 'person re-invited as staff cannot promote themselves through founder setup', r.data);

console.log('Forgot password');
const F2 = new Client('faris-reset');
r = await F2.post('/auth/forgot', { login: 'faris' }); ok(r.status === 200 && r.data.challenge && r.data.salt, 'reset code sent', r.data);
m = await lastMail('faris@example.com');
const rs = r.data;
r = await F2.post('/auth/reset', { challenge: rs.challenge, code: codeFrom(m), passKey: await passKey('new faris password', rs.salt) });
ok(r.status === 200 && F2.jar.fs_s, 'password reset signs in', r.data);
r = await F2.post('/auth/prelogin', { login: 'faris' }); ok(r.data.salt === rs.salt, 'new salt stored');
r = await F2.post('/auth/forgot', { login: 'ghost' }); ok(r.status === 200 && r.data.challenge, 'unknown account gets the same response');

console.log('Change password');
r = await A.get('/auth/me'); const cs = r.data.clientSalt, ns = b64url(crypto.getRandomValues(new Uint8Array(16)));
r = await A.post('/auth/password', { currentPassKey: await passKey('correct horse battery', cs), newPassKey: await passKey('even better password', ns), newSalt: ns });
ok(r.status === 200, 'password changed', r.data);
r = await A2.get('/auth/me'); ok(r.status === 401, 'other devices signed out after password change');
r = await A.get('/auth/me'); ok(r.status === 200, 'this device stays signed in');

console.log('Rate limiting');
const FD = new Client('faris-own-phone');
r = await FD.post('/auth/prelogin', { login: 'faris' }); const fsalt = r.data.salt;
r = await FD.post('/auth/login', { login: 'faris', passKey: await passKey('new faris password', fsalt) });
m = await lastMail('faris@example.com'); r = await FD.post('/auth/verify', { challenge: r.data.challenge, code: codeFrom(m), remember: true });
ok(FD.jar.fs_d, 'faris remembers this phone');
const R = new Client('brute'); let last;
for (let i = 0; i < 12; i++) last = await R.post('/auth/login', { login: 'faris', passKey: 'A'.repeat(43) });
ok(last.status === 429, 'repeated wrong passwords are throttled', last.data);
r = await FD.post('/auth/logout', {});
r = await FD.post('/auth/login', { login: 'faris', passKey: await passKey('new faris password', fsalt) });
ok(r.status === 200 && r.data.done, 'remembered device still signs in during an attack on the account', r.data);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
