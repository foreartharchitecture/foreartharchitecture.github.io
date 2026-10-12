// One SQLite-backed Durable Object holds accounts, sign-in challenges, invite tokens,
// rate-limit counters, the activity log and a small cache. All methods are synchronous
// SQL, so each call runs atomically.
import { DurableObject } from 'cloudflare:workers';

const USER_COLS = ['username', 'email', 'name', 'role', 'status', 'client_salt', 'server_salt', 'pass_hash', 'last_login', 'invited_by'];

export class Store extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.migrate();
  }

  migrate() {
    const s = [
      `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT, email TEXT NOT NULL, name TEXT, role TEXT NOT NULL,
        status TEXT NOT NULL, client_salt TEXT, server_salt TEXT, pass_hash TEXT, sv INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER, updated_at INTEGER, last_login INTEGER, invited_by TEXT)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS users_username ON users(username COLLATE NOCASE) WHERE username IS NOT NULL`,
      `CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users(email COLLATE NOCASE)`,
      `CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, purpose TEXT, user_id TEXT, email TEXT, code_hash TEXT,
        data TEXT, attempts INTEGER NOT NULL DEFAULT 0, resends INTEGER NOT NULL DEFAULT 0, sent_at INTEGER, expires INTEGER)`,
      `CREATE TABLE IF NOT EXISTS tokens (hash TEXT PRIMARY KEY, purpose TEXT, user_id TEXT, email TEXT, data TEXT, expires INTEGER)`,
      `CREATE TABLE IF NOT EXISTS hits (k TEXT, t INTEGER)`,
      `CREATE INDEX IF NOT EXISTS hits_k ON hits(k, t)`,
      `CREATE TABLE IF NOT EXISTS events (t INTEGER, user_id TEXT, kind TEXT, detail TEXT, ip TEXT)`,
      `CREATE TABLE IF NOT EXISTS cache (k TEXT PRIMARY KEY, v TEXT, exp INTEGER)`
    ];
    s.forEach(q => this.sql.exec(q));
  }

  rows(q, ...a) { return this.sql.exec(q, ...a).toArray(); }
  one(q, ...a) { return this.rows(q, ...a)[0] || null; }

  // ---------- users ----------
  countUsers() { return this.one(`SELECT COUNT(*) AS n FROM users WHERE status = 'active'`).n; }
  countActiveFounders() { return this.one(`SELECT COUNT(*) AS n FROM users WHERE status = 'active' AND role = 'founder'`).n; }
  getUser({ id, login, email }) {
    if (id) return this.one(`SELECT * FROM users WHERE id = ?`, id);
    if (email) return this.one(`SELECT * FROM users WHERE email = ? COLLATE NOCASE`, email);
    if (login) return this.one(`SELECT * FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE ORDER BY username = ? COLLATE NOCASE DESC LIMIT 1`, login, login, login);
    return null;
  }
  usernameTaken(username, exceptId) {
    return !!this.one(`SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id != ?`, username, exceptId || '');
  }
  listUsers() {
    return this.rows(`SELECT id, username, email, name, role, status, created_at, updated_at, last_login, invited_by FROM users WHERE status != 'removed' ORDER BY status = 'active' DESC, role = 'founder' DESC, name COLLATE NOCASE`);
  }
  insertUser(u) {
    const t = Date.now();
    try {
      this.sql.exec(`INSERT INTO users (id, username, email, name, role, status, client_salt, server_salt, pass_hash, sv, created_at, updated_at, invited_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`, u.id, u.username || null, u.email, u.name || '', u.role, u.status,
        u.client_salt || null, u.server_salt || null, u.pass_hash || null, t, t, u.invited_by || null);
      return { ok: true };
    } catch (e) { return { ok: false, reason: /UNIQUE/i.test(String(e)) ? 'taken' : 'error' }; }
  }
  patchUser(id, patch, bumpSv) {
    const sets = [], vals = [];
    for (const k of USER_COLS) if (k in patch) { sets.push(`${k} = ?`); vals.push(patch[k]); }
    if (bumpSv) sets.push('sv = sv + 1');
    sets.push('updated_at = ?'); vals.push(Date.now());
    try { this.sql.exec(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, ...vals, id); }
    catch (e) { return { ok: false, reason: /UNIQUE/i.test(String(e)) ? 'taken' : 'error' }; }
    return { ok: true, user: this.getUser({ id }) };
  }
  // Cancels unused invitation/setup links and pending codes for an email address.
  dropPending(email) {
    this.sql.exec(`DELETE FROM tokens WHERE email = ? COLLATE NOCASE`, email);
    this.sql.exec(`DELETE FROM challenges WHERE email = ? COLLATE NOCASE`, email);
    return { ok: true };
  }
  // Removal keeps a record so a removed founder cannot re-create the account through founder setup.
  removeUser(id) {
    this.sql.exec(`UPDATE users SET status = 'removed', username = NULL, pass_hash = NULL, server_salt = NULL, client_salt = NULL, sv = sv + 1, updated_at = ? WHERE id = ?`, Date.now(), id);
    this.sql.exec(`DELETE FROM tokens WHERE user_id = ?`, id);
    return { ok: true };
  }

  // ---------- rate limits ----------
  hit(key, windowMs, max) {
    const t = Date.now();
    this.sql.exec(`DELETE FROM hits WHERE k = ? AND t < ?`, key, t - windowMs);
    const n = this.one(`SELECT COUNT(*) AS n FROM hits WHERE k = ?`, key).n;
    if (n >= max) return { ok: false, n };
    this.sql.exec(`INSERT INTO hits (k, t) VALUES (?, ?)`, key, t);
    return { ok: true, n: n + 1 };
  }

  // ---------- one-time codes ----------
  putChallenge(c) {
    this.prune();
    this.sql.exec(`INSERT INTO challenges (id, purpose, user_id, email, code_hash, data, attempts, resends, sent_at, expires) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
      c.id, c.purpose, c.user_id || null, c.email || null, c.code_hash, JSON.stringify(c.data || {}), Date.now(), c.expires);
    return { ok: true };
  }
  getChallenge(id) { const c = this.one(`SELECT * FROM challenges WHERE id = ?`, id); if (c) c.data = JSON.parse(c.data || '{}'); return c; }
  resendChallenge(id, codeHash, expires) {
    const c = this.getChallenge(id), t = Date.now();
    if (!c || c.expires < t) return { ok: false, reason: 'expired' };
    if (t - c.sent_at < 30000) return { ok: false, reason: 'wait', wait: Math.ceil((30000 - (t - c.sent_at)) / 1000) };
    if (c.resends >= 3) return { ok: false, reason: 'limit' };
    this.sql.exec(`UPDATE challenges SET code_hash = ?, attempts = 0, resends = resends + 1, sent_at = ?, expires = ? WHERE id = ?`, codeHash, t, expires, id);
    return { ok: true, challenge: c };
  }
  checkChallenge(id, purpose, codeHash) {
    const c = this.getChallenge(id), t = Date.now();
    if (!c || c.purpose !== purpose) return { ok: false, reason: 'wrong', left: 0 };
    if (c.expires < t) { this.sql.exec(`DELETE FROM challenges WHERE id = ?`, id); return { ok: false, reason: 'expired' }; }
    if (c.attempts >= 5) return { ok: false, reason: 'locked' };
    if (c.code_hash !== codeHash) {
      this.sql.exec(`UPDATE challenges SET attempts = attempts + 1 WHERE id = ?`, id);
      return { ok: false, reason: c.attempts + 1 >= 5 ? 'locked' : 'wrong', left: 4 - c.attempts };
    }
    this.sql.exec(`DELETE FROM challenges WHERE id = ?`, id);
    return { ok: true, challenge: c };
  }
  dropChallenge(id) { this.sql.exec(`DELETE FROM challenges WHERE id = ?`, id); return { ok: true }; }

  // ---------- invite / setup tokens (stored hashed) ----------
  putToken(t) {
    this.prune();
    if (t.user_id) this.sql.exec(`DELETE FROM tokens WHERE user_id = ? AND purpose = ?`, t.user_id, t.purpose);
    this.sql.exec(`INSERT OR REPLACE INTO tokens (hash, purpose, user_id, email, data, expires) VALUES (?, ?, ?, ?, ?, ?)`,
      t.hash, t.purpose, t.user_id || null, t.email || null, JSON.stringify(t.data || {}), t.expires);
    return { ok: true };
  }
  peekToken(hash, purpose) {
    const r = this.one(`SELECT * FROM tokens WHERE hash = ? AND purpose = ?`, hash, purpose);
    if (!r || r.expires < Date.now()) return null;
    r.data = JSON.parse(r.data || '{}'); return r;
  }
  takeToken(hash, purpose) { const r = this.peekToken(hash, purpose); if (r) this.sql.exec(`DELETE FROM tokens WHERE hash = ?`, hash); return r; }
  pendingInvites() { return this.rows(`SELECT user_id, email, expires FROM tokens WHERE purpose = 'invite' AND expires > ?`, Date.now()); }

  // ---------- activity log ----------
  log(e) {
    this.sql.exec(`INSERT INTO events (t, user_id, kind, detail, ip) VALUES (?, ?, ?, ?, ?)`, Date.now(), e.user_id || null, e.kind, String(e.detail || '').slice(0, 300), e.ip || null);
    return { ok: true };
  }
  events(limit = 60) { return this.rows(`SELECT * FROM events ORDER BY t DESC LIMIT ?`, Math.min(200, limit)); }

  // ---------- cache ----------
  cacheGet(k) { const r = this.one(`SELECT v, exp FROM cache WHERE k = ?`, k); return r && r.exp > Date.now() ? JSON.parse(r.v) : null; }
  cacheSet(k, v, ttlMs) { this.sql.exec(`INSERT OR REPLACE INTO cache (k, v, exp) VALUES (?, ?, ?)`, k, JSON.stringify(v), Date.now() + ttlMs); return { ok: true }; }

  prune() {
    const t = Date.now();
    this.sql.exec(`DELETE FROM challenges WHERE expires < ?`, t - 3600000);
    this.sql.exec(`DELETE FROM tokens WHERE expires < ?`, t);
    this.sql.exec(`DELETE FROM hits WHERE t < ?`, t - 86400000);
    this.sql.exec(`DELETE FROM cache WHERE exp < ?`, t);
    this.sql.exec(`DELETE FROM events WHERE t < (SELECT t FROM events ORDER BY t DESC LIMIT 1 OFFSET 999)`);
  }
}
