// Standalone bridge: gives the dashboard the same window.claude.use('mcp' | 'sample') interface it
// has inside claude.ai, backed by this site's own API. Adds an on-device cache so the app opens
// instantly, request pacing, and in-browser text extraction for Word and Excel files.
(() => {
'use strict';
const FE = window.FE_USER || null;
const NS = 'fs:' + (FE && FE.user ? FE.user.id : 'anon') + ':';
const dec = new TextDecoder();

// ---------- small IndexedDB key-value store (per signed-in user) ----------
const idb = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('forearth-studio', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => { const db = r.result; db.onversionchange = () => { db.close(); dbp = null; }; res(db); };
    r.onerror = () => rej(r.error);
  }));
  const run = (mode, fn) => open().then(db => new Promise((res, rej) => {
    const t = db.transaction('kv', mode), req = fn(t.objectStore('kv'));
    t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  }));
  return {
    get: k => run('readonly', s => s.get(NS + k)).catch(() => undefined),
    set: (k, v) => run('readwrite', s => s.put(v, NS + k)).catch(() => {}),
    clear: () => run('readwrite', s => s.clear()).catch(() => {})
  };
})();

// ---------- session handling ----------
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('forearth-studio') : null;
// The cached app page carries the user's name and role; static files are kept.
const dropShell = () => window.caches ? caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('fs-shell')).map(k => caches.open(k).then(c => c.delete('/'))))) : Promise.resolve();
let leaving = false;
function signedOut() {
  if (leaving) return; leaving = true;
  try { if (channel) channel.postMessage('signed-out'); } catch (e) {}
  const n = document.createElement('div');
  n.setAttribute('role', 'alert');
  n.style.cssText = 'position:fixed;inset:0;z-index:100;display:grid;place-items:center;background:rgba(4,6,5,.72);color:#ebe8dd;font:500 15px/1.5 system-ui,sans-serif;text-align:center;padding:24px';
  n.innerHTML = '<div><div style="font-weight:700;letter-spacing:.18em;margin-bottom:8px">FOREARTH</div>Your session has ended. Taking you to sign in…</div>';
  document.body.appendChild(n);
  // Nothing from the ended session stays on the device.
  const wipe = Promise.all([idb.clear(), dropShell()]).catch(() => {});
  Promise.race([wipe, new Promise(r => setTimeout(r, 1500))]).then(() => location.replace('/login'));
}
if (channel) channel.onmessage = e => { if (e.data === 'signed-out') signedOut(); };
// A page restored from the offline cache after the session has expired shows nothing and wipes local data.
if (FE && FE.sessionExp && Date.now() > FE.sessionExp) setTimeout(signedOut, 0);
async function request(path, init) {
  let res;
  try { res = await fetch(path, Object.assign({ credentials: 'same-origin' }, init)); }
  catch (e) { if (e && e.name === 'AbortError') throw { code: 'cancelled', message: 'Request cancelled.' }; throw { code: 'server_unavailable', message: 'No connection.' }; }
  if (res.status === 401) { signedOut(); throw { code: 'unauthorized', message: 'Your session has ended.' }; }
  if (!res.ok && res.status !== 206) {
    const e = await res.json().catch(() => ({}));
    throw { code: e.error || (res.status === 429 ? 'rate_limited' : res.status >= 500 ? 'server_unavailable' : 'tool_error'), message: e.message || `Request failed (${res.status}).`, status: res.status };
  }
  return res;
}
const postJSON = (path, data, signal) => request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data), signal });

// At most four API calls at a time keeps Notion within its rate limit when the app opens.
let active = 0; const queue = [];
function paced(fn) {
  return new Promise((resolve, reject) => {
    const go = () => { active++; fn().then(resolve, reject).finally(() => { active--; if (queue.length) queue.shift()(); }); };
    if (active < 4) go(); else queue.push(go);
  });
}

// ---------- mcp shim ----------
const sortKeys = v => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.keys(v).sort().reduce((o, k) => (o[k] = sortKeys(v[k]), o), {}) : v;
const keyOf = (server, tool, input) => `${server}|${tool}|${JSON.stringify(sortKeys(input || {}))}`;
const wrap = r => ({ payload: r.payload, cache: { storedAt: r.storedAt } });
const persistable = (server, tool, input) => tool === 'notion-query-data-sources' || ((tool === 'search_files' || tool === 'list_recent_files') && (!input || input.excludeContentSnippets === true));
const mem = new Map(), inflight = new Map(), watchers = new Set();

async function fetchTool(server, tool, input) {
  const res = await paced(() => postJSON('/api/tool', { server, tool, input }));
  const j = await res.json();
  return { payload: j.payload, storedAt: j.storedAt || Date.now() };
}
async function callTool(server, tool, input, opts) {
  opts = opts || {};
  if (server === 'Google Drive' && tool === 'read_file_content') return readFileTool(input || {});
  const key = keyOf(server, tool, input), c = opts.cache;
  if (c && !c.refresh) {
    let hit = mem.get(key);
    if (!hit && persistable(server, tool, input)) { hit = await idb.get(key); if (hit) mem.set(key, hit); }
    if (hit && Date.now() - hit.storedAt < (c.staleTime || 0)) return wrap(hit);
  }
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    let r = await fetchTool(server, tool, input);
    if (server === 'Google Drive' && tool === 'search_files' && input && input.excludeContentSnippets !== true) r = await addSnippets(r, input);
    if (c !== false) { mem.set(key, r); if (persistable(server, tool, input)) idb.set(key, r); }
    return wrap(r);
  })();
  inflight.set(key, p);
  p.finally(() => inflight.delete(key)).catch(() => {});
  return p;
}
function watchTool(server, tool, input, cb, opts) {
  opts = opts || {};
  const w = { key: keyOf(server, tool, input), server, tool, input, cb, every: opts.refetchInterval || 90000, stale: (opts.cache && opts.cache.staleTime) || 0, timer: 0, alive: true, last: 0, fails: 0 };
  watchers.add(w);
  (async () => {
    let cached = mem.get(w.key) || await idb.get(w.key);
    if (cached && w.alive) { mem.set(w.key, cached); w.last = cached.storedAt; cb({ type: 'data', result: wrap(cached) }); }
    if (!cached || Date.now() - cached.storedAt > w.stale) await run(w);
    plan(w);
  })();
  return () => { w.alive = false; clearTimeout(w.timer); watchers.delete(w); };
}
async function run(w) {
  if (!w.alive) return;
  try { const r = await callTool(w.server, w.tool, w.input, { cache: { refresh: true } }); w.last = Date.now(); w.fails = 0; if (w.alive) w.cb({ type: 'data', result: r }); }
  catch (e) { w.fails++; if (w.alive && e.code !== 'unauthorized') w.cb({ type: 'error', error: e }); }
}
function plan(w) {
  clearTimeout(w.timer); if (!w.alive) return;
  const wait = Math.min(600000, w.every * Math.pow(2, Math.min(3, w.fails)));
  w.timer = setTimeout(async () => { if (document.visibilityState === 'visible') await run(w); plan(w); }, wait);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  watchers.forEach(w => { if (Date.now() - w.last > w.every) run(w).then(() => plan(w)); });
});
window.addEventListener('online', () => watchers.forEach(w => run(w).then(() => plan(w))));
function invalidate(server, tool, input) {
  const key = keyOf(server, tool, input); mem.delete(key);
  const ws = [...watchers].filter(w => w.key === key);
  return Promise.all(ws.map(w => run(w)));
}
const MCP = Object.freeze({ callTool, watchTool, invalidate });

// ---------- Drive file text (Word, Excel, Google Docs/Sheets) ----------
const metaCache = new Map();
async function fileMeta(id) {
  const c = metaCache.get(id);
  if (c && Date.now() - c.at < 60000) return c.m;
  const m = await (await paced(() => request(`/api/drive/meta/${encodeURIComponent(id)}`))).json();
  metaCache.set(id, { m, at: Date.now() }); return m;
}
const TEXTABLE = /^(application\/vnd\.google-apps\.(document|presentation|spreadsheet)|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet)|application\/vnd\.ms-excel|text\/)/;
async function fileText(f) {
  const ck = `file:${f.id}:${f.modifiedTime || ''}`;
  const hit = await idb.get(ck);
  if (typeof hit === 'string') return hit;
  const text = await extract(f);
  idb.set(ck, text);
  return text;
}
async function readFileTool({ fileId }) {
  const m = await fileMeta(fileId);
  const text = TEXTABLE.test(m.mimeType || '') ? await fileText(m) : '';
  return { payload: { fileContent: text, title: m.title, viewUrl: m.viewUrl }, cache: { storedAt: Date.now() } };
}
async function addSnippets(r, input) {
  const files = ((r.payload && r.payload.files) || []).filter(f => TEXTABLE.test(f.mimeType || '')).slice(0, /fullText/.test(input.query || '') ? 6 : 40);
  let i = 0;
  const worker = async () => { while (i < files.length) { const f = files[i++]; try { f.contentSnippet = (await fileText(f)).slice(0, 5000); } catch (e) { /* leave without snippet */ } } };
  await Promise.all([worker(), worker(), worker()]);
  return r;
}
async function extract(f) {
  const mime = f.mimeType || '', url = `/api/drive/file/${encodeURIComponent(f.id)}`;
  if (/google-apps\.(document|presentation)|^text\//.test(mime)) return (await paced(() => request(url))).text();
  if (/spreadsheet|ms-excel/.test(mime)) return sheetText(await (await paced(() => request(url))).arrayBuffer());
  if (/wordprocessingml/.test(mime)) return docxText(f);
  return '';
}

// Reads only the parts of a .docx it needs (the zip directory and the document XML) using range requests.
async function ranged(id, start, end) {
  const res = await paced(() => request(`/api/drive/file/${encodeURIComponent(id)}`, { headers: { range: `bytes=${start}-${end}` } }));
  return { buf: new Uint8Array(await res.arrayBuffer()), partial: res.status === 206 };
}
async function inflateRaw(data) {
  if (typeof DecompressionStream === 'function') {
    try { return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()); } catch (e) { /* fall back */ }
  }
  const ff = await loadScript('/app/vendor/fflate.min.js', 'fflate');
  return ff.inflateSync(data);
}
async function zipParts(f, wanted) {
  const size = Number(f.fileSize) || 0;
  let first = size ? await ranged(f.id, Math.max(0, size - 65557), size - 1) : { buf: new Uint8Array(await (await request(`/api/drive/file/${encodeURIComponent(f.id)}`)).arrayBuffer()), partial: false };
  const whole = !first.partial ? first.buf : null;
  const base = whole ? 0 : Math.max(0, size - 65557), buf = first.buf;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1; for (let i = buf.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip file');
  const cdSize = dv.getUint32(eocd + 12, true), cdOff = dv.getUint32(eocd + 16, true);
  const cd = cdOff >= base && cdOff + cdSize <= base + buf.length ? buf.subarray(cdOff - base, cdOff - base + cdSize) : (await ranged(f.id, cdOff, cdOff + cdSize - 1)).buf;
  const cv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength), entries = [];
  for (let p = 0; p + 46 <= cd.length && cv.getUint32(p, true) === 0x02014b50;) {
    const nlen = cv.getUint16(p + 28, true), xlen = cv.getUint16(p + 30, true), clen = cv.getUint16(p + 32, true);
    const name = dec.decode(cd.subarray(p + 46, p + 46 + nlen));
    if (wanted(name)) entries.push({ name, method: cv.getUint16(p + 10, true), csize: cv.getUint32(p + 20, true), off: cv.getUint32(p + 42, true) });
    p += 46 + nlen + xlen + clen;
  }
  const out = {};
  for (const e of entries) {
    let chunk = whole ? whole.subarray(e.off, e.off + 30 + 1024 + e.csize) : (await ranged(f.id, e.off, Math.min(size - 1, e.off + 30 + 1024 + e.csize))).buf;
    const lv = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    if (lv.getUint32(0, true) !== 0x04034b50) continue;
    const start = 30 + lv.getUint16(26, true) + lv.getUint16(28, true);
    let data = start + e.csize <= chunk.length ? chunk.subarray(start, start + e.csize) : (await ranged(f.id, e.off + start, e.off + start + e.csize - 1)).buf;
    out[e.name] = e.method === 0 ? data : e.method === 8 ? await inflateRaw(data) : null;
  }
  return out;
}
function wordXmlText(bytes) {
  const doc = new DOMParser().parseFromString(dec.decode(bytes), 'application/xml');
  const lines = [];
  const inline = node => {
    let s = '';
    for (const c of node.childNodes) {
      if (c.nodeType !== 1) continue;
      const n = c.localName;
      if (n === 't') s += c.textContent;
      else if (n === 'tab') s += '\t';
      else if (n === 'br' || n === 'cr') s += '\n';
      else if (n === 'Fallback' || n === 'delText' || n === 'instrText') continue;
      else if (n === 'txbxContent') { const sub = []; blocks(c, sub); s += '\n' + sub.join('\n') + '\n'; }
      else s += inline(c);
    }
    return s;
  };
  const table = (t, into) => {
    for (const tr of t.childNodes) {
      if (tr.localName !== 'tr') continue;
      const cells = [...tr.childNodes].filter(x => x.localName === 'tc').map(tc => { const sub = []; blocks(tc, sub); return sub.join(' ').replace(/\s+/g, ' ').trim(); });
      into.push('| ' + cells.join(' | ') + ' |');
    }
  };
  function blocks(node, into) {
    for (const c of node.childNodes) {
      if (c.nodeType !== 1) continue;
      if (c.localName === 'p') into.push(inline(c));
      else if (c.localName === 'tbl') table(c, into);
      else if (c.localName === 'sdt' || c.localName === 'sdtContent' || c.localName === 'body' || c.localName === 'hdr' || c.localName === 'ftr' || c.localName === 'customXml') blocks(c, into);
    }
  }
  blocks(doc.documentElement, lines);
  return lines.join('\n');
}
async function docxText(f) {
  const parts = await zipParts(f, n => n === 'word/document.xml' || /^word\/header\d*\.xml$/.test(n));
  const names = Object.keys(parts).filter(n => parts[n]).sort((a, b) => (a === 'word/document.xml') - (b === 'word/document.xml') || a.localeCompare(b));
  return names.map(n => wordXmlText(parts[n])).join('\n');
}

// Spreadsheet → one CSV line per row, matching what the finance parser expects.
async function sheetText(buf) {
  const X = await loadScript('/app/vendor/xlsx.mini.min.js', 'XLSX');
  const wb = X.read(new Uint8Array(buf), { type: 'array', cellNF: true, cellText: true, cellDates: false });
  const pad = n => String(n).padStart(2, '0');
  const cellText = cell => {
    if (!cell || cell.v == null) return '';
    if (cell.t === 'n' && cell.z && X.SSF.is_date(cell.z)) {
      const d = new Date(Math.round((cell.v - 25569) * 86400000));
      if (!isNaN(d)) return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
    }
    return String(cell.w != null ? cell.w : cell.v).trim();
  };
  const field = v => /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const out = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]; if (!ws || !ws['!ref']) continue;
    const r = X.utils.decode_range(ws['!ref']), rows = []; let minC = Infinity;
    for (let R = r.s.r; R <= r.e.r; R++) {
      const row = []; let any = false;
      for (let C = r.s.c; C <= r.e.c; C++) { const v = cellText(ws[X.utils.encode_cell({ r: R, c: C })]); row[C] = v; if (v) { any = true; if (C < minC) minC = C; } }
      if (any) rows.push(row);
    }
    rows.forEach(row => { const vals = []; for (let C = minC; C <= r.e.c; C++) vals.push(field(row[C] || '')); while (vals.length && !vals[vals.length - 1]) vals.pop(); out.push(vals.join(',')); });
  }
  return out.join('\n');
}
const scripts = {};
function loadScript(src, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  return scripts[src] || (scripts[src] = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.async = true;
    s.onload = () => window[globalName] ? res(window[globalName]) : rej(new Error('library failed to load'));
    s.onerror = () => { delete scripts[src]; rej(new Error('library failed to load')); };
    document.head.appendChild(s);
  }));
}

// ---------- AI (founders, when the firm has added an Anthropic API key) ----------
const hashStr = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36) + s.length.toString(36); };
async function sample(prompt, opts) {
  opts = opts || {};
  const tier = opts.modelTier || 'default', ck = `ai:${tier}:${hashStr(prompt)}`;
  if (opts.cache && !opts.cache.refresh) { const hit = await idb.get(ck); if (hit && Date.now() - hit.at < (opts.cache.gcTime || 0)) return { text: hit.text, modelTierApplied: tier }; }
  const res = await postJSON('/api/ai', { prompt, tier }, opts.signal);
  const reader = res.body.getReader(); let buf = '', text = '', stop = null;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const data = chunk.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('');
        if (!data) continue;
        let ev; try { ev = JSON.parse(data); } catch (e) { continue; }
        if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') { text += ev.delta.text; if (opts.onText) opts.onText({ text }); }
        else if (ev.type === 'message_delta' && ev.delta) stop = ev.delta.stop_reason;
        else if (ev.type === 'error') throw { code: (ev.error && ev.error.type) === 'overloaded_error' ? 'rate_limited' : 'ai_error', message: ev.error && ev.error.message, text };
      }
    }
  } catch (e) { if (e && e.name === 'AbortError') throw { code: 'cancelled', text }; throw e.code ? e : { code: 'interrupted', text }; }
  if (!text) throw { code: 'empty_completion', text };
  if (opts.cache) idb.set(ck, { text, at: Date.now() });
  return { text, modelTierApplied: tier, truncated: stop === 'max_tokens' };
}

const aiOn = !!(FE && FE.perms && FE.perms.ai && FE.aiEnabled);
window.claude = Object.freeze({ use: name => Promise.resolve(name === 'mcp' ? MCP : name === 'sample' ? (aiOn ? sample : null) : null) });

// ---------- helpers for the account menu ----------
window.FS = Object.freeze({
  user: FE, idb, request, postJSON,
  async signOut(everywhere) {
    try { await postJSON('/auth/logout', { everywhere: !!everywhere }); } catch (e) { /* continue */ }
    try { if (channel) channel.postMessage('signed-out'); } catch (e) {}
    await idb.clear();
    await dropShell().catch(() => {});
    location.replace('/login');
  }
});

// Pick up access changes made by a founder (role, disabled) without waiting for a reload.
setTimeout(async () => {
  try {
    const me = await (await request('/auth/me')).json();
    if (FE && (me.user.role !== FE.user.role || me.groups.join() !== FE.groups.join())) location.reload();
  } catch (e) { /* offline or signed out */ }
}, 4000);
})();
