import express from 'express';
import cookieSession from 'cookie-session';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

// Load .env (no external dependency). Existing process env vars win.
function loadEnv(path = '.env') {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue; // skips blank lines and # comments
    let val = m[2];
    if (/^".*"$/.test(val) || /^'.*'$/.test(val)) val = val.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = val;
  }
}
loadEnv();
import {
  db,
  rolloverIfNewDay,
  streamRow,
  taskRow,
} from './src/db.js';
import { aiEnabled, parseTasksFromText } from './src/ai.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const isProd = process.env.NODE_ENV === 'production';

// В проде секреты обязательны — иначе сессию можно подделать / вход открыт.
if (isProd) {
  const missing = [];
  if (!APP_PASSWORD) missing.push('APP_PASSWORD');
  if (!process.env.SESSION_SECRET) missing.push('SESSION_SECRET');
  if (missing.length) {
    console.error(`❌ В production обязательны переменные: ${missing.join(', ')}. Запуск прерван.`);
    process.exit(1);
  }
} else if (!APP_PASSWORD) {
  console.warn('⚠️  APP_PASSWORD не задан — вход открыт (ок для localhost, недопустимо в проде).');
}

const app = express();
app.set('trust proxy', 1); // за Caddy: доверяем X-Forwarded-* (нужно для secure-cookie и req.ip)
app.use(express.json({ limit: '256kb' }));
app.use(
  cookieSession({
    name: 'tc_session',
    secret: process.env.SESSION_SECRET || 'dev-insecure-secret',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 дней
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd, // cookie только по HTTPS в проде; локально по http остаётся рабочей
  })
);

// Сравнение пароля за постоянное время (через SHA-256, без утечки длины).
function passwordMatches(input) {
  const a = crypto.createHash('sha256').update(String(input)).digest();
  const b = crypto.createHash('sha256').update(APP_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

// Простой in-memory rate-limit на вход: защита от перебора пароля.
const LOGIN_MAX = 5; // попыток
const LOGIN_WINDOW = 15 * 60 * 1000; // окно/блокировка — 15 минут
const loginAttempts = new Map(); // ip -> { count, first, blockedUntil }

function loginThrottle(req, res, next) {
  const rec = loginAttempts.get(req.ip);
  if (rec?.blockedUntil && Date.now() < rec.blockedUntil) {
    const retryAfter = Math.ceil((rec.blockedUntil - Date.now()) / 1000);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'too_many_attempts', retryAfter });
  }
  next();
}
function registerLoginFailure(ip) {
  const now = Date.now();
  let rec = loginAttempts.get(ip);
  if (!rec || now - rec.first > LOGIN_WINDOW) rec = { count: 0, first: now, blockedUntil: 0 };
  rec.count += 1;
  if (rec.count >= LOGIN_MAX) rec.blockedUntil = now + LOGIN_WINDOW;
  loginAttempts.set(ip, rec);
}

// --- auth ---
function requireAuth(req, res, next) {
  if (!APP_PASSWORD || req.session?.authed) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

app.get('/api/me', (req, res) => {
  res.json({ authed: !APP_PASSWORD || !!req.session?.authed, authRequired: !!APP_PASSWORD });
});
app.post('/api/login', loginThrottle, (req, res) => {
  if (!APP_PASSWORD) return res.json({ ok: true });
  if (passwordMatches(req.body?.password)) {
    loginAttempts.delete(req.ip);
    req.session.authed = true;
    return res.json({ ok: true });
  }
  registerLoginFailure(req.ip);
  res.status(401).json({ error: 'wrong_password' });
});
app.post('/api/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

// --- state (initial load + daily rollover) ---
app.get('/api/state', requireAuth, (req, res) => {
  const today = rolloverIfNewDay();
  const streams = db
    .prepare('SELECT * FROM streams ORDER BY position, created_at')
    .all()
    .map(streamRow);
  const tasks = db
    .prepare('SELECT * FROM tasks ORDER BY position, id')
    .all()
    .map(taskRow);
  res.json({ streams, tasks, today, aiEnabled });
});

// --- streams ---
app.post('/api/streams', requireAuth, (req, res) => {
  const { name, color = '#4f46e5', type = 'свой' } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'name_required' });
  const id = 's' + Date.now() + Math.floor(Math.random() * 1000);
  const pos = (db.prepare('SELECT MAX(position) AS m FROM streams').get().m ?? 0) + 1;
  db.prepare(
    'INSERT INTO streams (id, name, color, type, position, created_at) VALUES (?,?,?,?,?,?)'
  ).run(id, name.trim(), color, type, pos, Date.now());
  res.json(streamRow(db.prepare('SELECT * FROM streams WHERE id = ?').get(id)));
});

app.patch('/api/streams/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM streams WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  const name = req.body?.name?.trim() ?? existing.name;
  const color = req.body?.color ?? existing.color;
  const type = req.body?.type ?? existing.type;
  const collapsed = req.body?.collapsed !== undefined ? (req.body.collapsed ? 1 : 0) : existing.collapsed;
  db.prepare('UPDATE streams SET name = ?, color = ?, type = ?, collapsed = ? WHERE id = ?').run(
    name,
    color,
    type,
    collapsed,
    req.params.id
  );
  res.json(streamRow(db.prepare('SELECT * FROM streams WHERE id = ?').get(req.params.id)));
});

app.delete('/api/streams/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM streams WHERE id = ?').run(req.params.id); // tasks cascade
  res.json({ ok: true });
});

// --- tasks ---
app.post('/api/tasks', requireAuth, (req, res) => {
  const { title, streamId, today = true } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'title_required' });
  const stream = db.prepare('SELECT id FROM streams WHERE id = ?').get(streamId);
  if (!stream) return res.status(400).json({ error: 'invalid_stream' });
  const pos =
    (db.prepare('SELECT MAX(position) AS m FROM tasks WHERE stream_id = ?').get(streamId).m ?? 0) + 1;
  const info = db
    .prepare(
      'INSERT INTO tasks (title, stream_id, done, today, carry, deadline, notes, position, created_at) VALUES (?,?,0,?,0,?,?,?,?)'
    )
    .run(title.trim(), streamId, today ? 1 : 0, '', '', pos, Date.now());
  res.json(taskRow(db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid)));
});

app.patch('/api/tasks/:id', requireAuth, (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'not_found' });
  const b = req.body || {};

  const next = {
    title: b.title !== undefined ? String(b.title) : t.title,
    stream_id: b.stream !== undefined ? b.stream : t.stream_id,
    done: b.done !== undefined ? (b.done ? 1 : 0) : t.done,
    today: b.today !== undefined ? (b.today ? 1 : 0) : t.today,
    deadline: b.deadline !== undefined ? String(b.deadline) : t.deadline,
    notes: b.notes !== undefined ? String(b.notes) : t.notes,
    carry: b.incrementCarry ? t.carry + 1 : t.carry,
    closed_at: t.closed_at,
  };
  // Stamp close order when a task transitions to done.
  if (next.done && !t.done) next.closed_at = Date.now();
  if (!next.done) next.closed_at = null;

  db.prepare(
    'UPDATE tasks SET title=?, stream_id=?, done=?, today=?, deadline=?, notes=?, carry=?, closed_at=? WHERE id=?'
  ).run(
    next.title,
    next.stream_id,
    next.done,
    next.today,
    next.deadline,
    next.notes,
    next.carry,
    next.closed_at,
    req.params.id
  );
  res.json(taskRow(db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id)));
});

app.delete('/api/tasks/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Reorder a stream's tasks: body { orderedIds: [...] } in the desired order.
app.post('/api/tasks/reorder', requireAuth, (req, res) => {
  const ids = req.body?.orderedIds;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'orderedIds_required' });
  const upd = db.prepare('UPDATE tasks SET position = ? WHERE id = ?');
  const tx = db.transaction((list) => list.forEach((id, i) => upd.run(i, id)));
  tx(ids);
  res.json({ ok: true });
});

// --- AI: parse free-form text into tasks (Claude if key set, else heuristic) ---
function heuristicSplit(text, streams) {
  const fallbackId = streams[0]?.id;
  return text
    .replace(/\bа\s+ещё\b/gi, '\n')
    .replace(/\bещё\b/gi, '\n')
    .replace(/\bтакже\b/gi, '\n')
    .replace(/\bне\s+забыть\b/gi, '\n')
    .replace(/\bпотом\b/gi, '\n')
    .split(/[\n;.!?]+/)
    .map((p) => p.replace(/^[\s,–-]*(и|а|нужно|надо)\s+/i, '').trim())
    .filter((p) => p.length > 5)
    .map((p) => ({ title: p.charAt(0).toUpperCase() + p.slice(1), streamId: fallbackId }));
}

app.post('/api/ai/parse', requireAuth, async (req, res) => {
  const text = (req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text_required' });
  const streams = db
    .prepare('SELECT * FROM streams ORDER BY position, created_at')
    .all()
    .map(streamRow);
  if (!streams.length) return res.status(400).json({ error: 'no_streams' });

  if (aiEnabled) {
    try {
      const tasks = await parseTasksFromText(text, streams);
      return res.json({ tasks, source: 'ai' });
    } catch (err) {
      console.error('AI parse failed, falling back to heuristic:', err.message);
    }
  }
  res.json({ tasks: heuristicSplit(text, streams), source: 'heuristic' });
});

// --- static frontend ---
app.use(express.static(join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Task Controller → http://localhost:${PORT}`);
  console.log(aiEnabled ? '🤖 AI-разбор включён (Claude).' : 'ℹ️  AI-разбор выключен (нет ANTHROPIC_API_KEY) — эвристика.');
});
