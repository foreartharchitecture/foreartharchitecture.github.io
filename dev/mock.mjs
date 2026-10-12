// Local stand-ins for Notion, Google Drive, the Apps Script mail relay and the Anthropic API.
// Invented data only. Run: node dev/mock.mjs   (listens on http://127.0.0.1:8790)
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.MOCK_PORT || 8790);
const today = new Date(); const day = n => { const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + n)); return d.toISOString().slice(0, 10); };
const id32 = n => (n.toString(16).padStart(8, '0') + 'aaaabbbbccccddddeeeeffff').slice(0, 32);
const dash = h => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
let seq = 1000;

// ---------------- Notion ----------------
const DS = {
  team: '1ceeac43-053f-8079-901e-000bd426820c', projects: '1ceeac43-053f-80e7-a2d0-000bec1e0365', tasks: '1ceeac43-053f-80b6-b099-000b73589415',
  visits: '35eeac43-053f-805d-80f0-000b48cd1c91', meetings: '35ceac43-053f-802b-839c-000bb3d13cd0', crm: '351eac43-053f-8056-86b6-000b9ddf6710',
  clients: '269eac43-053f-807f-8f9c-000b651cea7a', issues: '35eeac43-053f-806b-a28e-000bed55075a'
};
const SCHEMA = {
  team: { 'MEMBER ID': 'unique_id', Name: 'title', Contact: 'phone_number', DOB: 'date', Email: 'email', Role: 'multi_select', 'Telegram Chat ID': 'rich_text' },
  projects: { 'PROJECT ID': 'unique_id', Name: 'title', Client: 'relation', Created: 'created_time', Lead: 'relation', Location: 'url', Priority: 'select', 'Project Type': 'select', Stage: 'select', 'Start- Expected End Date': 'date', Status: 'status', Tasks: 'relation' },
  tasks: { 'Task ID': 'unique_id', Name: 'title', Assignee: 'relation', 'Created Time': 'created_time', 'Delivery Commited': 'date', Done: 'date', 'Follow up note': 'rich_text', 'Follow- Up Status': 'select', 'Last edited time': 'last_edited_time', 'Last followup': 'date', Priority: 'select', Projects: 'relation', Remarks: 'rich_text', Status: 'status', 'Task Range': 'date' },
  visits: { 'SITE VISIT ID': 'unique_id', Title: 'title', Attendees: 'relation', 'Date and Time': 'date', Project: 'relation', Purpose: 'rich_text', 'Site Visit report': 'files', 'Visit No': 'number' },
  meetings: { 'MEETING ID': 'unique_id', 'Meeting Title': 'title', 'Attending Staff': 'relation', 'Date and Time': 'date', Location: 'rich_text', 'Meeting Mode': 'select', 'Meeting Number': 'number', MoM: 'files', Project: 'relation' },
  crm: { 'LEAD ID': 'unique_id', 'Project Name': 'title', Address: 'rich_text', 'Assaigned to': 'relation', 'Client Name': 'rich_text', Date: 'created_time', Email: 'email', 'Fee- Expected': 'number', 'Last Action': 'select', Location: 'rich_text', 'Next Action': 'select', Notes: 'rich_text', 'Phone number': 'phone_number', Scope: 'multi_select', Source: 'select', Status: 'status', Type: 'select' },
  clients: { 'CLIENT ID': 'unique_id', 'Client Name': 'title', Address: 'rich_text', 'Client Email': 'email', Notes: 'rich_text', Phone: 'phone_number', Projects: 'relation' },
  issues: { 'ISSUE ID': 'unique_id', Issue: 'title', 'Date identified': 'date', Notes: 'rich_text', Project: 'relation', Status: 'status' }
};
const pages = new Map(); // id(dashed) -> { ds, values, created }
const counters = {};
function add(dsKey, values, n) {
  const id = dash(id32(++seq));
  const uid = Object.keys(SCHEMA[dsKey]).find(k => SCHEMA[dsKey][k] === 'unique_id');
  counters[dsKey] = Math.max(counters[dsKey] || 0, n || 0);
  if (uid) values[uid] = n || ++counters[dsKey];
  pages.set(id, { ds: dsKey, values, created: new Date(Date.now() - (5000 - seq) * 3600000).toISOString(), edited: new Date().toISOString() });
  return id;
}
const T = {
  arjun: add('team', { Name: 'Arjun Menon', Role: ['CEO'], Email: 'arjun@example.com', Contact: '+91 90000 00001', DOB: { start: day(9) }, 'Telegram Chat ID': '555' }, 1),
  nisha: add('team', { Name: 'Nisha Rahman', Role: ['Cofounder', 'Project Manager'], Email: 'nisha@example.com', Contact: '+91 90000 00002', DOB: { start: '1991-03-14' } }, 2),
  faris: add('team', { Name: 'Faris K', Role: ['Draftsman'], Email: 'faris@example.com', DOB: { start: '1998-11-02' } }, 3),
  leena: add('team', { Name: 'Leena Thomas', Role: ['Site Engineer'], Email: 'leena@example.com', DOB: { start: '1996-06-21' } }, 4)
};
const C = {
  varma: add('clients', { 'Client Name': 'Arjun Varma', Phone: '+91 98450 11111', 'Client Email': 'varma@example.com', Address: 'Kozhikode' }, 21),
  meera: add('clients', { 'Client Name': 'Meera Das', Phone: '+91 98450 22222', Address: 'Wayanad' }, 22),
  joseph: add('clients', { 'Client Name': 'Joseph K', Address: 'Kakkadampoyil' }, 23)
};
const P = {
  hill: add('projects', { Name: 'Hillside Residence', Status: 'In progress', Stage: 'Design', Priority: 'High', 'Project Type': 'Residential', Client: [C.varma], Lead: [T.nisha], 'Start- Expected End Date': { start: day(-60), end: day(120) } }, 65),
  cafe: add('projects', { Name: 'Cliff Cafe', Status: 'In progress', Stage: 'Interior Design', Priority: 'Normal', 'Project Type': 'Commercial', Client: [C.meera], Lead: [T.arjun] }, 66),
  valley: add('projects', { Name: 'Valley Homestay', Status: 'In progress', Stage: 'Concept', Priority: 'High', 'Project Type': 'Hospitality', Client: [C.joseph], Lead: [T.arjun] }, 67),
  old: add('projects', { Name: 'Riverside Clinic', Status: 'Done', Stage: 'Finishing', Priority: 'Low', 'Project Type': 'Hospital' }, 58)
};
add('tasks', { Name: 'Working drawings – ground floor', Status: 'In progress', Priority: 'P1', Projects: [P.hill], Assignee: [T.faris], 'Task Range': { start: day(-6), end: day(-1) } }, 301);
add('tasks', { Name: 'Kitchen elevation revision', Status: 'Not started', Priority: 'P2', Projects: [P.cafe], Assignee: [T.faris], 'Task Range': { start: day(0), end: day(2) } }, 302);
add('tasks', { Name: 'Site levels survey', Status: 'Hold', Priority: 'P2', Projects: [P.valley], Assignee: [T.leena], 'Delivery Commited': { start: day(4) } }, 303);
add('tasks', { Name: 'Concept presentation board', Status: 'In progress', Priority: 'P1', Projects: [P.valley], Assignee: [T.arjun], 'Task Range': { start: day(1), end: day(6) }, 'Follow- Up Status': 'Awaiting Comments', 'Last followup': { start: day(-3) }, 'Follow up note': 'Client reviewing options A and B' }, 304);
add('tasks', { Name: 'Structural consultant coordination', Status: 'Not started', Priority: 'P3', Projects: [P.hill], Assignee: [T.nisha], 'Task Range': { start: day(3), end: day(9) } }, 305);
add('tasks', { Name: 'Lighting layout', Status: 'Done', Priority: 'P2', Projects: [P.cafe], Assignee: [T.faris], Done: { start: day(-2) } }, 290);
add('tasks', { Name: 'Measured drawing', Status: 'Done', Priority: 'P3', Projects: [P.hill], Assignee: [T.leena], Done: { start: day(-9) } }, 288);
add('visits', { Title: 'Foundation inspection', Project: [P.hill], Attendees: [T.leena, T.nisha], 'Date and Time': { start: day(1) + 'T10:30:00.000+05:30' }, Purpose: 'Check footing reinforcement', 'Visit No': 4 }, 41);
add('visits', { Title: 'Site study', Project: [P.valley], Attendees: [T.arjun], 'Date and Time': { start: day(-4) }, Purpose: 'Contours and views', 'Visit No': 1, 'Site Visit report': ['report.pdf'] }, 40);
add('meetings', { 'Meeting Title': 'Design review', Project: [P.cafe], 'Attending Staff': [T.arjun, T.faris], 'Date and Time': { start: day(2) + 'T15:00:00.000+05:30' }, 'Meeting Mode': 'Google meet', 'Meeting Number': 3 }, 31);
add('meetings', { 'Meeting Title': 'Client kickoff', Project: [P.valley], 'Attending Staff': [T.arjun], 'Date and Time': { start: day(-10) }, 'Meeting Mode': 'On Site', 'Meeting Number': 1, MoM: ['mom.pdf'] }, 30);
add('crm', { 'Project Name': 'Rahman Residence', 'Client Name': 'Salma Rahman', Status: 'Proposal submiitted', Type: 'Residential', Scope: ['Architecture', 'Interior Design'], 'Fee- Expected': 450000, Source: 'Social media', 'Next Action': 'First Followup', 'Last Action': 'Proposal Sent', 'Assaigned to': [T.arjun], Location: 'Malappuram', 'Phone number': '+91 90000 12345' }, 12);
add('crm', { 'Project Name': 'Beach Villas', 'Client Name': 'Rafeeq', Status: 'Discovery & Qualification', Type: 'Hospitality', Scope: ['Architecture', 'Masterplanning'], 'Fee- Expected': 1200000, Source: 'Friend Referrals', 'Next Action': 'initial sitevisit', 'Assaigned to': [T.nisha], Location: 'Kannur' }, 13);
add('crm', { 'Project Name': 'Office Fitout', 'Client Name': 'Tech Co', Status: 'New enquiry', Type: 'Commercial', Scope: ['Interior Design'], Source: 'google business' }, 14);
add('crm', { 'Project Name': 'Old Lead', 'Client Name': 'Someone', Status: 'Closed Lost', Type: 'Residential' }, 5);
add('issues', { Issue: 'Drainage clash with footing', Status: 'Open', Project: [P.hill], 'Date identified': { start: day(-2) } }, 7);

const rt = s => [{ type: 'text', text: { content: String(s) }, plain_text: String(s), annotations: {}, href: null }];
function prop(type, v) {
  switch (type) {
    case 'title': return { type, title: v ? rt(v) : [] };
    case 'rich_text': return { type, rich_text: v ? rt(v) : [] };
    case 'number': return { type, number: v ?? null };
    case 'select': return { type, select: v ? { name: v } : null };
    case 'status': return { type, status: v ? { name: v } : null };
    case 'multi_select': return { type, multi_select: (v || []).map(name => ({ name })) };
    case 'relation': return { type, relation: (v || []).map(id => ({ id })), has_more: false };
    case 'date': return { type, date: v ? { start: v.start, end: v.end || null, time_zone: null } : null };
    case 'email': case 'phone_number': case 'url': return { type, [type]: v || null };
    case 'files': return { type, files: (v || []).map(name => ({ name, type: 'file', file: { url: 'https://example.com/' + name } })) };
    case 'unique_id': return { type, unique_id: { prefix: null, number: v } };
    default: return { type, [type]: v ?? null };
  }
}
function pageObj(id) {
  const p = pages.get(id), sch = SCHEMA[p.ds], properties = {};
  for (const [name, type] of Object.entries(sch)) {
    if (type === 'created_time') properties[name] = { type, created_time: p.created };
    else if (type === 'last_edited_time') properties[name] = { type, last_edited_time: p.edited };
    else properties[name] = prop(type, p.values[name]);
  }
  return { object: 'page', id, created_time: p.created, last_edited_time: p.edited, in_trash: false, url: 'https://www.notion.so/' + id.replace(/-/g, ''),
    parent: { type: 'data_source_id', data_source_id: DS[p.ds], database_id: 'db-' + p.ds }, properties };
}
function matches(p, f) {
  if (!f) return true;
  if (f.and) return f.and.every(x => matches(p, x));
  if (f.or) return f.or.some(x => matches(p, x));
  const v = p.values[f.property], c = f.status || f.select;
  if (c) { if ('equals' in c) return v === c.equals; if ('does_not_equal' in c) return v !== c.does_not_equal; }
  return true;
}
function fromNotion(dsKey, props) {
  const out = {};
  for (const [name, val] of Object.entries(props || {})) {
    const type = SCHEMA[dsKey][name]; if (!type) throw { status: 400, message: `${name} is not a property that exists.` };
    const inner = val[type];
    switch (type) {
      case 'title': case 'rich_text': out[name] = (inner || []).map(t => t.text.content).join(''); break;
      case 'select': case 'status': out[name] = inner ? inner.name : null; break;
      case 'multi_select': out[name] = inner.map(o => o.name); break;
      case 'relation': out[name] = inner.map(r => r.id); break;
      case 'date': out[name] = inner ? { start: inner.start, end: inner.end } : null; break;
      default: out[name] = inner;
    }
  }
  return out;
}

// ---------------- Drive ----------------
const F = 'application/vnd.google-apps.folder';
const files = new Map();
const fx = n => readFileSync(join(here, 'fixtures', n));
function file(id, name, parent, mime, data, extra) { files.set(id, Object.assign({ id, name, parents: parent ? [parent] : [], mimeType: mime, modifiedTime: new Date(Date.now() - files.size * 3600000).toISOString(), data }, extra)); return id; }
const XLSX_M = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', DOCX_M = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
file('0AEo9QwQdhwx3Uk9PVA', 'My Drive', null, F);
file('1Q51mpfCGt7qeOSoa5NckqMjWOsIRvMV7', 'Studio', '0AEo9QwQdhwx3Uk9PVA', F);
file('1oy6y9ahlBETlVHQCVKs5z3BKHoduKmqz', 'Ongoing Projects', '1Q51mpfCGt7qeOSoa5NckqMjWOsIRvMV7', F);
file('1fUNVy0vy3kp-P08pifTD_LH9VsrjWRah', 'Completed Projects', '1Q51mpfCGt7qeOSoa5NckqMjWOsIRvMV7', F);
file('12qr32I9yYrmsiyoKn-VPNM6ZPQStm-y4', 'Outbox', '1Q51mpfCGt7qeOSoa5NckqMjWOsIRvMV7', F);
file('fold-hill-0000000001', 'FE-100-65 Hillside Residence', '1oy6y9ahlBETlVHQCVKs5z3BKHoduKmqz', F);
file('fold-cafe-0000000002', 'FE-100-66 Cliff Cafe', '1oy6y9ahlBETlVHQCVKs5z3BKHoduKmqz', F);
file('fold-clin-0000000003', 'FE-100-58 Riverside Clinic', '1fUNVy0vy3kp-P08pifTD_LH9VsrjWRah', F);
file('file-hill-plan-00001', '01_Hillside_Ground Floor Plan_R2.pdf', 'fold-hill-0000000001', 'application/pdf', Buffer.from('%PDF-1.4 test'));
file('file-out-0000000001', '03_Cliff Cafe_Kitchen Elevations_R1.pdf', '12qr32I9yYrmsiyoKn-VPNM6ZPQStm-y4', 'application/pdf', Buffer.from('%PDF-1.4 test'));
file('1c4q_qdcYcPQkObWOr8AIVcBUEzp4gNwT', 'Finance', '0AEo9QwQdhwx3Uk9PVA', F);
file('1esrOpUqQtjvXLmsqy_Tg7uNCVpy0Sx8o', 'Quarterly Accounts', '1c4q_qdcYcPQkObWOr8AIVcBUEzp4gNwT', F);
file('file-q3-finance-0001', 'Q3 2026 Finance.xlsx', '1esrOpUqQtjvXLmsqy_Tg7uNCVpy0Sx8o', XLSX_M, fx('Q3 2026 Finance.xlsx'), { fileExtension: 'xlsx' });
file('1d_qtcBIfYHdh6vkotnPaHs1HkVwDs675', 'Invoices', '1c4q_qdcYcPQkObWOr8AIVcBUEzp4gNwT', F);
file('file-inv-hill-00002', 'Hillside Residence Invoice #2.docx', '1d_qtcBIfYHdh6vkotnPaHs1HkVwDs675', DOCX_M, fx('Hillside Residence Invoice #2.docx'), { fileExtension: 'docx' });
file('file-inv-vall-00001', 'Valley Homestay Invoice #1.docx', '1d_qtcBIfYHdh6vkotnPaHs1HkVwDs675', DOCX_M, fx('Valley Homestay Invoice #1.docx'), { fileExtension: 'docx' });
file('1WYkTfX_nxWNHvEPNKMmLx4-5OHPvmOJM', 'Sales', '0AEo9QwQdhwx3Uk9PVA', F);
file('1bvRyt5Re6kCs10FkbAcfRk9l7VSaIpXH', 'Proposals', '1WYkTfX_nxWNHvEPNKMmLx4-5OHPvmOJM', F);
file('1zaXfPsJNAABELxxUXjB18aCUFcze2rzs', 'Confirmed', '1bvRyt5Re6kCs10FkbAcfRk9l7VSaIpXH', F);
file('file-prop-0000000001', '01- Rahman Residence Architecture Proposal 12.09.2026.docx', '1bvRyt5Re6kCs10FkbAcfRk9l7VSaIpXH', DOCX_M, fx('Valley Homestay Invoice #1.docx'));
file('file-prop-0000000002', '02- Valley Homestay Full Service Proposal 20.08.2026.pdf', '1zaXfPsJNAABELxxUXjB18aCUFcze2rzs', 'application/pdf', Buffer.from('%PDF'));
file('1fdgGBEUTvGTShqSVWgV3HUSu6qYgZ5aA', 'Human Resources', '0AEo9QwQdhwx3Uk9PVA', F);
file('1b6iGZhbI3slSAzqdyZFdQlkGAohRPJOS', 'Salary Slips', '1fdgGBEUTvGTShqSVWgV3HUSu6qYgZ5aA', F);
file('file-slip-000000001', 'Salary Slip Faris September 2026.pdf', '1b6iGZhbI3slSAzqdyZFdQlkGAohRPJOS', 'application/pdf', Buffer.from('%PDF'));
file('1-Xcz4QZUbCdugxgz_yLxdwqqOWksFG7S', 'Travel Allowance', '1fdgGBEUTvGTShqSVWgV3HUSu6qYgZ5aA', F);
file('file-ta-00000000001', 'TA Leena September 2026.pdf', '1-Xcz4QZUbCdugxgz_yLxdwqqOWksFG7S', 'application/pdf', Buffer.from('%PDF'));

function evalQ(f, q) {
  const parts = q.replace(/^\((.*)\)( and trashed = false)?$/, '$1 and trashed = false').split(/\s+and\s+(?=(?:[^']*'[^']*')*[^']*$)/i);
  return parts.every(c => {
    c = c.trim().replace(/^\(+|\)+$/g, '');
    let m;
    if ((m = c.match(/^(not\s+)?'([^']+)' in parents$/))) return !!m[1] !== f.parents.includes(m[2]);
    if ((m = c.match(/^name contains '((?:\\.|[^'])*)'$/))) return f.name.toLowerCase().includes(m[1].replace(/\\'/g, "'").toLowerCase());
    if ((m = c.match(/^fullText contains '((?:\\.|[^'])*)'$/))) { const t = m[1].toLowerCase(); return f.name.toLowerCase().includes(t) || (f.data && f.data.toString('latin1').toLowerCase().includes(t)); }
    if ((m = c.match(/^mimeType (!=|=) '([^']+)'$/))) return (f.mimeType === m[2]) === (m[1] === '=');
    if (c === 'trashed = false') return true;
    return true;
  });
}
const fileJson = f => ({ id: f.id, name: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime, createdTime: f.modifiedTime, size: f.data ? String(f.data.length) : undefined,
  fileExtension: f.fileExtension, parents: f.parents, webViewLink: `https://drive.google.com/file/d/${f.id}/view`, owners: [{ emailAddress: 'server@example.com' }] });

// ---------------- server ----------------
export const mail = [];
const json = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
const readBody = req => new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => r(b)); });
let notionCalls = 0;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), p = url.pathname, raw = await readBody(req);
  const body = raw && (req.headers['content-type'] || '').includes('json') ? JSON.parse(raw) : {};
  try {
    // --- mail relay ---
    if (p === '/mail' && req.method === 'POST') { if (body.key !== 'dev-mail-key') return json(res, 200, { ok: false, error: 'forbidden' }); mail.push({ to: body.to, subject: body.subject, text: body.text, html: body.html, at: Date.now() }); return json(res, 200, { ok: true }); }
    if (p === '/mail/last') { const m = [...mail].reverse().find(x => !url.searchParams.get('to') || x.to === url.searchParams.get('to')); return json(res, 200, m || {}); }
    if (p === '/stats') return json(res, 200, { notionCalls, mail: mail.length });
    // --- Notion ---
    if (p.startsWith('/notion/v1/')) {
      notionCalls++;
      if (req.headers.authorization !== 'Bearer dev-notion-token') return json(res, 401, { message: 'API token is invalid.' });
      const np = p.slice('/notion/v1'.length);
      if (np === '/users/me') return json(res, 200, { object: 'user', name: 'Forearth Studio (dev)', type: 'bot' });
      let m;
      if ((m = np.match(/^\/data_sources\/([\w-]+)\/query$/))) {
        const dsKey = Object.keys(DS).find(k => DS[k] === m[1]); if (!dsKey) return json(res, 404, { message: 'Could not find data source' });
        const all = [...pages.entries()].filter(([, v]) => v.ds === dsKey && matches(v, body.filter)).map(([id]) => id);
        const start = Number(body.start_cursor || 0), size = body.page_size || 100;
        const slice = all.slice(start, start + size);
        return json(res, 200, { object: 'list', results: slice.map(pageObj), has_more: start + size < all.length, next_cursor: start + size < all.length ? String(start + size) : null });
      }
      if ((m = np.match(/^\/data_sources\/([\w-]+)$/))) {
        const dsKey = Object.keys(DS).find(k => DS[k] === m[1]); if (!dsKey) return json(res, 404, { message: 'nf' });
        return json(res, 200, { object: 'data_source', id: m[1], properties: Object.fromEntries(Object.entries(SCHEMA[dsKey]).map(([n, t]) => [n, { id: n, type: t }])) });
      }
      if ((m = np.match(/^\/pages\/([\w-]+)$/))) {
        const id = m[1].includes('-') ? m[1] : dash(m[1]);
        if (!pages.has(id)) return json(res, 404, { message: 'Could not find page' });
        if (req.method === 'PATCH') { const pg = pages.get(id); Object.assign(pg.values, fromNotion(pg.ds, body.properties)); pg.edited = new Date().toISOString(); }
        return json(res, 200, pageObj(id));
      }
      if (np === '/pages' && req.method === 'POST') {
        const dsKey = Object.keys(DS).find(k => DS[k] === body.parent.data_source_id);
        const id = add(dsKey, fromNotion(dsKey, body.properties));
        return json(res, 200, pageObj(id));
      }
      if (np === '/search') {
        const q = String(body.query || '').toLowerCase();
        const hits = [...pages.keys()].filter(id => JSON.stringify(pages.get(id).values).toLowerCase().includes(q)).slice(0, body.page_size || 10);
        return json(res, 200, { results: hits.map(pageObj) });
      }
      if ((m = np.match(/^\/blocks\/([\w-]+)\/children$/))) return json(res, 200, { results: [{ type: 'paragraph', paragraph: { rich_text: rt('Notes from the last client call: budget confirmed, start in November.') } }], has_more: false });
      return json(res, 404, { message: 'mock: unknown Notion path ' + np });
    }
    // --- Google ---
    if (p === '/google/token') { const ok = /assertion=/.test(raw); return json(res, ok ? 200 : 400, ok ? { access_token: 'dev-drive-token', expires_in: 3600 } : { error: 'invalid_grant' }); }
    if (p.startsWith('/drive/v3/files')) {
      if (req.headers.authorization !== 'Bearer dev-drive-token') return json(res, 401, { error: { message: 'Invalid Credentials' } });
      const rest = p.slice('/drive/v3/files'.length);
      if (!rest) {
        const q = url.searchParams.get('q') || '';
        let list = [...files.values()].filter(f => f.parents.length && evalQ(f, q));
        if ((url.searchParams.get('orderBy') || '').startsWith('modifiedTime')) list.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
        const size = Number(url.searchParams.get('pageSize') || 100), start = Number(url.searchParams.get('pageToken') || 0);
        return json(res, 200, { files: list.slice(start, start + size).map(fileJson), nextPageToken: start + size < list.length ? String(start + size) : undefined });
      }
      const m = rest.match(/^\/([^/]+)(\/export)?$/), f = m && files.get(decodeURIComponent(m[1]));
      if (!f) return json(res, 404, { error: { message: 'File not found' } });
      if (m[2]) { res.writeHead(200, { 'content-type': url.searchParams.get('mimeType') }); return res.end(f.data || ''); }
      if (url.searchParams.get('alt') === 'media') {
        const buf = f.data || Buffer.alloc(0), r = (req.headers.range || '').match(/bytes=(\d*)-(\d*)/);
        if (r) {
          let s = r[1] === '' ? buf.length - Number(r[2]) : Number(r[1]), e = r[1] === '' || r[2] === '' ? buf.length - 1 : Math.min(buf.length - 1, Number(r[2]));
          res.writeHead(206, { 'content-type': f.mimeType, 'content-range': `bytes ${s}-${e}/${buf.length}`, 'content-length': e - s + 1, 'accept-ranges': 'bytes' });
          return res.end(buf.subarray(s, e + 1));
        }
        res.writeHead(200, { 'content-type': f.mimeType, 'content-length': buf.length }); return res.end(buf);
      }
      return json(res, 200, fileJson(f));
    }
    // --- Anthropic ---
    if (p === '/anthropic/v1/messages') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const words = '- **Hillside Residence (FE-100-65)**: working drawings are a day late; confirm the structural consultant meeting.\n- Rahman Residence proposal awaits follow-up (₹4,50,000).\n- Valley Homestay concept board due this week.'.split(' ');
      res.write(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start' })}\n\n`);
      for (const w of words) { res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: w + ' ' } })}\n\n`); await new Promise(r => setTimeout(r, 15)); }
      res.write(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' } })}\n\n`);
      return res.end(`event: message_stop\ndata: {"type":"message_stop"}\n\n`);
    }
    json(res, 404, { message: 'mock: not found ' + p });
  } catch (e) { json(res, e.status || 500, { message: e.message || String(e) }); }
});
server.listen(PORT, '127.0.0.1', () => console.log('mock upstreams on http://127.0.0.1:' + PORT));
