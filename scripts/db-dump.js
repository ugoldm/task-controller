#!/usr/bin/env node
// Печатает содержимое БД в консоль. Открывает базу только на чтение —
// безопасно запускать, пока приложение работает.
//
//   node scripts/db-dump.js            — все таблицы
//   node scripts/db-dump.js tasks      — только задачи (с именем стрима)
//   DB_PATH=/path/to.sqlite node scripts/db-dump.js
//
// В Docker:  docker compose exec app node scripts/db-dump.js

import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';

const DB_PATH = process.env.DB_PATH || 'data/task-controller.sqlite';
const which = process.argv[2]; // 'streams' | 'tasks' | 'meta' | undefined (всё)

if (!existsSync(DB_PATH)) {
  console.error(`❌ Файл БД не найден: ${DB_PATH}`);
  process.exit(1);
}

const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

function show(label, rows) {
  console.log(`\n=== ${label} (${rows.length}) ===`);
  if (rows.length) console.table(rows);
  else console.log('(пусто)');
}

if (!which || which === 'streams') {
  show('streams', db.prepare('SELECT id, name, color, type, position FROM streams ORDER BY position').all());
}
if (!which || which === 'tasks') {
  show(
    'tasks',
    db
      .prepare(
        `SELECT t.id, t.title, s.name AS stream, t.done, t.today, t.carry, t.deadline, t.position
         FROM tasks t LEFT JOIN streams s ON s.id = t.stream_id
         ORDER BY s.position, t.position`
      )
      .all()
  );
}
if (!which || which === 'meta') {
  show('meta', db.prepare('SELECT key, value FROM meta').all());
}

db.close();
