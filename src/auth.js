// Accounts, sign-in (password + emailed code), invitations, sessions and access management.
//
// Passwords never reach the server: the browser derives a key with PBKDF2-SHA256
// (210,000 rounds, per-user salt) and the server stores a salted SHA-256 of that key.
import { HttpError, json, body, str, lower, isEmail, maskEmail, clientIp, randomId, randomDigits, hmac, sha256, safeEqual,
  signToken, readToken, parseCookies, cookie } from './util.js';
import { sendMail, codeEmail, inviteEmail } from './mail.js';
import { ROLES, roleOf } from './config.js';

const MIN = 60000, HOUR = 3600000, DAY = 86400000;
const SESSION_TTL = 14 * DAY, DEVICE_TTL = 30 * DAY, CODE_TTL = 10 * MIN;
const S_COOKIE = 'fs_s', D_COOKIE = 'fs_d';

export const store = env => env.STORE.get(env.STORE.idFromName('main'));
const secret = env => {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 24) throw new HttpError(503, 'not_configured', 'SESSION_SECRET is missing. Add it in the Cloudflare settings.');
  return env.SESSION_SECRET;
};
const founderEmails = env => String(env.FOUNDER_EMAILS || '').split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
const passKeyOk = k => typeof k === 'string' && /^[A-Za-z0-9_-]{40,64}$/.test(k);
const saltOk = s => typeof s === 'string' && /^[A-Za-z0-9_-]{16,44}$/.test(s);
const usernameOk = u => /^[a-z0-9][a-z0-9._-]{2,31}$/i.test(u);

// ---------- sessions ----------
const userCache = new Map();
async function loadUser(env, id, fresh) {
  const c = userCache.get(id);
  if (!fresh && c && Date.now() - c.at < 30000) return c.u;
  const u = await store(env).getUser({ id });
  userCache.set(id, { u, at: Date.now() });
  return u;
}
export const forgetUser = id => userCache.delete(id);

export async function currentUser(req, env) {
  const tok = parseCookies(req)[S_COOKIE];
  if (!tok || !env.SESSION_SECRET) return null;
  const t = await readToken(env.SESSION_SECRET, tok);
  if (!t || t.s !== 1 || !t.u) return null;
  const u = await loadUser(env, t.u);
  if (!u || u.status !== 'active' || u.sv !== t.v) return null;
  return { user: u, token: t };
}
async function sessionCookie(env, u) {
  const t = Date.now();
  return cookie(S_COOKIE, await signToken(secret(env), { s: 1, u: u.id, v: u.sv, iat: t, exp: t + SESSION_TTL }), SESSION_TTL / 1000);
}
async function deviceCookie(env, u) {
  const t = Date.now();
  return cookie(D_COOKIE, await signToken(secret(env), { d: 1, u: u.id, v: u.sv, exp: t + DEVICE_TTL }), DEVICE_TTL / 1000);
}
// Re-issues the session cookie once a day so active users stay signed in.
export async function refreshCookie(env, sess) {
  if (Date.now() - sess.token.iat < DAY) return { cookie: null, exp: sess.token.exp };
  return { cookie: await sessionCookie(env, sess.user), exp: Date.now() + SESSION_TTL };
}
export function publicUser(u) {
  const r = roleOf(u.role);
  return {
    user: { id: u.id, username: u.username, name: u.name || u.username, email: u.email, role: u.role, roleLabel: r.label },
    perms: { write: r.write, search: r.search, ai: r.ai, admin: r.admin, drive: r.drive, views: r.views },
    groups: r.groups, home: r.home
  };
}

// ---------- helpers ----------
// Founder setup only creates a brand-new account or completes a pending founder invitation.
function claimable(u) {
  if (!u) return;
  if (u.status === 'invited' && u.role === 'founder') return;
  if (u.status === 'disabled') throw new HttpError(403, 'disabled', 'This account has been disabled. Ask another founder to turn it back on.');
  if (u.status === 'removed') throw new HttpError(403, 'disabled', 'This account was removed. Ask another founder to invite you again.');
  if (u.status === 'invited') throw new HttpError(409, 'exists', 'You have an invitation waiting. Use the link in your invitation email.');
  throw new HttpError(409, 'exists', 'An account already exists for this email. Sign in, or use “Forgot password”.');
}
async function limit(env, key, windowMs, max, message) {
  const r = await store(env).hit(key, windowMs, max);
  if (!r.ok) throw new HttpError(429, 'rate_limited', message || 'Too many attempts. Wait a few minutes and try again.');
}
const codeHash = (env, id, code) => hmac(secret(env), `otp:${id}:${code}`);
// Email budget: per address 8 an hour and 20 a day; firm-wide 95 a day (the Gmail relay allows about 100),
// of which requests that have not passed a password check (reset, founder setup) may use at most 50.
async function mailLimit(env, email, purpose) {
  const e = String(email || '').toLowerCase();
  await limit(env, 'mail:' + e, HOUR, 8, 'Too many codes requested. Wait an hour and try again.');
  await limit(env, 'mailday:' + e, DAY, 20, 'Too many codes requested today. Try again tomorrow or ask a founder.');
  if (purpose !== 'login') await limit(env, 'mail:other', DAY, 50, 'Too many reset and setup emails today. Try again tomorrow or ask a founder.');
  await limit(env, 'mail:all', DAY, 95, 'The daily email limit has been reached. Try again tomorrow.');
}
async function issueCode(env, { purpose, user, email, data }) {
  await mailLimit(env, email, purpose);
  const id = randomId(18), code = randomDigits(6);
  await store(env).putChallenge({ id, purpose, user_id: user && user.id, email, code_hash: await codeHash(env, id, code), data, expires: Date.now() + CODE_TTL });
  try { await sendMail(env, email, codeEmail({ code, purpose, name: user && user.name })); }
  catch (e) { await store(env).dropChallenge(id); throw e; }
  return id;
}
async function checkCode(env, purpose, id, code) {
  if (typeof id !== 'string' || !/^\d{6}$/.test(String(code || '').trim())) throw new HttpError(400, 'wrong_code', 'Enter the 6-digit code from the email.');
  // Caps code guesses per email address across all of its challenges: 5 per code, 20 an hour, 40 a day.
  const pending = await store(env).getChallenge(id);
  if (pending) {
    const k = String(pending.email || '').toLowerCase();
    await limit(env, 'verify:' + k, HOUR, 20, 'Too many code attempts. Wait an hour and try again.');
    await limit(env, 'verifyday:' + k, DAY, 40, 'Too many code attempts today. Try again tomorrow or ask a founder.');
  }
  const r = await store(env).checkChallenge(id, purpose, await codeHash(env, id, String(code).trim()));
  if (r.ok) return r.challenge;
  if (r.reason === 'expired') throw new HttpError(400, 'expired', 'That code has expired. Start again to get a new one.');
  if (r.reason === 'locked') throw new HttpError(400, 'locked', 'Too many wrong codes. Start again to get a new one.');
  throw new HttpError(400, 'wrong_code', r.left > 0 ? `That code is not right. ${r.left} ${r.left === 1 ? 'try' : 'tries'} left.` : 'That code is not right.');
}
const hashPass = (serverSalt, passKey) => sha256(`${serverSalt}:${passKey}`);
async function setPassword(env, user, passKey, clientSalt, extra = {}) {
  const server_salt = randomId(16);
  return store(env).patchUser(user.id, Object.assign({ client_salt: clientSalt, server_salt, pass_hash: await hashPass(server_salt, passKey) }, extra), true);
}
const log = (env, req, kind, user, detail) => store(env).log({ kind, user_id: user && user.id, detail, ip: clientIp(req) });
function signedIn(data, cookies) {
  const h = new Headers(); cookies.filter(Boolean).forEach(c => h.append('set-cookie', c));
  return json(Object.assign({ ok: true }, data), 200, h);
}

// ---------- public auth routes ----------
export async function handleAuth(req, env, path) {
  const ip = clientIp(req);
  if (req.method === 'GET' && path === '/auth/me') {
    const s = await currentUser(req, env);
    if (!s) throw new HttpError(401, 'unauthorized', 'Sign in to continue.');
    return json(Object.assign(publicUser(s.user), { clientSalt: s.user.client_salt, aiEnabled: !!env.ANTHROPIC_API_KEY }));
  }
  if (req.method === 'GET' && path === '/auth/invite-info') {
    const token = new URL(req.url).searchParams.get('token') || '';
    const t = token && await store(env).peekToken(await sha256(token), 'invite');
    if (!t) throw new HttpError(404, 'invalid_link', 'This link has expired or was already used. Ask a founder for a new invitation.');
    return json({ email: t.email, name: t.data.name || '', role: t.data.role, roleLabel: roleOf(t.data.role).label, salt: t.data.salt });
  }
  if (req.method !== 'POST') throw new HttpError(405, 'method', 'Method not allowed.');
  const b = await body(req);

  switch (path) {
    case '/auth/prelogin': {
      await limit(env, 'pre:' + ip, 15 * MIN, 60);
      const login = lower(b.login);
      const u = login && await store(env).getUser({ login });
      const salt = u && u.status === 'active' && u.client_salt ? u.client_salt : (await hmac(secret(env), 'fake-salt:' + login)).slice(0, 22);
      return json({ salt });
    }
    case '/auth/login': {
      const login = lower(b.login);
      if (!login || !passKeyOk(b.passKey)) throw new HttpError(400, 'bad_login', 'Enter your username and password.');
      await limit(env, 'ip:' + ip, 15 * MIN, 30);
      const u = await store(env).getUser({ login });
      // A remembered device skips the per-account limits, so others cannot lock a founder out.
      const dev = await readToken(secret(env), parseCookies(req)[D_COOKIE]);
      const trusted = !!(u && dev && dev.d && dev.u === u.id && dev.v === u.sv);
      if (!trusted) {
        await limit(env, `login:${login}|${ip}`, 15 * MIN, 10, 'Too many attempts. Wait 15 minutes and try again.');
        await limit(env, 'login:' + login, 15 * MIN, 40, 'Too many attempts for this account. Wait 15 minutes and try again.');
      }
      const ok = u && u.status === 'active' && u.pass_hash && safeEqual(await hashPass(u.server_salt, b.passKey), u.pass_hash);
      if (!ok) { if (u) await log(env, req, 'login_failed', u, 'wrong password'); throw new HttpError(401, 'bad_login', 'Username or password is incorrect.'); }
      if (trusted) {
        await store(env).patchUser(u.id, { last_login: Date.now() }); await log(env, req, 'login', u, 'trusted device');
        return signedIn({ done: true }, [await sessionCookie(env, u)]);
      }
      const challenge = await issueCode(env, { purpose: 'login', user: u, email: u.email });
      return json({ ok: true, challenge, hint: maskEmail(u.email) });
    }
    case '/auth/verify': {
      await limit(env, 'ip:' + ip, 15 * MIN, 30);
      const c = await checkCode(env, 'login', b.challenge, b.code);
      const u = await loadUser(env, c.user_id, true);
      if (!u || u.status !== 'active') throw new HttpError(403, 'disabled', 'This account is not active.');
      await store(env).patchUser(u.id, { last_login: Date.now() });
      await log(env, req, 'login', u, b.remember ? 'code · device remembered' : 'code');
      return signedIn({ done: true }, [await sessionCookie(env, u), b.remember ? await deviceCookie(env, u) : cookie(D_COOKIE, '', 0)]);
    }
    case '/auth/resend': {
      await limit(env, 'ip:' + ip, 15 * MIN, 30);
      const id = str(b.challenge, 60), code = randomDigits(6);
      const pending = await store(env).getChallenge(id);
      if (pending && pending.expires > Date.now()) await mailLimit(env, pending.email, pending.purpose);
      const r = await store(env).resendChallenge(id, await codeHash(env, id, code), Date.now() + CODE_TTL);
      if (!r.ok) throw new HttpError(r.reason === 'wait' ? 429 : 400, r.reason, r.reason === 'wait' ? `Wait ${r.wait} seconds before asking again.` : r.reason === 'limit' ? 'No more resends for this attempt. Start again.' : 'This sign-in attempt has expired. Start again.');
      const c = r.challenge, u = c.user_id ? await loadUser(env, c.user_id, true) : null;
      await sendMail(env, c.email, codeEmail({ code, purpose: c.purpose, name: u && u.name }));
      return json({ ok: true });
    }
    case '/auth/logout': {
      const s = await currentUser(req, env);
      if (s && b.everywhere) { await store(env).patchUser(s.user.id, {}, true); forgetUser(s.user.id); }
      if (s) await log(env, req, 'logout', s.user, b.everywhere ? 'all devices' : '');
      const h = new Headers(); h.append('set-cookie', cookie(S_COOKIE, '', 0)); if (b.everywhere) h.append('set-cookie', cookie(D_COOKIE, '', 0));
      return json({ ok: true }, 200, h);
    }
    case '/auth/forgot': {
      await limit(env, 'forgot:' + ip, HOUR, 10);
      const login = lower(b.login);
      if (!login) throw new HttpError(400, 'bad_request', 'Enter your username or email.');
      const salt = randomId(16);
      const u = await store(env).getUser({ login });
      if (!u || u.status !== 'active') return json({ ok: true, challenge: randomId(18), salt });
      const challenge = await issueCode(env, { purpose: 'reset', user: u, email: u.email, data: { salt } });
      return json({ ok: true, challenge, salt });
    }
    case '/auth/reset': {
      await limit(env, 'ip:' + ip, 15 * MIN, 30);
      if (!passKeyOk(b.passKey)) throw new HttpError(400, 'bad_request', 'Choose a new password.');
      const c = await checkCode(env, 'reset', b.challenge, b.code);
      const u = await loadUser(env, c.user_id, true);
      if (!u || u.status !== 'active') throw new HttpError(403, 'disabled', 'This account is not active.');
      const r = await setPassword(env, u, b.passKey, c.data.salt);
      forgetUser(u.id); await log(env, req, 'password_reset', u, 'by email code');
      return signedIn({ done: true }, [await sessionCookie(env, r.user)]);
    }
    case '/auth/claim': {
      await limit(env, 'claim:' + ip, HOUR, 10);
      const email = lower(b.email);
      if (!isEmail(email)) throw new HttpError(400, 'bad_request', 'Enter a valid email address.');
      if (!founderEmails(env).includes(email)) throw new HttpError(403, 'not_founder', 'This email is not on the founders list. Ask a founder to invite you instead.');
      await limit(env, 'claim:' + email, HOUR, 5);
      const u = await store(env).getUser({ email });
      claimable(u);
      const challenge = await issueCode(env, { purpose: 'claim', email });
      return json({ ok: true, challenge, hint: maskEmail(email) });
    }
    case '/auth/claim-verify': {
      await limit(env, 'ip:' + ip, 15 * MIN, 30);
      const c = await checkCode(env, 'claim', b.challenge, b.code);
      if (!founderEmails(env).includes(String(c.email).toLowerCase())) throw new HttpError(403, 'not_founder', 'This email is no longer on the founders list.');
      const u = await store(env).getUser({ email: c.email });
      claimable(u);
      const token = randomId(32), salt = randomId(16);
      await store(env).putToken({ hash: await sha256(token), purpose: 'invite', user_id: u ? u.id : null, email: c.email, data: { role: 'founder', name: u ? u.name : '', salt }, expires: Date.now() + 30 * MIN });
      return json({ ok: true, token });
    }
    case '/auth/accept': {
      await limit(env, 'ip:' + ip, 15 * MIN, 30);
      const username = lower(b.username), name = str(b.name, 60);
      if (!usernameOk(username)) throw new HttpError(400, 'bad_username', 'Usernames are 3–32 characters: letters, numbers, dot, dash or underscore.');
      if (!passKeyOk(b.passKey)) throw new HttpError(400, 'bad_request', 'Choose a password.');
      const hash = await sha256(str(b.token, 100));
      const t = await store(env).peekToken(hash, 'invite');
      if (!t) throw new HttpError(404, 'invalid_link', 'This link has expired or was already used. Ask a founder for a new invitation.');
      const existing = await store(env).getUser({ email: t.email });
      // Links only finish setting up a new or invited account; they never revive a disabled, removed or active one.
      if (existing && (existing.status !== 'invited' || (t.user_id && t.user_id !== existing.id))) throw new HttpError(409, 'invalid_link', 'This link can no longer be used. Ask a founder for a new invitation.');
      if (t.user_id && !existing) throw new HttpError(409, 'invalid_link', 'This invitation was cancelled. Ask a founder for a new one.');
      if (await store(env).usernameTaken(username, existing && existing.id)) throw new HttpError(409, 'taken', 'That username is taken. Try another.');
      if (!await store(env).takeToken(hash, 'invite')) throw new HttpError(404, 'invalid_link', 'This link was already used.');
      const server_salt = randomId(16), pass_hash = await hashPass(server_salt, b.passKey);
      let uid;
      if (existing) {
        uid = existing.id;
        const r = await store(env).patchUser(uid, { username, name: name || existing.name, role: t.data.role || existing.role, status: 'active', client_salt: t.data.salt, server_salt, pass_hash, last_login: Date.now() }, true);
        if (!r.ok) throw new HttpError(409, 'taken', 'That username is taken. Try another.');
      } else {
        uid = randomId(12);
        const r = await store(env).insertUser({ id: uid, username, email: t.email, name: name || username, role: t.data.role || 'staff', status: 'active', client_salt: t.data.salt, server_salt, pass_hash });
        if (!r.ok) throw new HttpError(409, 'taken', 'That username or email is already in use.');
      }
      forgetUser(uid);
      const u = await loadUser(env, uid, true);
      await log(env, req, 'account_created', u, roleOf(u.role).label);
      return signedIn({ done: true }, [await sessionCookie(env, u)]);
    }
    case '/auth/password': {
      const s = await currentUser(req, env);
      if (!s) throw new HttpError(401, 'unauthorized', 'Sign in to continue.');
      await limit(env, 'pw:' + s.user.id, 15 * MIN, 8);
      if (!passKeyOk(b.currentPassKey) || !passKeyOk(b.newPassKey) || !saltOk(b.newSalt)) throw new HttpError(400, 'bad_request', 'Fill in both passwords.');
      if (!safeEqual(await hashPass(s.user.server_salt, b.currentPassKey), s.user.pass_hash)) throw new HttpError(401, 'bad_login', 'Your current password is not right.');
      const r = await setPassword(env, s.user, b.newPassKey, b.newSalt);
      forgetUser(s.user.id); await log(env, req, 'password_changed', s.user, '');
      return signedIn({}, [await sessionCookie(env, r.user)]);
    }
  }
  throw new HttpError(404, 'not_found', 'Not found.');
}

// ---------- access management (founders) ----------
export async function handleAdmin(req, env, path, sess, origin) {
  if (!roleOf(sess.user.role).admin) throw new HttpError(403, 'forbidden', 'Only founders can manage access.');
  const st = store(env);
  if (req.method === 'GET' && path === '/admin/users') {
    const [users, events, invites] = await Promise.all([st.listUsers(), st.events(80), st.pendingInvites()]);
    const inv = new Map(invites.filter(i => i.user_id).map(i => [i.user_id, i.expires]));
    return json({ users: users.map(u => Object.assign(u, { inviteExpires: inv.get(u.id) || null })), events, roles: Object.fromEntries(Object.entries(ROLES).map(([k, v]) => [k, v.label])), me: sess.user.id });
  }
  if (req.method === 'GET' && path === '/admin/status') return json(await systemStatus(env));
  if (req.method !== 'POST') throw new HttpError(405, 'method', 'Method not allowed.');
  const b = await body(req);
  const role = ROLES[b.role] ? b.role : null;

  if (path === '/admin/invite') {
    await limit(env, 'invite:' + sess.user.id, HOUR, 30);
    const email = lower(b.email), name = str(b.name, 60);
    if (!isEmail(email)) throw new HttpError(400, 'bad_request', 'Enter a valid email address.');
    if (!role) throw new HttpError(400, 'bad_request', 'Choose an access level.');
    let u = await st.getUser({ email });
    if (u && u.status === 'active') throw new HttpError(409, 'exists', `${u.name || email} already has an account.`);
    if (!u) { const id = randomId(12); const r = await st.insertUser({ id, email, name, role, status: 'invited', invited_by: sess.user.id }); if (!r.ok) throw new HttpError(409, 'exists', 'That email is already in use.'); u = await st.getUser({ id }); }
    else await st.patchUser(u.id, { name: name || u.name, role, status: 'invited', invited_by: sess.user.id });
    await limit(env, 'mail:all', DAY, 95, 'The daily email limit has been reached. Try again tomorrow.');
    const token = randomId(32);
    await st.putToken({ hash: await sha256(token), purpose: 'invite', user_id: u.id, email, data: { role, name: name || u.name, salt: randomId(16) }, expires: Date.now() + 7 * DAY });
    await sendMail(env, email, inviteEmail({ name: name || u.name, inviter: sess.user.name, link: `${origin}/invite#${token}`, role }));
    await log(env, req, 'invited', sess.user, `${email} as ${ROLES[role].label}`);
    return json({ ok: true });
  }

  const target = b.id && await st.getUser({ id: str(b.id, 40) });
  if (!target) throw new HttpError(404, 'not_found', 'That account no longer exists.');
  const self = target.id === sess.user.id;
  const lastFounder = target.role === 'founder' && target.status === 'active' && (await st.countActiveFounders()) <= 1;

  if (path === '/admin/update') {
    const patch = {};
    if (b.name !== undefined) patch.name = str(b.name, 60) || target.name;
    if (role && role !== target.role) { if (lastFounder) throw new HttpError(400, 'last_founder', 'Keep at least one active founder.'); patch.role = role; }
    if (b.status === 'disabled' || b.status === 'active') {
      if (b.status === 'disabled' && (self || lastFounder)) throw new HttpError(400, 'last_founder', self ? 'You cannot disable your own account.' : 'Keep at least one active founder.');
      if (b.status === 'active' && !target.pass_hash) throw new HttpError(400, 'bad_request', 'This person has not finished setting up. Resend the invitation instead.');
      patch.status = b.status;
    }
    const r = await st.patchUser(target.id, patch, !!(patch.role || patch.status));
    if (patch.status === 'disabled') await st.dropPending(target.email);
    forgetUser(target.id);
    await log(env, req, 'access_changed', sess.user, `${target.email}: ${Object.entries(patch).map(([k, v]) => `${k} → ${v}`).join(', ')}`);
    return json({ ok: true, user: r.user && { id: r.user.id, role: r.user.role, status: r.user.status, name: r.user.name } });
  }
  if (path === '/admin/signout') {
    await st.patchUser(target.id, {}, true); forgetUser(target.id);
    await log(env, req, 'signed_out', sess.user, `${target.email} on all devices`);
    return json({ ok: true });
  }
  if (path === '/admin/remove') {
    if (self || lastFounder) throw new HttpError(400, 'last_founder', self ? 'You cannot remove your own account.' : 'Keep at least one active founder.');
    await st.removeUser(target.id); await st.dropPending(target.email); forgetUser(target.id);
    await log(env, req, 'removed', sess.user, target.email);
    return json({ ok: true });
  }
  throw new HttpError(404, 'not_found', 'Not found.');
}

async function systemStatus(env) {
  const out = [];
  const add = (key, label, ok, note) => out.push({ key, label, ok, note });
  add('secret', 'Session secret', !!(env.SESSION_SECRET && env.SESSION_SECRET.length >= 24), env.SESSION_SECRET ? '' : 'Add SESSION_SECRET.');
  add('founders', 'Founder emails', founderEmails(env).length > 0, founderEmails(env).length ? `${founderEmails(env).length} listed` : 'Add FOUNDER_EMAILS.');
  add('mail', 'Email codes', !!(env.MAIL_URL && env.MAIL_KEY), env.MAIL_URL ? 'Relay configured' : 'Add MAIL_URL and MAIL_KEY.');
  try {
    const { notionPing } = await import('./notion.js');
    const who = await notionPing(env); add('notion', 'Notion', true, who);
  } catch (e) { add('notion', 'Notion', false, e.message); }
  try {
    const { drivePing } = await import('./drive.js');
    const n = await drivePing(env); add('drive', 'Google Drive', true, n);
  } catch (e) { add('drive', 'Google Drive', false, e.message); }
  add('ai', 'AI answers', !!env.ANTHROPIC_API_KEY, env.ANTHROPIC_API_KEY ? 'Anthropic API key set' : 'Optional: add ANTHROPIC_API_KEY to turn on AI briefs and search answers.');
  return { checks: out };
}
