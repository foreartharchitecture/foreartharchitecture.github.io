// Sign-in, first-time founder setup, invitations and password reset.
(() => {
'use strict';
const $ = s => document.querySelector(s);
const enc = new TextEncoder();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const MIN_PW = 10;
// Whether emailed codes are switched on (they are once the firm's Gmail sender is connected).
let CFG = { mail: true, setup: false };
const loadCfg = fetch('/auth/config', { credentials: 'same-origin' }).then(r => r.json()).then(c => { CFG = c; }).catch(() => {});

// The password never leaves the device: it is stretched with PBKDF2 and only the result is sent.
async function passKey(password, salt) {
  const km = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('forearth-studio:' + salt), iterations: 210000 }, km, 256);
  return b64url(bits);
}
async function post(path, data) {
  let res, out;
  try {
    res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(data || {}) });
    out = await res.json().catch(() => ({}));
  } catch (e) { throw { message: 'No connection. Check your internet and try again.' }; }
  if (!res.ok) throw { code: out.error, message: out.message || 'Something went wrong. Try again.' };
  return out;
}

const msg = (text, kind) => { const m = $('#msg'); m.hidden = !text; m.className = 'msg' + (kind ? ' ' + kind : ''); m.textContent = text || ''; };
function head(title, lead, sheet, step, total) {
  $('#h').textContent = title; $('#lead').textContent = lead; $('#sheet').textContent = sheet;
  $('#steps').innerHTML = total ? Array.from({ length: total }, (_, i) => `<i class="${i < step ? 'on' : ''}"></i>`).join('') : '';
  document.title = `${title} · Forearth Studio`;
}
function view(html) { $('#view').innerHTML = html; msg(''); const f = $('#view input:not([type=checkbox])'); if (f) setTimeout(() => f.focus(), 30); }
const pwField = (id, label, auto) => `<div class="f"><label for="${id}">${label}</label><div class="pw"><input id="${id}" type="password" autocomplete="${auto}" required minlength="${auto === 'new-password' ? MIN_PW : 1}"><button type="button" data-toggle="${id}">Show</button></div></div>`;
const codeField = `<div class="f"><label for="code">6-digit code</label><input id="code" class="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></div>`;
document.addEventListener('click', e => { const t = e.target.closest('[data-toggle]'); if (!t) return; const i = document.getElementById(t.dataset.toggle); i.type = i.type === 'password' ? 'text' : 'password'; t.textContent = i.type === 'password' ? 'Show' : 'Hide'; });
document.addEventListener('input', e => { if (e.target.id === 'code') { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); if (e.target.value.length === 6 && e.target.form && !e.target.form.querySelector('input[type=password]')) e.target.form.requestSubmit(); } });

async function busy(form, fn) {
  const btn = form.querySelector('button[type=submit]'), label = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '<span class="spin" aria-hidden="true"></span>Please wait';
  try { await fn(); } catch (e) { msg(e.message || 'Something went wrong.', 'bad'); }
  finally { if (document.body.contains(btn)) { btn.disabled = false; btn.innerHTML = label; } }
}
function newPasswords() {
  const a = $('#pw1').value, b = $('#pw2').value;
  if (a.length < MIN_PW) throw { message: `Use at least ${MIN_PW} characters.` };
  if (a !== b) throw { message: 'The two passwords do not match.' };
  return a;
}
const done = () => { msg('Signed in. Opening the dashboard…', 'good'); setTimeout(() => location.replace('/'), 350); };
function resendLink(challenge) {
  const b = $('#resend'); if (!b) return;
  let left = 30; b.disabled = true;
  const tick = () => { b.textContent = left > 0 ? `Resend code (${left}s)` : 'Resend code'; if (left-- > 0) setTimeout(tick, 1000); else b.disabled = false; };
  tick();
  b.onclick = async () => { try { await post('/auth/resend', { challenge }); msg('A new code is on its way.', 'good'); resendLink(challenge); } catch (e) { msg(e.message, 'bad'); } };
}

// ---------- sign in ----------
function signIn() {
  head('Sign in', 'Use your Forearth Studio username and password.', 'A-01', 0, 0);
  view(`<form id="f" novalidate>
    <div class="f"><label for="login">Username or email</label><input id="login" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required></div>
    ${pwField('pw', 'Password', 'current-password')}
    <button class="btn" type="submit">Continue</button>
  </form>
  <div class="links"><a href="/reset">Forgot password?</a><a href="/setup">Founder first-time setup</a></div>`);
  const last = localStorage.getItem('fs-last-login'); if (last) { $('#login').value = last; setTimeout(() => $('#pw').focus(), 40); }
  $('#f').onsubmit = e => { e.preventDefault(); busy(e.target, async () => {
    const login = $('#login').value.trim().toLowerCase(), pw = $('#pw').value;
    if (!login || !pw) throw { message: 'Enter your username and password.' };
    const { salt } = await post('/auth/prelogin', { login });
    const r = await post('/auth/login', { login, passKey: await passKey(pw, salt) });
    try { localStorage.setItem('fs-last-login', login); } catch (x) {}
    if (r.done) return done();
    codeStep(r.challenge, r.hint);
  }); };
}
function codeStep(challenge, hint) {
  head('Check your email', `We sent a 6-digit code to ${hint}. It expires in 10 minutes.`, 'A-02', 0, 0);
  view(`<form id="f" novalidate>
    ${codeField}
    <label class="chk"><input type="checkbox" id="remember" checked> Remember this device for 30 days</label>
    <button class="btn" type="submit">Verify and sign in</button>
    <div class="row"><button type="button" class="link" id="resend">Resend code</button><button type="button" class="link" id="back">Start over</button></div>
  </form>
  <p class="hint" style="margin:14px 0 0">On a shared computer, untick “Remember this device”.</p>`);
  resendLink(challenge);
  $('#back').onclick = signIn;
  $('#f').onsubmit = e => { e.preventDefault(); busy(e.target, async () => {
    await post('/auth/verify', { challenge, code: $('#code').value, remember: $('#remember').checked });
    done();
  }); };
}

// ---------- forgot password ----------
function reset() {
  if (!CFG.mail) {
    head('Reset password', 'Ask a founder to open Manage access and send you a password reset link. Founders can also reset their own password with Founder setup and the setup code.', 'R-01', 0, 0);
    view('<div class="links"><a href="/login">Back to sign in</a><a href="/setup">Founder setup</a></div>');
    return;
  }
  head('Reset password', 'Enter your username or email. We will email you a code to set a new password.', 'R-01', 1, 2);
  view(`<form id="f" novalidate>
    <div class="f"><label for="login">Username or email</label><input id="login" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required></div>
    <button class="btn" type="submit">Email me a code</button>
  </form><div class="links"><a href="/login">Back to sign in</a></div>`);
  $('#f').onsubmit = e => { e.preventDefault(); busy(e.target, async () => {
    const login = $('#login').value.trim().toLowerCase();
    if (!login) throw { message: 'Enter your username or email.' };
    const r = await post('/auth/forgot', { login });
    resetStep(r.challenge, r.salt);
  }); };
}
function resetStep(challenge, salt) {
  head('Choose a new password', 'If that account exists, a code is on its way to its email address.', 'R-02', 2, 2);
  view(`<form id="f" novalidate>
    ${codeField}
    ${pwField('pw1', `New password <span class="hint">(at least ${MIN_PW} characters)</span>`, 'new-password')}
    ${pwField('pw2', 'Repeat new password', 'new-password')}
    <button class="btn" type="submit">Save and sign in</button>
    <div class="row"><button type="button" class="link" id="resend">Resend code</button><a href="/login">Cancel</a></div>
  </form>`);
  resendLink(challenge);
  $('#f').onsubmit = e => { e.preventDefault(); busy(e.target, async () => {
    const pw = newPasswords();
    await post('/auth/reset', { challenge, code: $('#code').value, passKey: await passKey(pw, salt) });
    done();
  }); };
}

// ---------- founder first-time setup ----------
function setup() {
  if (!CFG.mail) {
    head('Founder setup', 'Founders create their account here with the setup code saved in Cloudflare. A founder who forgot their password can reset it here too. Staff are invited by a founder.', 'S-01', 1, 2);
    view(`<form id="f" novalidate>
      <div class="f"><label for="email">Your founder email</label><input id="email" type="email" autocomplete="email" autocapitalize="none" spellcheck="false" required></div>
      ${pwField('scode', 'Setup code', 'off')}
      <button class="btn" type="submit">Continue</button>
    </form><div class="links"><a href="/login">Back to sign in</a></div>`);
    $('#f').onsubmit = e => { e.preventDefault(); busy(e.target, async () => {
      const email = $('#email').value.trim().toLowerCase(), setupCode = $('#scode').value.trim();
      if (!email || !setupCode) throw { message: 'Enter your founder email and the setup code.' };
      const r = await post('/auth/claim', { email, setupCode });
      await account(r.token, 2, 2);
    }); };
    return;
  }
  head('Founder setup', 'Founders listed by the firm can create their own account here. Staff are invited by a founder.', 'S-01', 1, 3);
  view(`<form id="f" novalidate>
    <div class="f"><label for="email">Your founder email</label><input id="email" type="email" autocomplete="email" autocapitalize="none" spellcheck="false" required></div>
    <button class="btn" type="submit">Email me a code</button>
  </form><div class="links"><a href="/login">Back to sign in</a></div>`);
  $('#f').onsubmit = e => { e.preventDefault(); busy(e.target, async () => {
    const email = $('#email').value.trim().toLowerCase();
    const r = await post('/auth/claim', { email });
    head('Check your email', `We sent a 6-digit code to ${r.hint}.`, 'S-02', 2, 3);
    view(`<form id="f2" novalidate>${codeField}<button class="btn" type="submit">Verify</button>
      <div class="row"><button type="button" class="link" id="resend">Resend code</button><a href="/setup">Start over</a></div></form>`);
    resendLink(r.challenge);
    $('#f2').onsubmit = ev => { ev.preventDefault(); busy(ev.target, async () => {
      const v = await post('/auth/claim-verify', { challenge: r.challenge, code: $('#code').value });
      await account(v.token, 3, 3);
    }); };
  }); };
}

// ---------- invitation / account creation ----------
async function account(token, step, total) {
  let info;
  try { const res = await fetch('/auth/invite-info?token=' + encodeURIComponent(token)); info = await res.json(); if (!res.ok) throw info; }
  catch (e) { head('Link not valid', e.message || 'This link has expired or was already used. Ask a founder for a new invitation.', 'I-00', 0, 0); view('<div class="links"><a href="/login">Go to sign in</a></div>'); return; }
  if (info.reset) head('Choose a new password', `${info.email} · ${info.roleLabel} access. Keep or change your username, then set a new password.`, 'I-01', step || 1, total || 1);
  else head(info.name ? `Welcome, ${info.name.split(' ')[0]}` : 'Create your account', `${info.email} · ${info.roleLabel} access. Choose how you will sign in.`, 'I-01', step || 1, total || 1);
  view(`<form id="f" novalidate>
    <div class="f"><label for="name">Your name</label><input id="name" type="text" autocomplete="name" value="${esc(info.name)}" required></div>
    <div class="f"><label for="username">Username</label><input id="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required>
      <span class="hint">3–32 characters: letters, numbers, dot, dash or underscore.</span></div>
    ${pwField('pw1', `Password <span class="hint">(at least ${MIN_PW} characters)</span>`, 'new-password')}
    ${pwField('pw2', 'Repeat password', 'new-password')}
    <button class="btn" type="submit">${info.reset ? 'Save and sign in' : 'Create account and sign in'}</button>
  </form>`);
  if (info.username) $('#username').value = info.username;
  if (!$('#username').value && info.email) $('#username').value = info.email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 32);
  $('#f').onsubmit = e => { e.preventDefault(); busy(e.target, async () => {
    const username = $('#username').value.trim().toLowerCase(), name = $('#name').value.trim();
    if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) throw { message: 'Usernames are 3–32 characters: letters, numbers, dot, dash or underscore.' };
    const pw = newPasswords();
    await post('/auth/accept', { token, username, name, passKey: await passKey(pw, info.salt) });
    try { localStorage.setItem('fs-last-login', username); } catch (x) {}
    done();
  }); };
}

const p = location.pathname;
loadCfg.then(() => {
if (p === '/setup') setup();
else if (p === '/reset') reset();
else if (p === '/invite') { const t = location.hash.slice(1); history.replaceState(null, '', '/invite'); if (t) account(t); else { head('Link not valid', 'Open the invitation link from your email again.', 'I-00', 0, 0); view('<div class="links"><a href="/login">Go to sign in</a></div>'); } }
else signIn();
});
// Reaching this page means there is no active session here: clear any dashboard data left on the device.
try { indexedDB.deleteDatabase('forearth-studio'); } catch (e) {}
try { if (window.caches) caches.keys().then(ks => ks.filter(k => k.startsWith('fs-shell')).forEach(k => caches.open(k).then(c => c.delete('/')))); } catch (e) {}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
