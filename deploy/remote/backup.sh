#!/usr/bin/env bash
# Бэкап prod: backup.sh --reason daily|pre-deploy (OPERATIONS §14.1; design E02 П7).
# Запускают chezz-backup.service (под flock) и deploy.sh перед выкаткой (блокировку уже держит он).
# Режим offsite — есть deploy/backup.age.pub и B2_KEY_ID; до E20 не реализован (код 1). Иначе local:
# дамп в $CHEZZ_BACKUP_DIR (700) через .partial, остаются 3 новейших chezz-*.dump, state/last-backup при успехе.
# BACKUP_REQUIRE_OFFSITE из окружения перекрывает env/ops.env. Коды: 0 — успех, 1 — ошибка.
set -euo pipefail
umask 077

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

REASON=""
if [ "$#" = 2 ] && [ "$1" = --reason ]; then REASON="$2"; fi
case "$REASON" in
  daily | pre-deploy) ;;
  *) err "usage: backup.sh --reason daily|pre-deploy"; exit 1 ;;
esac

B2_KEY="$(env_get "$ENV_DIR/ops.env" B2_KEY_ID)"
if [ -n "${BACKUP_REQUIRE_OFFSITE+x}" ]; then
  REQUIRE="$BACKUP_REQUIRE_OFFSITE"
else
  REQUIRE="$(env_get "$ENV_DIR/ops.env" BACKUP_REQUIRE_OFFSITE)"
fi

if [ -f "$AGE_PUB" ] && [ -n "$B2_KEY" ]; then
  err "offsite: not implemented (E20)"
  exit 1
fi
if [ "$REQUIRE" = true ]; then
  err "backup mode is local, but BACKUP_REQUIRE_OFFSITE=true"
  exit 1
fi

if [ ! -d "$CHEZZ_BACKUP_DIR" ]; then
  mkdir -p "$(dirname "$CHEZZ_BACKUP_DIR")"
  mkdir -m 700 "$CHEZZ_BACKUP_DIR"
fi

NAME="chezz-$(date -u +%Y%m%dT%H%M%SZ)-$REASON.dump"
PART="$CHEZZ_BACKUP_DIR/$NAME.partial"
trap 'rm -f "$PART"' EXIT

ensure_compose_env_files
if ! compose exec -T db pg_dump -U app -d chezz -Fc > "$PART"; then
  err "pg_dump failed"
  exit 1
fi
if [ ! -s "$PART" ]; then
  err "pg_dump produced an empty dump"
  exit 1
fi
mv -f "$PART" "$CHEZZ_BACKUP_DIR/$NAME"
trap - EXIT

# 3 новейших (имя содержит время UTC — сортировка по имени), daily и pre-deploy вместе.
shopt -s nullglob
DUMPS=("$CHEZZ_BACKUP_DIR"/chezz-*.dump)
for ((i = 0; i < ${#DUMPS[@]} - 3; i++)); do rm -f "${DUMPS[$i]}"; done

write_state last-backup "$(now_iso)"
log "backup: $NAME size=$(wc -c < "$CHEZZ_BACKUP_DIR/$NAME" | tr -d '[:space:]') mode=local"
