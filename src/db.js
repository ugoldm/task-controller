import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DB_PATH = process.env.DB_PATH || 'data/task-controller.sqlite';
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS streams (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    color      TEXT NOT NULL,
    type       TEXT NOT NULL DEFAULT 'свой',
    position   INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    stream_id  TEXT NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
    done       INTEGER NOT NULL DEFAULT 0,
    today      INTEGER NOT NULL DEFAULT 1,
    carry      INTEGER NOT NULL DEFAULT 0,
    deadline   TEXT NOT NULL DEFAULT '',
    notes      TEXT NOT NULL DEFAULT '',
    position   INTEGER NOT NULL DEFAULT 0,
    closed_at  INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_stream ON tasks(stream_id);
`);

// Seed a first stream on a fresh DB so the app is usable immediately.
const streamCount = db.prepare('SELECT COUNT(*) AS n FROM streams').get().n;
if (streamCount === 0) {
  db.prepare(
    'INSERT INTO streams (id, name, color, type, position, created_at) VALUES (?,?,?,?,?,?)'
  ).run('s' + Date.now(), 'Мои задачи', '#4f46e5', 'свой', 0, Date.now());
}

export function getMeta(key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : null;
}
export function setMeta(key, value) {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}

function isoDay(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Daily rollover: on the first request of a new calendar day, drop every task
 * out of the "today" plan. Unfinished ones resurface in the morning review as
 * carried-over; the user rebuilds the plan from there. Returns today's ISO date.
 */
export function rolloverIfNewDay() {
  const today = isoDay();
  const last = getMeta('lastDay');
  if (last !== today) {
    db.prepare('UPDATE tasks SET today = 0 WHERE today = 1').run();
    setMeta('lastDay', today);
  }
  return today;
}

// --- serialization helpers (snake_case row -> camelCase client shape) ---
export function streamRow(r) {
  return { id: r.id, name: r.name, color: r.color, type: r.type, position: r.position };
}
export function taskRow(r) {
  return {
    id: r.id,
    title: r.title,
    stream: r.stream_id,
    done: !!r.done,
    today: !!r.today,
    carry: r.carry,
    deadline: r.deadline,
    notes: r.notes,
    position: r.position,
    closedAt: r.closed_at,
  };
}
