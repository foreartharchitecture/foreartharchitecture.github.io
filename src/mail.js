// Sends email through the firm's Google Apps Script relay (MAIL_URL + MAIL_KEY).
import { HttpError } from './util.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function frame(title, inner, foot) {
  return `<!doctype html><html><body style="margin:0;background:#ecebe4;font-family:Helvetica,Arial,sans-serif;color:#181915">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ecebe4;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;background:#fbfaf5;border:1px solid #d8d6cb;border-radius:6px">
<tr><td style="padding:20px 24px;border-bottom:1px solid #d8d6cb"><div style="font-weight:700;letter-spacing:.18em;font-size:15px">FOREARTH</div>
<div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#787a71;margin-top:2px">Studio dashboard</div></td></tr>
<tr><td style="padding:24px"><div style="font-size:17px;font-weight:600;margin:0 0 12px">${esc(title)}</div>${inner}</td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid #d8d6cb;font-size:12px;color:#787a71">${foot}</td></tr>
</table></td></tr></table></body></html>`;
}

export function codeEmail({ code, purpose, name }) {
  const what = { login: 'sign in to', reset: 'reset your password for', claim: 'set up your founder account on' }[purpose] || 'continue on';
  const subject = `${code} is your Forearth Studio code`;
  const html = frame(name ? `Hello ${name}` : 'Your verification code',
    `<p style="margin:0 0 14px;font-size:14px;line-height:1.5">Use this code to ${what} the Forearth Studio dashboard. It expires in 10 minutes.</p>
     <div style="font-family:Menlo,Consolas,monospace;font-size:30px;letter-spacing:.32em;font-weight:700;background:#f4f3ec;border:1px solid #d8d6cb;border-radius:4px;padding:14px 0;text-align:center">${esc(code)}</div>`,
    'If you did not request this code, ignore this email and tell a founder. Never share this code with anyone.');
  const text = `Your Forearth Studio code is ${code}. Use it to ${what} the dashboard. It expires in 10 minutes.\n\nIf you did not request it, ignore this email and tell a founder.`;
  return { subject, html, text };
}

export function inviteEmail({ name, inviter, link, role }) {
  const subject = 'You have been invited to the Forearth Studio dashboard';
  const html = frame(name ? `Hello ${name}` : 'You have been invited',
    `<p style="margin:0 0 16px;font-size:14px;line-height:1.5">${esc(inviter || 'A founder')} has given you ${role === 'founder' ? 'founder' : 'staff'} access to the Forearth Studio dashboard. Choose a username and password to finish setting up your account. The link works once and expires in 7 days.</p>
     <a href="${esc(link)}" style="display:inline-block;background:#181915;color:#fbfaf5;text-decoration:none;padding:11px 18px;border-radius:4px;font-size:14px;font-weight:600">Set up my account</a>
     <p style="margin:16px 0 0;font-size:12px;color:#787a71;word-break:break-all">${esc(link)}</p>`,
    'If you were not expecting this invitation, ignore this email.');
  const text = `${inviter || 'A founder'} has invited you to the Forearth Studio dashboard.\n\nSet up your account (link works once, expires in 7 days):\n${link}`;
  return { subject, html, text };
}

export async function sendMail(env, to, msg) {
  if (!env.MAIL_URL || !env.MAIL_KEY) throw new HttpError(503, 'mail_not_configured', 'Email sending is not set up yet. A founder needs to add MAIL_URL and MAIL_KEY.');
  let res, out;
  try {
    res = await fetch(env.MAIL_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, redirect: 'follow',
      body: JSON.stringify({ key: env.MAIL_KEY, to, subject: msg.subject, html: msg.html, text: msg.text, fromName: 'Forearth Studio' }) });
    out = await res.json().catch(() => null);
  } catch (e) { out = null; }
  if (!res || !res.ok || !out || !out.ok) {
    console.error('mail relay failed', res && res.status, out && out.error);
    throw new HttpError(502, 'mail_failed', 'The code email could not be sent. Try again in a minute.');
  }
  return true;
}
