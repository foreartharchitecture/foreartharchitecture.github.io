// Creates a founder (arjun) and a staff account (faris) on a fresh local store. Run after `wrangler dev`.
import { webcrypto as crypto } from 'node:crypto';
const BASE = process.env.BASE || 'http://127.0.0.1:8787', MOCK = 'http://127.0.0.1:8790';
const enc = new TextEncoder(), b64url = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const passKey = async (pw, salt) => b64url(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('forearth-studio:' + salt), iterations: 210000 }, await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']), 256));
let cookie = '';
const post = async (p, b) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(b) }); const sc = r.headers.getSetCookie().find(c => c.startsWith('fs_s=')); if (sc) cookie = sc.split(';')[0]; const j = await r.json(); if (!r.ok) throw new Error(p + ' ' + JSON.stringify(j)); return j; };
const get = async p => (await fetch(BASE + p, { headers: { cookie } })).json();
const code = async to => ((await (await fetch(`${MOCK}/mail/last?to=${to}`)).json()).subject || '').slice(0, 6);
const c = await post('/auth/claim', { email: 'arjun@example.com' });
const v = await post('/auth/claim-verify', { challenge: c.challenge, code: await code('arjun@example.com') });
const info = await get('/auth/invite-info?token=' + v.token);
await post('/auth/accept', { token: v.token, username: 'arjun', name: 'Arjun Menon', passKey: await passKey('even better password', info.salt) });
await post('/admin/invite', { email: 'faris@example.com', name: 'Faris K', role: 'staff' });
const m = await (await fetch(`${MOCK}/mail/last?to=faris@example.com`)).json();
const tok = m.text.match(/invite#(\S+)/)[1]; const fi = await get('/auth/invite-info?token=' + tok);
cookie = '';
await post('/auth/accept', { token: tok, username: 'faris', name: 'Faris K', passKey: await passKey('new faris password', fi.salt) });
console.log('seeded founder arjun + staff faris');
