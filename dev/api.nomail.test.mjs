// Password-only mode (no Gmail relay). Run against `wrangler dev --env-file <vars without MAIL_*, with SETUP_CODE=dev-setup-code-123456>`.
import { webcrypto as crypto } from 'node:crypto';
const BASE = process.env.BASE || 'http://127.0.0.1:8787', SETUP = 'dev-setup-code-123456';
let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, x !== undefined ? JSON.stringify(x).slice(0, 300) : ''); } };
const enc = new TextEncoder(), b64url = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const passKey = async (pw, salt) => b64url(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('forearth-studio:' + salt), iterations: 210000 }, await crypto.subtle.importKey('raw', enc.encode(pw.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']), 256));
class C {
  constructor() { this.jar = {}; }
  async req(m, p, b) {
    const r = await fetch(BASE + p, { method: m, redirect: 'manual', headers: Object.assign({ cookie: Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; ') }, b !== undefined ? { 'content-type': 'application/json' } : {}), body: b !== undefined ? JSON.stringify(b) : undefined });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const [k, v] = kv.split('='); if (/Max-Age=0/i.test(c)) delete this.jar[k]; else this.jar[k] = v; }
    return { status: r.status, data: (r.headers.get('content-type') || '').includes('json') ? await r.json() : null };
  }
  post(p, b) { return this.req('POST', p, b || {}); } get(p) { return this.req('GET', p); }
}
async function signIn(c, login, pw) { const s = (await c.post('/auth/prelogin', { login })).data.salt; return c.post('/auth/login', { login, passKey: await passKey(pw, s) }); }
async function acceptLink(c, link, username, pw, name) {
  const token = link.split('#')[1]; const info = (await c.get('/auth/invite-info?token=' + token)).data;
  return { info, r: await c.post('/auth/accept', { token, username, name, passKey: await passKey(pw, info.salt) }) };
}

console.log('Password-only mode');
const A = new C();
let r = await A.get('/auth/config'); ok(r.data.mail === false && r.data.setup === true, 'config reports email codes off', r.data);
r = await A.post('/auth/claim', { email: 'arjun@example.com', setupCode: 'wrong-code-xx' }); ok(r.status === 401, 'wrong setup code rejected', r.data);
r = await A.post('/auth/claim', { email: 'stranger@example.com', setupCode: SETUP }); ok(r.status === 403, 'non-founder email rejected even with the code');
r = await A.post('/auth/claim', { email: 'arjun@example.com', setupCode: SETUP }); ok(r.status === 200 && r.data.token, 'founder setup with setup code', r.data);
let x = await acceptLink(A, '#' + r.data.token, 'arjun', 'founder password 1', 'Arjun Menon');
ok(x.r.status === 200 && A.jar.fs_s, 'founder account created and signed in', x.r.data);
r = await A.post('/auth/claim', { email: 'arjun@example.com' }); ok(r.status === 401, 'setup code is required again for an existing founder');

const A2 = new C();
r = await signIn(A2, 'arjun', 'founder password 1'); ok(r.status === 200 && r.data.done === true && A2.jar.fs_s, 'sign-in with username and password only (no code)', r.data);
r = await signIn(new C(), 'arjun', 'not the password'); ok(r.status === 401, 'wrong password rejected');
r = await A2.post('/auth/forgot', { login: 'arjun' }); ok(r.status === 503 && r.data.error === 'mail_off', 'email reset explains it is off', r.data);

console.log('Invite without email');
r = await A.post('/admin/invite', { email: 'faris@example.com', name: 'Faris K', role: 'staff' });
ok(r.status === 200 && r.data.emailed === false && /\/invite#/.test(r.data.link), 'invite returns a link to share', r.data);
const F = new C();
x = await acceptLink(F, r.data.link, 'faris', 'staff password 1', 'Faris K');
ok(x.r.status === 200 && F.jar.fs_s, 'staff account created from the link');
r = await F.get('/auth/me'); ok(r.data.user.role === 'staff', 'staff role');

console.log('Password reset link');
r = await A.get('/admin/users'); const fid = r.data.users.find(u => u.username === 'faris').id;
r = await A.post('/admin/reset-link', { id: fid }); ok(r.status === 200 && r.data.link && r.data.emailed === false, 'founder makes a reset link', r.data);
const F2 = new C();
x = await acceptLink(F2, r.data.link, 'faris', 'new staff password', 'Faris K');
ok(x.info.reset === true && x.info.username === 'faris', 'reset link shows the existing username', x.info);
ok(x.r.status === 200, 'new password saved', x.r.data);
r = await F.get('/auth/me'); ok(r.status === 401, 'old sessions signed out after reset');
r = await signIn(new C(), 'faris', 'staff password 1'); ok(r.status === 401, 'old password no longer works');
r = await signIn(new C(), 'faris', 'new staff password'); ok(r.status === 200 && r.data.done, 'new password works');
r = await F2.post('/admin/reset-link', { id: fid }); ok(r.status === 403, 'staff cannot make reset links');

console.log('Founder recovery with the setup code');
r = await new C().post('/auth/claim', { email: 'arjun@example.com', setupCode: SETUP }); ok(r.status === 200 && r.data.token, 'setup code issues a recovery link for an active founder');
const A3 = new C(); x = await acceptLink(A3, '#' + r.data.token, 'arjun', 'founder password 2', 'Arjun Menon');
ok(x.info.reset === true && x.r.status === 200, 'founder password reset', x.r.data);
r = await A.get('/auth/me'); ok(r.status === 401, 'founder\'s other sessions signed out');
r = await signIn(new C(), 'arjun', 'founder password 2'); ok(r.data && r.data.done, 'founder signs in with the new password');
r = await A3.post('/admin/update', { id: fid, status: 'disabled' }); ok(r.status === 200, 'staff disabled');
r = await new C().post('/auth/claim', { email: 'faris@example.com', setupCode: SETUP }); ok(r.status === 403, 'staff email cannot use founder setup');

r = await A3.get('/admin/status'); const mail = r.data.checks.find(c => c.key === 'mail'), setup = r.data.checks.find(c => c.key === 'setup');
ok(mail && /Off/.test(mail.note) && setup && setup.ok, 'system status explains password-only mode', r.data.checks);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
