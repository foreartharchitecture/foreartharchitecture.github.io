/**
 * Forearth Studio — email relay for sign-in codes and invitations.
 *
 * Paste into a new Apps Script project (script.google.com) while signed in to the Gmail
 * account that should send the emails, set MAIL_KEY below to the same value as the
 * MAIL_KEY secret in Cloudflare, then Deploy → New deployment → Web app
 * (Execute as: Me · Who has access: Anyone). Copy the Web app URL into MAIL_URL.
 *
 * Consumer Gmail accounts can send to about 100 recipients a day through Apps Script.
 */
const MAIL_KEY = 'PASTE-THE-SAME-MAIL_KEY-AS-CLOUDFLARE';

function doPost(e) {
  try {
    const b = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!MAIL_KEY || MAIL_KEY.indexOf('PASTE') === 0 || b.key !== MAIL_KEY) return reply({ ok: false, error: 'forbidden' });
    const to = String(b.to || '').trim();
    if (!/^[^@\s<>"']+@[^@\s<>"']+\.[a-z]{2,}$/i.test(to)) return reply({ ok: false, error: 'bad_recipient' });
    MailApp.sendEmail({
      to: to,
      subject: String(b.subject || 'Forearth Studio').slice(0, 200),
      htmlBody: String(b.html || ''),
      body: String(b.text || ''),
      name: String(b.fromName || 'Forearth Studio').slice(0, 60)
    });
    return reply({ ok: true, remaining: MailApp.getRemainingDailyQuota() });
  } catch (err) {
    return reply({ ok: false, error: String(err && err.message || err) });
  }
}

function doGet() { return reply({ ok: true, service: 'forearth-studio-mail' }); }

function reply(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/** Run once from the editor to grant the email permission and send yourself a test. */
function testSend() {
  MailApp.sendEmail(Session.getActiveUser().getEmail(), 'Forearth Studio mail relay works', 'This account can send Forearth Studio sign-in codes.');
}
