#!/usr/bin/env bash
# Вход SSH-ключа CI (command= в authorized_keys): entry.sh <prod|staging> (OPERATIONS §9.3; design E02 П3; ADR-0011).
# Команда — из $SSH_ORIGINAL_COMMAND по белому списку; секреты — stdin (читает deploy.sh).
# Копирует deploy/remote/ в mktemp -d и выполняет копию (EC-29): правка клона во время команды на неё не влияет.
# Команды, кроме status, — под setsid и одной блокировкой flock на $CHEZZ_ROOT/state/lock (A5).
# Журнал — state/last-<среда>.log (перезаписывается); stdout — тот же журнал; последняя строка — result=<имя>.
set -uo pipefail
umask 027

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

ENV_NAME="${1:-}"
case "$ENV_NAME" in
  prod | staging) ;;
  *) printf 'error: unknown environment\nresult=bad_command\n'; exit 2 ;;
esac
JOURNAL="$STATE_DIR/last-$ENV_NAME.log"

# note_journal <строки…> — дописать строки в журнал без блокировки (отказ до запуска: bad_command, locked).
# Журнал не обнуляется: его может писать работающая под блокировкой команда.
note_journal() { printf '%s\n' "$@" >> "$JOURNAL" 2>/dev/null || true; }

# reject <причина> — код 2 без каких-либо действий, кроме строки в журнале.
reject() {
  local msg="error: $1"
  note_journal "$msg" "result=bad_command"
  printf '%s\nresult=bad_command\n' "$msg"
  exit 2
}

CMD="${SSH_ORIGINAL_COMMAND-}"
# Только [a-z0-9:] и пробел: метасимволы, перевод строки, верхний регистр — отказ.
if [ -z "$CMD" ] || [[ "$CMD" == *[!a-z0-9:\ ]* ]]; then reject "command is not allowed"; fi
IFS=' ' read -r -a ARGV <<< "$CMD"
N="${#ARGV[@]}"
SUB="${ARGV[0]:-}"

is_sha() { [[ "$1" =~ $SHA_RE ]]; }
is_digest() { [[ "$1" =~ $DIGEST_RE ]]; }

ok=0
case "$ENV_NAME:$SUB" in
  prod:deploy)
    if { [ "$N" = 4 ] || { [ "$N" = 5 ] && [ "${ARGV[4]}" = force ]; }; } &&
      is_sha "${ARGV[1]}" && is_digest "${ARGV[2]}" && { is_sha "${ARGV[3]}" || [ "${ARGV[3]}" = bootstrap ]; }; then
      ok=1
    fi
    ;;
  prod:rollback)
    if [ "$N" = 1 ] || { [ "$N" = 2 ] && is_digest "${ARGV[1]}"; }; then ok=1; fi
    ;;
  staging:up)
    if [ "$N" = 3 ] && is_digest "${ARGV[1]}" && is_digest "${ARGV[2]}"; then ok=1; fi
    ;;
  prod:status | staging:status | staging:down | staging:load)
    [ "$N" = 1 ] && ok=1
    ;;
esac
[ "$ok" = 1 ] || reject "command is not allowed for $ENV_NAME"

COPY="$(mktemp -d)" || reject "mktemp failed"
FINISHED=0
# Копию удаляет только завершившийся entry: после обрыва SSH её ещё выполняет процесс под setsid.
trap '[ "$FINISHED" = 1 ] && rm -rf "$COPY"' EXIT
cp -R "$HERE/." "$COPY/" || reject "copy of deploy/remote failed"

# Вывод этого запуска — в свой файл копии: stdout entry не зависит от журнала, который может писать другая команда.
OUT="$COPY/.output"
# Под блокировкой: журнал обнуляется и пишется (tee) только владельцем блокировки.
# shellcheck disable=SC2016 # аргументы раскрывает bash -c.
LOCKED_RUN='j=$1; s=$2; shift 2; : > "$j"; bash "$s" "$@" 2>&1 | tee -a "$j"; exit "${PIPESTATUS[0]}"'

rc=0
if [ "$SUB" = status ]; then
  # status только читает: журнал не трогает.
  bash "$COPY/deploy.sh" "$ENV_NAME" "${ARGV[@]}" > "$OUT" 2>&1 || rc=$?
else
  setsid flock -w 900 -E 9 "$LOCK_FILE" bash -c "$LOCKED_RUN" _ "$JOURNAL" "$COPY/deploy.sh" "$ENV_NAME" "${ARGV[@]}" \
    > "$OUT" 2>&1 || rc=$?
fi
FINISHED=1

last=""
while IFS= read -r line; do [ -n "$line" ] && last="$line"; done < "$OUT"
if [[ "$last" != result=* ]]; then
  if [ "$rc" = 9 ]; then
    # Блокировку держит другая команда: deploy.sh не запускался, ничего не изменено.
    msg="error: lock $LOCK_FILE is busy for 900 s"
    note_journal "$msg" "result=locked"
  else
    # deploy.sh завершается через finish или ловушку EXIT; сюда — только при сбое самого запуска.
    msg="error: deploy.sh exited with code $rc without result"
    if [ "$ENV_NAME" = prod ]; then rc=4; else rc=1; fi
  fi
  printf '%s\nresult=%s\n' "$msg" "$(result_name "$rc" "$ENV_NAME")" >> "$OUT"
fi
cat "$OUT"
exit "$rc"
