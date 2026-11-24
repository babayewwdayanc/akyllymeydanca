#!/usr/bin/env bash
# Ежедневная резервная копия: база PostgreSQL (pg_dump) + фото игроков и данные анализа.
# Видео матчей не копируются — они большие; храните их отдельно (второй диск / облако).
# Cron (каждую ночь в 4:00):  0 4 * * * /opt/akylly/deploy/backup.sh >> /var/log/akylly-backup.log 2>&1
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/akylly}"
# DATABASE_URL и DATA_DIR берём из .env приложения
set -a
# shellcheck disable=SC1091
. "$APP_DIR/.env"
set +a

DATA_DIR="${DATA_DIR:-$APP_DIR/data}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%F)"

mkdir -p "$BACKUP_DIR"
pg_dump "$DATABASE_URL" --format=custom --file="$BACKUP_DIR/db-$STAMP.dump"
tar -czf "$BACKUP_DIR/files-$STAMP.tar.gz" -C "$DATA_DIR" photos thumbs analysis
find "$BACKUP_DIR" -type f -mtime +"$KEEP_DAYS" -delete
echo "$(date '+%F %T') бэкап готов: $BACKUP_DIR (*-$STAMP.*)"

# Восстановление базы из копии:
#   pg_restore --clean --if-exists --dbname="$DATABASE_URL" /opt/akylly/backups/db-ГГГГ-ММ-ДД.dump
