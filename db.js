import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS leads(
      id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT UNIQUE, name TEXT, email TEXT,
      event_id TEXT, call_start TEXT, call_end TEXT, invest TEXT, source TEXT,
      reschedule_url TEXT, status TEXT DEFAULT 'nuevo', ai_tag INTEGER DEFAULT 0,
      opted_out INTEGER DEFAULT 0, summary TEXT, notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS messages(
      id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, direction TEXT, text TEXT, ts TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS approvals(
      id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, kind TEXT, draft TEXT,
      status TEXT DEFAULT 'pendiente', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS followups(
      id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, kind TEXT, due_at TEXT, done INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT);
  `);
  const get = (sql, ...p) => raw.prepare(sql).get(...p);
  const all = (sql, ...p) => raw.prepare(sql).all(...p);
  const run = (sql, ...p) => {
    const r = raw.prepare(sql).run(...p);
    return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
  };
  return {
    raw, get, all, run,
    kv(k, v) {
      if (v === undefined) return get('SELECT v FROM kv WHERE k=?', k)?.v ?? null;
      run('INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v', k, String(v));
      return v;
    },
    leadByPhone: (phone) => get('SELECT * FROM leads WHERE phone=?', phone),
    addMsg: (phone, direction, text) => run('INSERT INTO messages(phone,direction,text) VALUES(?,?,?)', phone, direction, text),
    history: (phone, n = 20) => all('SELECT direction,text,ts FROM messages WHERE phone=? ORDER BY id DESC LIMIT ?', phone, n).reverse(),
    schedule: (phone, kind, due) => run('INSERT INTO followups(phone,kind,due_at) VALUES(?,?,?)', phone, kind, due.toISOString()),
    clearPending: (phone, kinds) => {
      const q = kinds.map(() => '?').join(',');
      run(`DELETE FROM followups WHERE phone=? AND done=0 AND kind IN (${q})`, phone, ...kinds);
    },
  };
}
