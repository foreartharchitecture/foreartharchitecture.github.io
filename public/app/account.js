// Account menu, access management for founders, password change and app installation.
(() => {
'use strict';
const FE = window.FE_USER, FS = window.FS;
if (!FE || !FS) return;
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enc = new TextEncoder();
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const initials = n => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
const when = t => { if (!t) return '—'; const d = new Date(t); return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; });
window.addEventListener('appinstalled', () => { installEvt = null; note('Forearth Studio is installed.'); });

async function passKey(password, salt) {
  const km = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  return b64url(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('forearth-studio:' + salt), iterations: 210000 }, km, 256));
}
function note(text, bad) {
  const box = $('#toasts'); if (!box) return;
  const el = document.createElement('div'); el.className = 'toast' + (bad ? ' bad' : ''); el.setAttribute('role', 'status');
  el.appendChild(Object.assign(document.createElement('span'), { textContent: text })); box.appendChild(el);
  setTimeout(() => el.remove(), bad ? 8000 : 5000);
}
async function api(path, data) {
  const res = data === undefined ? await FS.request(path) : await FS.postJSON(path, data);
  return res.json();
}

// ---------- styles ----------
const css = `
.acct{padding:0 6px 0 4px!important;gap:8px!important}
.acct .av{width:24px;height:24px;border-radius:50%;background:var(--inv-bg);color:var(--inv-fg);display:grid;place-items:center;font:700 10.5px/1 var(--f-display);letter-spacing:.04em}
.acct .nm{max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.amenu{position:fixed;z-index:60;min-width:250px;max-width:calc(100vw - 24px);background:var(--sheet);border:1px solid var(--rule-2);border-radius:6px;box-shadow:var(--shadow);padding:6px;animation:rise .14s ease}
.amenu .who{padding:10px 10px 12px;border-bottom:1px solid var(--rule);margin-bottom:6px}
.amenu .who b{display:block;font-size:14px}
.amenu .who span{display:block;font-size:12px;color:var(--ink-3);overflow-wrap:anywhere}
.amenu .role{display:inline-block;margin-top:6px;font:600 10px/1 var(--f-display);font-stretch:112%;letter-spacing:.12em;text-transform:uppercase;border:1px solid var(--rule-2);border-radius:3px;padding:4px 6px;color:var(--ink-2)}
.amenu button{display:flex;width:100%;align-items:center;gap:10px;text-align:left;border:0;background:none;padding:9px 10px;border-radius:4px;font-size:13.5px}
.amenu button:hover{background:var(--sheet-2)}
.amenu button svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.6;flex:none;color:var(--ink-3)}
.amenu hr{border:0;border-top:1px solid var(--rule);margin:6px 0}
.amodal{position:fixed;inset:0;z-index:62;display:grid;place-items:center;padding:16px;background:var(--scrim);animation:fade .15s ease}
.apanel{width:min(760px,100%);max-height:min(88vh,860px);display:flex;flex-direction:column;background:var(--sheet);border:1px solid var(--rule-2);border-radius:6px;box-shadow:var(--shadow);overflow:hidden}
.apanel.sm{width:min(440px,100%)}
.ap-h{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid var(--rule-2)}
.ap-h h2{margin:0;font:650 17px/1.2 var(--f-display);font-stretch:108%}
.ap-tabs{display:flex;gap:4px;padding:8px 12px 0;border-bottom:1px solid var(--rule)}
.ap-tabs button{border:0;background:none;padding:8px 10px 10px;font-size:13px;color:var(--ink-3);border-bottom:2px solid transparent;margin-bottom:-1px}
.ap-tabs button[aria-selected=true]{color:var(--ink);border-bottom-color:var(--ink)}
.ap-b{padding:16px;overflow:auto;display:grid;gap:16px;align-content:start}
.ap-card{border:1px solid var(--rule);border-radius:4px;background:var(--sheet-2)}
.ap-card h3{margin:0;padding:10px 12px;border-bottom:1px solid var(--rule);font:600 10.5px/1.2 var(--f-display);font-stretch:112%;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3)}
.ap-inv{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr) 130px auto;gap:8px;padding:12px;align-items:end}
.ap-f{display:grid;gap:4px;min-width:0}
.ap-f label{font-size:12px;color:var(--ink-3)}
.ap-f input,.ap-f select,.urow select{height:34px;border:1px solid var(--rule-2);background:var(--sheet);border-radius:4px;padding:0 9px;min-width:0;width:100%}
.urow{display:grid;grid-template-columns:32px minmax(0,1fr) 120px auto;gap:10px;align-items:center;padding:10px 12px;border-top:1px solid var(--rule)}
.urow:first-of-type{border-top:0}
.urow .av{width:30px;height:30px;border-radius:50%;background:var(--sheet-3);display:grid;place-items:center;font:700 11px/1 var(--f-display)}
.urow b{display:block;font-size:13.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.urow small{display:block;font-size:12px;color:var(--ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pill{display:inline-block;font:600 9.5px/1 var(--f-display);font-stretch:112%;letter-spacing:.1em;text-transform:uppercase;border-radius:3px;padding:3px 5px;margin-left:6px;vertical-align:1px;border:1px solid var(--rule-2);color:var(--ink-3)}
.pill.warn{color:var(--warn-ink);border-color:color-mix(in oklab,var(--warn) 50%,var(--rule-2))}
.pill.off{color:var(--crit-ink);border-color:color-mix(in oklab,var(--crit) 50%,var(--rule-2))}
.uacts{display:flex;gap:4px;justify-content:flex-end;flex-wrap:wrap}
.ev{display:grid;grid-template-columns:120px minmax(0,1fr);gap:10px;padding:8px 12px;border-top:1px solid var(--rule);font-size:12.5px}
.ev:first-of-type{border-top:0}
.ev time{font-family:var(--f-mono);color:var(--ink-3);font-size:11.5px}
.chk-row{display:grid;grid-template-columns:22px minmax(0,1fr);gap:10px;padding:10px 12px;border-top:1px solid var(--rule);font-size:13px}
.chk-row:first-of-type{border-top:0}
.chk-row i{width:18px;height:18px;border-radius:50%;display:grid;place-items:center;font-style:normal;font-size:11px;font-weight:700;margin-top:1px}
.chk-row i.ok{background:color-mix(in oklab,var(--good) 25%,transparent);color:var(--good-ink)}
.chk-row i.no{background:color-mix(in oklab,var(--crit) 25%,transparent);color:var(--crit-ink)}
.chk-row small{display:block;color:var(--ink-3);font-size:12px;overflow-wrap:anywhere}
.ap-form{display:grid;gap:12px}
.ap-form .btn{height:38px;justify-content:center}
.ap-msg{font-size:13px;padding:9px 11px;border-radius:4px;border:1px solid var(--rule-2)}
.ap-msg.bad{color:var(--crit-ink);border-color:color-mix(in oklab,var(--crit) 45%,var(--rule-2))}
.ios-steps{margin:0;padding:0 0 0 20px;display:grid;gap:10px;font-size:14px}
.ios-steps svg{width:18px;height:18px;vertical-align:-4px;stroke:currentColor;fill:none;stroke-width:1.7}
@media (max-width:720px){
  .acct .nm{display:none}
  .ap-inv{grid-template-columns:1fr 1fr}
  .ap-inv .btn{grid-column:1/-1}
  .urow{grid-template-columns:30px minmax(0,1fr);row-gap:8px}
  .urow select,.urow .uacts{grid-column:2/3}
  .uacts{justify-content:flex-start}
  .amodal{padding:0;place-items:end stretch}
  .apanel{max-height:92vh;border-radius:10px 10px 0 0;width:100%}
  .ev{grid-template-columns:1fr}
}`;
document.head.appendChild(Object.assign(document.createElement('style'), { textContent: css }));

const I = {
  users: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.8c1.7.8 2.8 2.5 3 5.2"/></svg>',
  key: '<svg viewBox="0 0 24 24"><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3M14 9l2 2"/></svg>',
  install: '<svg viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v3h16v-3"/></svg>',
  out: '<svg viewBox="0 0 24 24"><path d="M14 4h5v16h-5"/><path d="M10 8l-4 4 4 4M6 12h10"/></svg>',
  all: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="12" height="9" rx="1"/><rect x="15" y="9" width="6" height="11" rx="1"/><path d="M6 18h6"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M12 15V3M8 7l4-4 4 4"/><path d="M5 11v9h14v-9"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/></svg>'
};

// ---------- account button & menu ----------
const end = $('.tb-end');
const btn = document.createElement('button');
btn.className = 'ibtn acct'; btn.type = 'button'; btn.setAttribute('aria-haspopup', 'menu'); btn.setAttribute('aria-label', `Account: ${FE.user.name}`);
btn.innerHTML = `<span class="av">${esc(initials(FE.user.name))}</span><span class="nm">${esc(FE.user.name)}</span>`;
if (end) end.appendChild(btn);

let menu = null;
function closeMenu() { if (menu) { menu.remove(); menu = null; btn.setAttribute('aria-expanded', 'false'); } }
btn.addEventListener('click', e => {
  e.stopPropagation();
  if (menu) return closeMenu();
  const canInstall = !standalone() && (installEvt || isIOS);
  menu = document.createElement('div'); menu.className = 'amenu'; menu.setAttribute('role', 'menu');
  menu.innerHTML = `<div class="who"><b>${esc(FE.user.name)}</b><span>${esc(FE.user.username)} · ${esc(FE.user.email)}</span><span class="role">${esc(FE.user.roleLabel)} access</span></div>
    ${FE.perms.admin ? `<button role="menuitem" data-a="access">${I.users}Manage access</button>` : ''}
    ${canInstall ? `<button role="menuitem" data-a="install">${I.install}Install app on this device</button>` : ''}
    <button role="menuitem" data-a="password">${I.key}Change password</button>
    <hr><button role="menuitem" data-a="out">${I.out}Sign out</button>
    <button role="menuitem" data-a="outall">${I.all}Sign out on all devices</button>`;
  document.body.appendChild(menu);
  const r = btn.getBoundingClientRect(), w = menu.offsetWidth;
  menu.style.top = Math.round(r.bottom + 6) + 'px';
  menu.style.left = Math.round(Math.max(12, Math.min(innerWidth - w - 12, r.right - w))) + 'px';
  btn.setAttribute('aria-expanded', 'true');
  menu.querySelector('button').focus();
  menu.addEventListener('click', ev => {
    const a = ev.target.closest('[data-a]'); if (!a) return;
    closeMenu();
    ({ access: openAccess, install: doInstall, password: openPassword, out: () => FS.signOut(false), outall: () => { if (confirmBox('Sign out on all devices?', 'Every phone and computer signed in to your account will need to sign in again.')) FS.signOut(true); } })[a.dataset.a]();
  });
});
document.addEventListener('click', e => { if (menu && !menu.contains(e.target)) closeMenu(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeMenu(); closeModal(); } });
const confirmBox = (title, text) => window.confirm(`${title}\n\n${text}`);

// ---------- modal helper ----------
let modal = null;
function openModal(title, body, small) {
  closeModal();
  modal = document.createElement('div'); modal.className = 'amodal';
  modal.innerHTML = `<div class="apanel${small ? ' sm' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="ap-h"><h2>${esc(title)}</h2><button class="btn ghost" data-close aria-label="Close">Close</button></div>${body}</div>`;
  modal.addEventListener('click', e => { if (e.target === modal || e.target.closest('[data-close]')) closeModal(); });
  document.body.appendChild(modal);
  return modal;
}
function closeModal() { if (modal) { modal.remove(); modal = null; } }

// ---------- install ----------
async function doInstall() {
  if (installEvt) { installEvt.prompt(); const r = await installEvt.userChoice.catch(() => null); installEvt = null; if (r && r.outcome === 'accepted') note('Installing Forearth Studio…'); return; }
  openModal('Install on iPhone or iPad', `<div class="ap-b"><ol class="ios-steps">
    <li>Open this page in <b>Safari</b>.</li>
    <li>Tap the <b>Share</b> button ${I.share} in the toolbar.</li>
    <li>Scroll down and tap <b>Add to Home Screen</b> ${I.plus}.</li>
    <li>Tap <b>Add</b>. Open Forearth from your Home Screen; it runs full-screen like an app.</li></ol>
    <p class="hint" style="margin:0">You stay signed in on that device for up to 14 days of inactivity.</p></div>`, true);
}

// ---------- change password ----------
function openPassword() {
  const m = openModal('Change password', `<form class="ap-b ap-form" id="pwf" novalidate>
    <div class="ap-f"><label for="pw0">Current password</label><input id="pw0" type="password" autocomplete="current-password" required></div>
    <div class="ap-f"><label for="pw1">New password (at least 10 characters)</label><input id="pw1" type="password" autocomplete="new-password" required></div>
    <div class="ap-f"><label for="pw2">Repeat new password</label><input id="pw2" type="password" autocomplete="new-password" required></div>
    <div class="ap-msg bad" id="pwm" hidden></div>
    <button class="btn primary" type="submit">Save new password</button>
    <p class="hint" style="margin:0">Other devices will be signed out.</p></form>`, true);
  $('#pw0', m).focus();
  $('#pwf', m).addEventListener('submit', async e => {
    e.preventDefault();
    const b = e.target.querySelector('button[type=submit]'), msg = $('#pwm', m);
    const [a, n1, n2] = ['#pw0', '#pw1', '#pw2'].map(s => $(s, m).value);
    const fail = t => { msg.hidden = false; msg.textContent = t; };
    if (n1.length < 10) return fail('Use at least 10 characters.');
    if (n1 !== n2) return fail('The new passwords do not match.');
    b.disabled = true; b.textContent = 'Saving…';
    try {
      const me = await api('/auth/me');
      const salt = b64url(crypto.getRandomValues(new Uint8Array(16)));
      await api('/auth/password', { currentPassKey: await passKey(a, me.clientSalt), newPassKey: await passKey(n1, salt), newSalt: salt });
      closeModal(); note('Password changed. Other devices have been signed out.');
    } catch (err) { fail(err.message || 'Could not change the password.'); b.disabled = false; b.textContent = 'Save new password'; }
  });
}

// ---------- access management (founders) ----------
const EV = { login: 'Signed in', login_failed: 'Failed sign-in', logout: 'Signed out', password_reset: 'Reset password', password_changed: 'Changed password',
  account_created: 'Created account', invited: 'Sent invitation', access_changed: 'Changed access', signed_out: 'Signed someone out', removed: 'Removed account', reset_link: 'Made a password reset link', setup_failed: 'Wrong setup code' };
let tab = 'people', data = null, shared = null;
async function openAccess() {
  openModal('Access', `<div class="ap-tabs" role="tablist">${[['people', 'People'], ['activity', 'Activity'], ['system', 'System status']].map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${tab === k}">${l}</button>`).join('')}</div><div class="ap-b" id="apb"><div class="hint">Loading…</div></div>`);
  modal.addEventListener('click', e => { const t = e.target.closest('[data-tab]'); if (t) { tab = t.dataset.tab; modal.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b === t))); paint(); } });
  await load(); paint();
}
async function load() { try { data = await api('/admin/users'); } catch (e) { data = { error: e.message }; } }
async function paint() {
  const box = modal && $('#apb', modal); if (!box) return;
  if (data && data.error) { box.innerHTML = `<div class="ap-msg bad">${esc(data.error)}</div>`; return; }
  if (tab === 'people') return paintPeople(box);
  if (tab === 'activity') {
    const names = new Map((data.users || []).map(u => [u.id, u.name || u.username || u.email]));
    box.innerHTML = `<div class="ap-card"><h3>Recent sign-ins and changes</h3>${(data.events || []).map(e => `<div class="ev"><time>${esc(when(e.t))}</time><div><b>${esc(names.get(e.user_id) || 'Someone')}</b> · ${esc(EV[e.kind] || e.kind)}${e.detail ? ` <span class="hint">· ${esc(e.detail)}</span>` : ''}</div></div>`).join('') || '<div class="ev"><div class="hint">No activity yet.</div></div>'}</div>`;
    return;
  }
  box.innerHTML = '<div class="hint">Checking connections…</div>';
  try {
    const s = await api('/admin/status');
    box.innerHTML = `<div class="ap-card"><h3>Connections</h3>${s.checks.map(c => `<div class="chk-row"><i class="${c.ok ? 'ok' : 'no'}">${c.ok ? '✓' : '!'}</i><div><b>${esc(c.label)}</b><small>${esc(c.note || (c.ok ? 'OK' : 'Not set up'))}</small></div></div>`).join('')}</div>
      <p class="hint" style="margin:0">Secrets are managed in Cloudflare → Workers &amp; Pages → forearth-studio → Settings → Variables and Secrets.</p>`;
  } catch (e) { box.innerHTML = `<div class="ap-msg bad">${esc(e.message)}</div>`; }
}
function paintPeople(box) {
  const roles = data.roles || { founder: 'Founder', staff: 'Staff' };
  const opts = sel => Object.entries(roles).map(([k, l]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${esc(l)}</option>`).join('');
  const rows = (data.users || []).map(u => {
    const me = u.id === data.me;
    const state = u.status === 'invited' ? `<span class="pill warn">Invited</span>` : u.status === 'disabled' ? `<span class="pill off">Disabled</span>` : '';
    const sub = u.status === 'invited' ? `Invitation ${u.inviteExpires ? 'expires ' + when(u.inviteExpires) : 'expired'}` : `${u.username || ''} · ${u.email} · last sign-in ${when(u.last_login)}`;
    const acts = me ? '<span class="hint">You</span>'
      : u.status === 'invited' ? `<button class="btn" data-u="resend" data-id="${u.id}">Resend invite</button><button class="btn ghost" data-u="remove" data-id="${u.id}">Cancel</button>`
      : `${u.status === 'active' ? `<button class="btn" data-u="reset" data-id="${u.id}" title="Make a link to choose a new password">Reset password</button><button class="btn" data-u="signout" data-id="${u.id}" title="Sign this person out everywhere">Sign out</button><button class="btn" data-u="disable" data-id="${u.id}">Disable</button>` : `<button class="btn" data-u="enable" data-id="${u.id}">Enable</button><button class="btn ghost" data-u="remove" data-id="${u.id}">Remove</button>`}`;
    return `<div class="urow"><span class="av">${esc(initials(u.name || u.email))}</span><div><b>${esc(u.name || u.email)}${state}</b><small>${esc(sub)}</small></div>
      <select data-role="${u.id}" aria-label="Access level for ${esc(u.name || u.email)}"${me ? ' disabled' : ''}>${opts(u.role)}</select><div class="uacts">${acts}</div></div>`;
  }).join('');
  const linkBox = shared ? `<div class="ap-card"><h3>${esc(shared.title)}</h3><div style="padding:12px;display:grid;gap:8px">
      <p class="hint" style="margin:0">${esc(shared.text)}</p>
      <div style="display:flex;gap:8px"><input id="share-link" readonly value="${esc(shared.link)}" style="flex:1;min-width:0;height:34px;border:1px solid var(--rule-2);background:var(--sheet);border-radius:4px;padding:0 9px;font-family:var(--f-mono);font-size:12px">
      <button class="btn primary" type="button" id="share-copy">Copy link</button><button class="btn ghost" type="button" id="share-close">Hide</button></div></div></div>` : '';
  box.innerHTML = linkBox + `<form class="ap-card" id="invf" novalidate><h3>Invite someone</h3><div class="ap-inv">
      <div class="ap-f"><label for="inv-n">Name</label><input id="inv-n" autocomplete="off" required></div>
      <div class="ap-f"><label for="inv-e">Email</label><input id="inv-e" type="email" autocomplete="off" required></div>
      <div class="ap-f"><label for="inv-r">Access</label><select id="inv-r">${opts('staff')}</select></div>
      <button class="btn primary" type="submit">Send invitation</button></div></form>
    <div class="ap-card"><h3>People with access</h3>${rows || '<div class="urow"><div class="hint">No accounts yet.</div></div>'}</div>
    <p class="hint" style="margin:0"><b>Founder</b>: everything, including CRM, Sales, Finance, HR and editing Notion. <b>Staff</b>: read-only Studio pages (projects, tasks, calendar and project files).</p>`;
  $('#invf', box).addEventListener('submit', async e => {
    e.preventDefault();
    const b = e.target.querySelector('button[type=submit]');
    const email = $('#inv-e', box).value.trim(), name = $('#inv-n', box).value.trim(), role = $('#inv-r', box).value;
    if (!name || !email) return note('Enter a name and email.', true);
    b.disabled = true; b.textContent = 'Sending…';
    try { const r = await api('/admin/invite', { email, name, role }); share(r, `Invitation link for ${name}`, name); await load(); paint(); }
    catch (err) { note(err.message, true); b.disabled = false; b.textContent = 'Send invitation'; }
  });
  box.querySelectorAll('select[data-role]').forEach(s => s.addEventListener('change', async () => {
    const u = data.users.find(x => x.id === s.dataset.role);
    try {
      if (u.status === 'invited') await api('/admin/invite', { email: u.email, name: u.name, role: s.value });
      else await api('/admin/update', { id: u.id, role: s.value });
      note(`${u.name || u.email} now has ${roles[s.value]} access.`); await load(); paint();
    } catch (err) { note(err.message, true); s.value = u.role; }
  }));
  box.querySelectorAll('[data-u]').forEach(b => b.addEventListener('click', async () => {
    const u = data.users.find(x => x.id === b.dataset.id), who = u.name || u.email, a = b.dataset.u;
    const ask = { disable: [`Disable ${who}?`, 'They will be signed out and cannot sign in until enabled again.'], remove: [`Remove ${who}?`, 'Their account will be deleted. You can invite them again later.'], signout: [`Sign ${who} out everywhere?`, 'They will need to sign in again on every device.'] }[a];
    if (ask && !confirmBox(ask[0], ask[1])) return;
    b.disabled = true;
    try {
      if (a === 'resend') { share(await api('/admin/invite', { email: u.email, name: u.name, role: u.role }), `Invitation link for ${who}`, who); await load(); paint(); return; }
      if (a === 'reset') { share(await api('/admin/reset-link', { id: u.id }), `Password reset link for ${who}`, who); paint(); return; }
      else if (a === 'remove') await api('/admin/remove', { id: u.id });
      else if (a === 'signout') await api('/admin/signout', { id: u.id });
      else await api('/admin/update', { id: u.id, status: a === 'disable' ? 'disabled' : 'active' });
      note({ resend: `Invitation sent again to ${u.email}.`, remove: `${who} removed.`, signout: `${who} signed out on all devices.`, disable: `${who} disabled.`, enable: `${who} enabled.` }[a]);
      await load(); paint();
    } catch (err) { note(err.message, true); b.disabled = false; }
  }));
}

function share(r, title, who) {
  shared = { title, link: r.link, text: (r.emailed ? `Also emailed to ${who}. ` : '') + `Send this link to ${who} on WhatsApp or email. It works once and expires in ${r.expiresDays} days.` };
  note(r.emailed ? `Emailed to ${who}. The link is also shown in Manage access.` : 'Link ready. Copy it and send it to them.');
}
document.addEventListener('click', e => {
  if (e.target.id === 'share-copy') {
    const i = document.getElementById('share-link'); i.select();
    (navigator.clipboard ? navigator.clipboard.writeText(i.value) : Promise.reject()).then(() => note('Link copied.')).catch(() => { document.execCommand && document.execCommand('copy'); note('Link copied.'); });
  } else if (e.target.id === 'share-close') { shared = null; paint(); }
});

// ---------- offer installation once on phones ----------
setTimeout(() => {
  if (standalone() || !matchMedia('(max-width: 820px)').matches) return;
  let seen = false; try { seen = localStorage.getItem('fs-install-tip') === '1'; localStorage.setItem('fs-install-tip', '1'); } catch (e) {}
  if (seen || !(installEvt || isIOS)) return;
  const box = $('#toasts'); if (!box) return;
  const el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status');
  el.innerHTML = '<span>Install Forearth Studio on this phone for one-tap access.</span>';
  const b = Object.assign(document.createElement('button'), { textContent: 'Install' }); b.onclick = () => { el.remove(); doInstall(); };
  el.appendChild(b); box.appendChild(el); setTimeout(() => el.remove(), 12000);
}, 5000);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
