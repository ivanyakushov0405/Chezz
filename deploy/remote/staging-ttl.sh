#!/usr/bin/env bash
# Гашение staging по времени: chezz-staging-ttl.service (под flock -w 60) — OPERATIONS §9.6; design E02 П6.
# state/staging.started старше 12 ч → rm -sfv app-staging db-staging и удаление файла; иначе ничего. Код 0 / 1.
set -uo pipefail
umask 027

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

STARTED_FILE="$STATE_DIR/staging.started"
[ -f "$STARTED_FILE" ] || exit 0

STARTED="$(read_line "$STARTED_FILE")"
NOW="$(date -u +%s)"
# Нечитаемая отметка считается просроченной: staging без срока жизни хуже лишнего гашения.
EPOCH="$(date -u -d "$STARTED" +%s 2>/dev/null)" || EPOCH=0
[[ "$EPOCH" =~ ^[0-9]+$ ]] || EPOCH=0

if [ $((NOW - EPOCH)) -le "$STAGING_TTL_SECONDS" ]; then
  exit 0
fi

log "staging started at ${STARTED:-unknown}: older than 12 h, shutting down"
if ! staging_down; then
  err "staging rm failed"
  exit 1
fi
rm -f "$STARTED_FILE"
log "staging: down"
