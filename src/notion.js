// Notion adapter. Reads and writes through the Notion API with an internal integration
// token, and returns rows in the same flat shape the dashboard already understands
// (relations as JSON arrays of page URLs, dates split into date:<Prop>:start/end/is_datetime).
import { HttpError } from './util.js';
import { VIEWS, WRITABLE_DS, HIDDEN_PROPS, STAFF_FIELDS } from './config.js';

const API = 'https://api.notion.com/v1';
const base = env => env.DEV_NOTION_API || API; // DEV_* overrides are for local testing only
const VERSION = '2025-09-03';
const dashed = id => { const h = String(id || '').replace(/-/g, '').toLowerCase(); return /^[0-9a-f]{32}$/.test(h) ? `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` : null; };
const pageId = v => { const m = String(v || '').replace(/-/g, '').match(/([0-9a-f]{32})/i); return m ? dashed(m[1]) : null; };
const pageUrl = id => 'https://www.notion.so/' + String(id).replace(/-/g, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function call(env, path, opts = {}) {
  if (!env.NOTION_TOKEN) throw new HttpError(503, 'not_configured', 'Notion is not connected yet. A founder needs to add NOTION_TOKEN.');
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(base(env) + path, {
      method: opts.method || 'GET',
      headers: { authorization: `Bearer ${env.NOTION_TOKEN}`, 'notion-version': VERSION, 'content-type': 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    if (res.status === 429 && attempt < 2) { await sleep(Math.min(3000, (Number(res.headers.get('retry-after')) || 1) * 1000)); continue; }
    if (res.ok) return res.json();
    const err = await res.json().catch(() => ({}));
    if (res.status === 401) throw new HttpError(503, 'not_configured', 'The Notion token was rejected. Check NOTION_TOKEN.');
    if (res.status === 404) throw new HttpError(404, 'tool_error', 'Notion could not find that page or database. Share it with the Forearth Studio integration (••• → Connections).');
    if (res.status === 429) throw new HttpError(429, 'rate_limited', 'Notion is busy. Trying again shortly.');
    if (res.status >= 500) throw new HttpError(502, 'server_unavailable', 'Notion did not respond.');
    throw new HttpError(400, 'tool_error', err.message || `Notion returned ${res.status}.`);
  }
}

// ---------- reading ----------
const plain = arr => (arr || []).map(t => t.plain_text || '').join('');
function flatten(page, hide, allow) {
  const out = { url: pageUrl(page.id), createdTime: page.created_time };
  for (const [name, p] of Object.entries(page.properties || {})) {
    if (hide && hide.includes(name)) continue;
    if (allow && !allow.includes(name)) continue;
    switch (p.type) {
      case 'title': case 'rich_text': out[name] = plain(p[p.type]); break;
      case 'number': out[name] = p.number; break;
      case 'select': case 'status': if (p[p.type]) out[name] = p[p.type].name; break;
      case 'multi_select': out[name] = JSON.stringify((p.multi_select || []).map(o => o.name)); break;
      case 'relation': out[name] = JSON.stringify((p.relation || []).map(r => pageUrl(r.id))); break;
      case 'people': out[name] = JSON.stringify((p.people || []).map(u => 'user://' + u.id)); break;
      case 'date': {
        const d = p.date;
        if (d && d.start) out[`date:${name}:start`] = d.start;
        if (d && d.end) out[`date:${name}:end`] = d.end;
        out[`date:${name}:is_datetime`] = d && d.start && d.start.length > 10 ? 1 : 0;
        break;
      }
      case 'checkbox': out[name] = p.checkbox ? '__YES__' : '__NO__'; break;
      case 'url': case 'email': case 'phone_number': out[name] = p[p.type] || ''; break;
      case 'created_time': case 'last_edited_time': out[name] = p[p.type]; break;
      case 'created_by': case 'last_edited_by': out[name] = p[p.type] ? 'user://' + p[p.type].id : ''; break;
      case 'unique_id': out[name] = p.unique_id && p.unique_id.number != null ? String(p.unique_id.number) : ''; break;
      case 'files': out[name] = JSON.stringify((p.files || []).map(f => f.name || 'file')); break;
      case 'formula': { const f = p.formula || {}; out[name] = f.type === 'date' ? (f.date && f.date.start) || '' : f[f.type] ?? ''; break; }
      case 'rollup': { const r = p.rollup || {}; out[name] = r.type === 'number' ? r.number : r.type === 'date' ? (r.date && r.date.start) || '' : ''; break; }
      default: break;
    }
  }
  return out;
}

export async function queryView(env, input, perms) {
  const d = (input && input.data) || {};
  const v = VIEWS[d.view_url];
  if (!v) throw new HttpError(400, 'tool_error', 'Unknown view.');
  if (perms.views !== '*' && !perms.views.includes(v.key)) throw new HttpError(403, 'forbidden', 'Your access level does not include this list.');
  const req = { page_size: Math.min(100, Math.max(1, Number(d.page_size) || 100)) };
  if (v.filter) req.filter = v.filter;
  if (v.sorts) req.sorts = v.sorts;
  if (typeof d.start_cursor === 'string' && d.start_cursor.length < 200) req.start_cursor = d.start_cursor;
  const r = await call(env, `/data_sources/${v.ds}/query`, { method: 'POST', body: req });
  const hide = HIDDEN_PROPS[v.key] || [];
  const allow = perms.views === '*' ? null : STAFF_FIELDS[v.key] || [];
  return { results: (r.results || []).filter(p => p.object === 'page' && !p.in_trash).map(p => flatten(p, hide, allow)), has_more: !!r.has_more, next_cursor: r.next_cursor || null };
}

// ---------- writing ----------
const toList = v => Array.isArray(v) ? v : typeof v === 'string' && v.trim().startsWith('[') ? (() => { try { return JSON.parse(v); } catch (e) { return []; } })() : v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : [];
const rich = s => { const t = String(s ?? ''); const parts = []; for (let i = 0; i < t.length; i += 1900) parts.push({ type: 'text', text: { content: t.slice(i, i + 1900) } }); return parts; };

// Turns the dashboard's flat property map into Notion API property values.
function toNotion(flat, types, current) {
  const out = {}, dates = {};
  for (const [key, val] of Object.entries(flat || {})) {
    const m = key.match(/^date:(.+):(start|end|is_datetime)$/);
    if (m) { (dates[m[1]] = dates[m[1]] || {})[m[2]] = val; continue; }
    const type = types[key];
    if (!type) throw new HttpError(400, 'tool_error', `Notion has no property called “${key}”.`);
    switch (type) {
      case 'title': out[key] = { title: val ? rich(val) : [] }; break;
      case 'rich_text': out[key] = { rich_text: val ? rich(val) : [] }; break;
      case 'number': { const n = val === '' || val == null ? null : Number(val); out[key] = { number: Number.isFinite(n) ? n : null }; break; }
      case 'select': out[key] = { select: val ? { name: String(val) } : null }; break;
      case 'status': out[key] = { status: val ? { name: String(val) } : null }; break;
      case 'multi_select': out[key] = { multi_select: toList(val).map(name => ({ name: String(name) })) }; break;
      case 'relation': out[key] = { relation: toList(val).map(pageId).filter(Boolean).map(id => ({ id })) }; break;
      case 'people': out[key] = { people: toList(val).map(u => ({ id: String(u).replace(/^user:\/\//, '') })) }; break;
      case 'checkbox': out[key] = { checkbox: val === true || val === '__YES__' }; break;
      case 'url': case 'email': case 'phone_number': out[key] = { [type]: val ? String(val) : null }; break;
      default: throw new HttpError(400, 'tool_error', `“${key}” is calculated by Notion and cannot be edited.`);
    }
  }
  for (const [name, parts] of Object.entries(dates)) {
    if (types[name] !== 'date') throw new HttpError(400, 'tool_error', `Notion has no date property called “${name}”.`);
    const cur = (current && current[name]) || {};
    const start = 'start' in parts ? parts.start : cur.start || null;
    const end = 'end' in parts ? parts.end : cur.end || null;
    out[name] = { date: start ? { start, end: end && end !== start ? end : null } : null };
  }
  return out;
}

const schemaCache = new Map();
async function schemaTypes(env, ds) {
  const c = schemaCache.get(ds);
  if (c && Date.now() - c.at < 600000) return c.types;
  const r = await call(env, `/data_sources/${ds}`);
  const types = Object.fromEntries(Object.entries(r.properties || {}).map(([n, p]) => [n, p.type]));
  schemaCache.set(ds, { types, at: Date.now() });
  return types;
}

export async function updatePage(env, input) {
  if (!input || input.command !== 'update_properties') throw new HttpError(400, 'tool_error', 'Only property updates are supported.');
  const id = pageId(input.page_id);
  if (!id) throw new HttpError(400, 'tool_error', 'Missing page.');
  const page = await call(env, `/pages/${id}`);
  const ds = page.parent && (page.parent.data_source_id || page.parent.database_id);
  if (!ds || !Object.keys(WRITABLE_DS).some(x => x.replace(/-/g, '') === String(ds).replace(/-/g, ''))) throw new HttpError(403, 'forbidden', 'This page cannot be edited from the dashboard.');
  const types = {}, current = {};
  for (const [n, p] of Object.entries(page.properties || {})) { types[n] = p.type; if (p.type === 'date') current[n] = p.date || {}; }
  const props = toNotion(input.properties, types, current);
  const r = await call(env, `/pages/${id}`, { method: 'PATCH', body: { properties: props } });
  return { id: r.id, url: pageUrl(r.id) };
}

export async function createPages(env, input) {
  const ds = input && input.parent && input.parent.data_source_id;
  if (!ds || !WRITABLE_DS[ds]) throw new HttpError(403, 'forbidden', 'Records cannot be added to that database from the dashboard.');
  const types = await schemaTypes(env, ds);
  const pages = [];
  for (const p of (input.pages || []).slice(0, 10)) {
    const r = await call(env, '/pages', { method: 'POST', body: { parent: { type: 'data_source_id', data_source_id: ds }, properties: toNotion(p.properties, types) } });
    pages.push({ id: r.id, url: pageUrl(r.id) });
  }
  return { pages };
}

// ---------- search & page text (used by founders' search and AI answers) ----------
function titleOf(o) {
  if (o.object === 'data_source' || o.object === 'database') return plain(o.title) || 'Untitled database';
  const t = Object.values(o.properties || {}).find(p => p.type === 'title');
  return (t && plain(t.title)) || 'Untitled page';
}
export async function search(env, input) {
  const q = String((input && input.query) || '').slice(0, 200);
  const r = await call(env, '/search', { method: 'POST', body: { query: q, page_size: Math.min(20, Number(input.page_size) || 10), sort: { direction: 'descending', timestamp: 'last_edited_time' } } });
  return { results: (r.results || []).filter(o => !o.in_trash).map(o => ({ id: o.id.replace(/-/g, ''), title: titleOf(o), url: o.url || pageUrl(o.id), type: o.object === 'page' ? 'page' : 'database', highlight: '', timestamp: o.last_edited_time })) };
}

const BLOCK_TEXT = { paragraph: '', heading_1: '# ', heading_2: '## ', heading_3: '### ', bulleted_list_item: '- ', numbered_list_item: '1. ', to_do: '- ', quote: '> ', callout: '', toggle: '' };
export async function fetchPage(env, input) {
  const id = pageId(input && input.id);
  if (!id) throw new HttpError(400, 'tool_error', 'Missing page.');
  const page = await call(env, `/pages/${id}`);
  const lines = [];
  for (const [n, p] of Object.entries(page.properties || {})) {
    const f = flatten({ id, properties: { [n]: p } });
    const v = f[n] ?? f[`date:${n}:start`];
    if (v && p.type !== 'title' && !String(v).startsWith('[')) lines.push(`${n}: ${v}`);
  }
  let cursor, guard = 0;
  do {
    const r = await call(env, `/blocks/${id}/children?page_size=100${cursor ? '&start_cursor=' + encodeURIComponent(cursor) : ''}`);
    for (const b of r.results || []) {
      const v = b[b.type] || {};
      if (b.type in BLOCK_TEXT) lines.push(BLOCK_TEXT[b.type] + plain(v.rich_text));
      else if (b.type === 'table_row') lines.push('| ' + (v.cells || []).map(plain).join(' | ') + ' |');
      else if (b.type === 'child_page') lines.push(`[Page] ${v.title || ''}`);
    }
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor && ++guard < 3);
  return { title: titleOf(page), url: pageUrl(id), text: lines.filter(Boolean).join('\n').slice(0, 20000) };
}

export async function notionPing(env) {
  const r = await call(env, '/users/me');
  const v = VIEWS['view://395eac43-053f-80bf-aea4-000cec07b988'];
  await call(env, `/data_sources/${v.ds}/query`, { method: 'POST', body: { page_size: 1 } });
  return `Connected as ${r.name || 'integration'}`;
}
