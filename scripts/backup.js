#!/usr/bin/env node
// Онлайн-бэкап БД через встроенный механизм SQLite (безопасно при работающем app).
// Запускается внутри контейнера: node scripts/backup.js <dest-path>
import Database from 'better-sqlite3';

const src = process.env.DB_PATH || 'data/task-controller.sqlite';
const dest = process.argv[2];
if (!dest) {
  console.error('usage: node scripts/backup.js <dest>');
  process.exit(1);
}

const db = new Database(src, { readonly: true, fileMustExist: true });
await db.backup(dest); // консистентная копия даже при активной записи (WAL)
db.close();
console.log('backup ->', dest);
