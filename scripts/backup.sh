#!/usr/bin/env bash
# Снимает бэкап БД из работающего контейнера и кладёт на хост, с ротацией.
# Запускать на СЕРВЕРЕ из любого места; пути считаются от корня проекта.
#
#   ./scripts/backup.sh
#   BACKUP_DIR=/root/backups KEEP=30 ./scripts/backup.sh
#
# Для cron см. DEPLOY.md → «Автобэкап».
set -euo pipefail

# Корень проекта (на уровень выше scripts/), чтобы docker compose нашёл compose-файл.
cd "$(dirname "$0")/.."

BACKUP_DIR="${BACKUP_DIR:-$HOME/task-controller-backups}"
KEEP="${KEEP:-14}"          # сколько последних копий хранить
STAMP="$(date +%Y-%m-%d_%H%M%S)"
TMP="data/_backup_${STAMP}.sqlite"   # путь внутри контейнера (том /app/data)

mkdir -p "$BACKUP_DIR"

# 1. Снять консистентную копию внутри контейнера
docker compose exec -T app node scripts/backup.js "$TMP"

# 2. Скопировать её на хост
docker compose cp "app:/app/${TMP}" "${BACKUP_DIR}/tc-${STAMP}.sqlite"

# 3. Удалить временную копию внутри контейнера
docker compose exec -T app rm -f "$TMP"

# 4. Ротация: оставить только последние $KEEP
ls -1t "${BACKUP_DIR}"/tc-*.sqlite 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f

echo "✅ Бэкап готов: ${BACKUP_DIR}/tc-${STAMP}.sqlite"
