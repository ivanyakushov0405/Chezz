#!/usr/bin/env bash
# Команды VPS: deploy.sh <prod|staging> <команда> [аргументы] (OPERATIONS §9.3–§9.6, §11; design E02 П3–П8, A2–A5, A9).
# Запускается только из entry.sh (копия во временном каталоге, под flock; status — без блокировки).
# Аргументы уже проверены entry.sh по белому списку. Секреты — stdin; не печатаются, не попадают в argv.
# Порядок prod deploy: все проверки (2, 3, 6, 8, 5) до первого изменения state, env и клона (П6).
set -uo pipefail
umask 027

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

ENV_NAME="${1:-}"
shift || true

RESULT_DONE=0
finish() {
  RESULT_DONE=1
  printf 'result=%s\n' "$(result_name "$1" "$ENV_NAME")"
  exit "$1"
}

# Аварийный выход без finish (ошибка bash, сигнал): состояние неизвестно — broken (prod) / up_failed (staging).
on_exit() {
  local rc=$?
  [ "$RESULT_DONE" = 1 ] && return
  err "unexpected exit with code $rc"
  if [ "$ENV_NAME" = prod ]; then finish 4; else finish 1; fi
}
trap on_exit EXIT

REG=""
# 1 — шаг 7 переключил клон (или начал переключать): только тогда restore_prev возвращает его на prod.repo.prev.
CLONE_SWITCHED=0
need_registry() {
  REG="$(registry)" || { err "cannot derive image owner from remote.origin.url"; finish 2; }
}

append_history() { printf '%s %s %s %s\n' "$(now_iso)" "$1" "$2" "$3" >> "$STATE_DIR/prod.history"; }

# set_prod_app_image <digest> — PROD_APP_IMAGE в compose.prod.env, прочие строки без изменений.
set_prod_app_image() {
  local f="$ENV_DIR/compose.prod.env" line
  {
    if [ -f "$f" ]; then
      while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in PROD_APP_IMAGE=* | '') ;; *) printf '%s\n' "$line" ;; esac
      done < "$f"
    fi
    printf 'PROD_APP_IMAGE=%s/chezz-app@%s\n' "$REG" "$1"
  } | atomic_write "$f" 640
}

# restore_prev <digest> <1|0 вернуть клон> — OPERATIONS §9.5; 0 — успех, 4 — откат не прошёл.
restore_prev() {
  local target="$1" with_clone="$2" ref rev prev_repo
  ref="$REG/chezz-app@$target"
  log "restore: target $target"
  if [ "$with_clone" = 1 ]; then
    prev_repo="$(read_line "$STATE_DIR/prod.repo.prev")"
    if ! [[ "$prev_repo" =~ $SHA_RE ]] || ! git -C "$REPO" checkout -q --detach "$prev_repo"; then
      err "restore: cannot return the clone to prod.repo.prev"
      return 4
    fi
  fi
  docker pull -q "$ref" || { err "restore: docker pull failed"; return 4; }
  rev="$(image_revision "$ref")" || { err "restore: no revision label"; return 4; }
  write_state prod.image "$target" || return 4
  set_prod_app_image "$target" || return 4
  append_history "$target" "$rev" restore
  compose up -d --wait --wait-timeout 120 app || { err "restore: app is not healthy"; return 4; }
  run_checks "$rev" || { err "restore: checks failed"; return 4; }
  log "restore: ok"
  return 0
}

# --- prod deploy (П6) ----------------------------------------------------------------------------------
prod_deploy() {
  local sha="$1" digest="$2" base="$3" force="${4:-}" head games allow ref rev require old_image old_prev
  local had_current=0 code

  # 1. Форма секретов (ключи по allowlist — после fetch, см. 3а).
  read_secrets || finish 2
  need_registry

  # 2. Занятость.
  games="$(prod_games_active)"
  if [ "$games" -gt 10 ] && [ "$force" != force ]; then
    log "prod is busy: chezz_games_active=$games"
    finish 3
  fi

  # 3. База и предок.
  head="$(git -C "$REPO" rev-parse HEAD 2>/dev/null)" || { err "cannot read clone HEAD"; finish 2; }
  if [ "$base" != bootstrap ] && [ "$head" != "$base" ]; then
    log "base mismatch: clone $head, plan $base"
    finish 6
  fi
  git -C "$REPO" fetch -q origin main || { err "git fetch origin main failed"; finish 2; }
  if ! git -C "$REPO" merge-base --is-ancestor "$sha" origin/main 2>/dev/null; then
    err "$sha is not an ancestor of origin/main"
    finish 2
  fi

  # 3а. Секреты по allowlist целевого коммита: новый ключ приходит вместе со своей строкой allowlist.
  allow="$(git -C "$REPO" show "$sha:deploy/env.allowlist" 2>/dev/null)" || { err "no deploy/env.allowlist in $sha"; finish 2; }
  parse_allowlist prod ops <<< "$allow" || finish 2
  check_secrets prod || finish 2

  # 4. Образ и его метка.
  ref="$REG/chezz-app@$digest"
  docker pull -q "$ref" || { err "docker pull $ref failed"; finish 8; }
  rev="$(image_revision "$ref")" || { err "no revision label on $ref"; finish 2; }
  if [ "$rev" != "$sha" ]; then
    err "image revision $rev != $sha"
    finish 2
  fi

  # 5. Бэкап перед выкаткой. Пустые compose-файлы окружения нужны любому вызову compose (OPERATIONS §5).
  ensure_compose_env_files || { err "cannot create empty compose env files"; finish 2; }
  if svc_running db; then
    require="${SEC[BACKUP_REQUIRE_OFFSITE]:-false}"
    if ! BACKUP_REQUIRE_OFFSITE="$require" bash "$HERE/backup.sh" --reason pre-deploy; then
      err "pre-deploy backup failed"
      finish 5
    fi
    log "backup=ok"
  else
    log "backup=skipped_no_db"
  fi

  # --- Дальше — изменения. ---
  old_image="$(read_line "$STATE_DIR/prod.image")"
  old_prev="$(read_line "$STATE_DIR/prod.image.prev")"
  [[ "$old_image" =~ $DIGEST_RE ]] && had_current=1

  if deploy_apply "$sha" "$digest" "$head" "$old_image"; then
    docker image prune -af --filter until=168h > /dev/null || log "warning: image prune failed"
    log "deploy: ok $digest $sha"
    finish 0
  fi

  # 12. Провал.
  if [ "$had_current" = 1 ]; then
    # Прежний prev возвращается на место: следующий rollback ведёт к образу до прежнего.
    if [[ "$old_prev" =~ $DIGEST_RE ]]; then write_state prod.image.prev "$old_prev"; else rm -f "$STATE_DIR/prod.image.prev"; fi
    restore_prev "$old_image" "$CLONE_SWITCHED"
    code=$?
    [ "$code" = 0 ] && finish 1
    finish 4
  fi
  # A4: первой выкатке некуда откатываться.
  log "restore=no_prev"
  compose stop app || err "stop app failed"
  git -C "$REPO" checkout -q --detach "$head" || err "cannot return the clone to $head"
  rm -f "$STATE_DIR/prod.image"
  finish 4
}

# deploy_apply <sha> <digest> <head> <прежний digest> — шаги 6–11; код ≠ 0 — провал.
deploy_apply() {
  local sha="$1" digest="$2" head="$3" old_image="$4" old_ref
  # 6. env-файлы; PROD_APP_IMAGE прежний.
  old_ref="$(env_get "$ENV_DIR/compose.prod.env" PROD_APP_IMAGE)"
  emit_section prod | atomic_write "$ENV_DIR/prod.env" 600 || { err "write prod.env failed"; return 1; }
  emit_section ops $COMPOSE_PROD_KEYS | atomic_write "$ENV_DIR/ops.env" 640 || { err "write ops.env failed"; return 1; }
  {
    local k
    for k in $COMPOSE_PROD_KEYS; do
      if [ -n "${SEC[$k]-}" ]; then printf '%s=%s\n' "$k" "${SEC[$k]}"; fi
    done
    if [ -n "$old_ref" ]; then printf 'PROD_APP_IMAGE=%s\n' "$old_ref"; fi
  } | atomic_write "$ENV_DIR/compose.prod.env" 640 || { err "write compose.prod.env failed"; return 1; }
  log "env: written"

  # 7. Клон.
  write_state prod.repo.prev "$head" || return 1
  CLONE_SWITCHED=1
  git -C "$REPO" checkout -q --detach "$sha" || { err "git checkout $sha failed"; return 1; }
  log "clone: $sha"

  # 8. Состояние.
  if [ -n "$old_image" ]; then write_state prod.image.prev "$old_image" || return 1; fi
  write_state prod.image "$digest" || return 1
  set_prod_app_image "$digest" || return 1
  append_history "$digest" "$sha" deploy

  # 9. staging гасится.
  if svc_running app-staging || svc_running db-staging; then
    staging_down || log "warning: staging down failed"
  fi

  # 10. Подъём.
  compose up -d --wait --wait-timeout 120 edge db app || { err "up edge db app failed"; return 1; }

  # 11. Проверки.
  run_checks "$sha" || { err "checks failed"; return 1; }
}

# --- prod rollback (§9.5) ------------------------------------------------------------------------------
prod_rollback() {
  local arg="${1:-}" target="" cur ref rev d code
  if [ -n "$arg" ]; then
    if [ -f "$STATE_DIR/prod.history" ]; then
      while IFS=' ' read -r _ d _ _ || [ -n "${d:-}" ]; do
        [ "$d" = "$arg" ] && target="$arg"
      done < "$STATE_DIR/prod.history"
    fi
    [ -n "$target" ] || { err "$arg is not in prod.history"; finish 2; }
  else
    target="$(read_line "$STATE_DIR/prod.image.prev")"
    [[ "$target" =~ $DIGEST_RE ]] || { err "no prod.image.prev"; finish 2; }
  fi
  need_registry
  ref="$REG/chezz-app@$target"
  docker pull -q "$ref" || { err "docker pull $ref failed"; finish 4; }
  rev="$(image_revision "$ref")" || { err "no revision label on $ref"; finish 4; }
  ensure_compose_env_files || { err "cannot create empty compose env files"; finish 4; }
  cur="$(read_line "$STATE_DIR/prod.image")"
  if [[ "$cur" =~ $DIGEST_RE ]]; then write_state prod.image.prev "$cur" || finish 4; fi
  append_history "$target" "$rev" rollback
  restore_prev "$target" 0
  code=$?
  finish "$code"
}

# --- status (§9.3, П8, A9) -----------------------------------------------------------------------------
container_field() { docker inspect -f "$2" "$1" 2>/dev/null; }

trim_time() {
  local t="${1//[[:space:]]/}"
  [ -n "$t" ] || { printf 'none'; return; }
  case "$t" in *.*Z) t="${t%%.*}Z" ;; esac
  printf '%s' "$t"
}

container_status() { # <контейнер> → STATUS_HEALTH, STATUS_RESTARTS, STATUS_STARTED
  local h
  STATUS_HEALTH=absent STATUS_RESTARTS=0 STATUS_STARTED=none
  h="$(container_field "$1" '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}')" || return 0
  h="${h//[[:space:]]/}"
  case "$h" in healthy | unhealthy | starting) STATUS_HEALTH="$h" ;; *) STATUS_HEALTH=unhealthy ;; esac
  STATUS_RESTARTS="$(container_field "$1" '{{.RestartCount}}')"
  STATUS_RESTARTS="${STATUS_RESTARTS//[[:space:]]/}"
  [[ "$STATUS_RESTARTS" =~ ^[0-9]+$ ]] || STATUS_RESTARTS=0
  STATUS_STARTED="$(trim_time "$(container_field "$1" '{{.State.StartedAt}}')")"
}

staging_state() { if svc_running app-staging; then printf 'up'; else printf 'down'; fi; }

repo_head() { git -C "$REPO" rev-parse HEAD 2>/dev/null || printf 'none'; }

backup_mode() {
  local key
  key="$(env_get "$ENV_DIR/ops.env" B2_KEY_ID)"
  if [ -f "$AGE_PUB" ] && [ -n "$key" ]; then printf 'offsite'; else printf 'local'; fi
}

prod_status() {
  local image rev="none" m players=0 games=0 last disk="" reg _fs _b _u _a cap
  image="$(read_line "$STATE_DIR/prod.image")"
  if [[ "$image" =~ $DIGEST_RE ]]; then
    if reg="$(registry)"; then rev="$(image_revision "$reg/chezz-app@$image")" || rev="none"; fi
  else
    image="none"
  fi
  container_status "$PROD_CONTAINER"
  if m="$(prod_metrics)"; then
    players="$(metric_int chezz_players_online <<< "$m")"
    games="$(metric_int chezz_games_active <<< "$m")"
  fi
  last="$(read_line "$STATE_DIR/last-backup")"
  [ -n "$last" ] || last="none"
  while read -r _fs _b _u _a cap _; do disk="${cap%\%}"; done < <(df -P "$CHEZZ_ROOT" 2>/dev/null | tail -n +2)
  [[ "$disk" =~ ^[0-9]+$ ]] || disk="none"
  printf 'env=prod\nimage=%s\nrevision=%s\nrepo=%s\nhealth=%s\nrestarts=%s\nstarted_at=%s\n' \
    "$image" "$rev" "$(repo_head)" "$STATUS_HEALTH" "$STATUS_RESTARTS" "$STATUS_STARTED"
  printf 'players_online=%s\ngames_active=%s\nbackup_mode=%s\nlast_backup=%s\ndisk_used_pct=%s\nstaging=%s\n' \
    "$players" "$games" "$(backup_mode)" "$last" "$disk" "$(staging_state)"
  finish 0
}

staging_status() {
  local app tools started
  app="$(digest_of "$(env_get "$ENV_DIR/compose.staging.env" STAGING_APP_IMAGE)")"
  tools="$(digest_of "$(env_get "$ENV_DIR/compose.staging.env" STAGING_TOOLS_IMAGE)")"
  container_status "$STAGING_CONTAINER"
  started="$(read_line "$STATE_DIR/staging.started")"
  printf 'env=staging\nimage=%s\ntools_image=%s\nrepo=%s\nhealth=%s\nrestarts=%s\nstarted_at=%s\nstaging=%s\n' \
    "${app:-none}" "${tools:-none}" "$(repo_head)" "$STATUS_HEALTH" "$STATUS_RESTARTS" "${started:-none}" "$(staging_state)"
  finish 0
}

# --- staging (§9.6, §11) -------------------------------------------------------------------------------
staging_up() {
  local app="$1" tools="$2" app_ref tools_ref allow
  if [ ! -f "$STATE_DIR/prod.image" ]; then
    err "prod is not deployed yet (no state/prod.image)"
    finish 7
  fi
  read_secrets || finish 2
  allow="$(cat "$ALLOWLIST_FILE" 2>/dev/null)" || { err "no deploy/env.allowlist in the clone"; finish 2; }
  parse_allowlist staging <<< "$allow" || finish 2
  check_secrets staging || finish 2
  need_registry
  app_ref="$REG/chezz-app-staging@$app"
  tools_ref="$REG/chezz-tools-staging@$tools"
  docker pull -q "$app_ref" || { err "docker pull $app_ref failed"; finish 8; }
  docker pull -q "$tools_ref" || { err "docker pull $tools_ref failed"; finish 8; }

  emit_section staging | atomic_write "$ENV_DIR/staging.env" 600 || { err "write staging.env failed"; finish 1; }
  printf 'STAGING_APP_IMAGE=%s\nSTAGING_TOOLS_IMAGE=%s\n' "$app_ref" "$tools_ref" |
    atomic_write "$ENV_DIR/compose.staging.env" 640 || { err "write compose.staging.env failed"; finish 1; }
  log "env: written"
  staging_down || { err "staging rm failed"; finish 1; }
  compose --profile staging up -d --wait --wait-timeout 120 app-staging db-staging || { err "staging up failed"; finish 1; }
  compose --profile staging run --rm -T tools-staging node apps/server/scripts/seed.ts --demo || { err "seed --demo failed"; finish 1; }
  write_state staging.started "$(now_iso)" || finish 1
  log "staging: up $app $tools"
  finish 0
}

staging_load() {
  local games rc=0
  ensure_compose_env_files || { err "cannot create empty compose env files"; finish 1; }
  svc_running app-staging || { err "app-staging is not running"; finish 2; }
  games="$(prod_games_active)"
  if [ "$games" -gt 2 ]; then
    log "prod is busy: chezz_games_active=$games"
    finish 3
  fi
  log "report_begin"
  # shellcheck disable=SC2016 # $APP_ORIGIN раскрывается в контейнере (staging.env).
  compose --profile staging run --rm -T -e LOAD_REPORT=/tmp/report.json tools-staging sh -c \
    'node apps/server/scripts/seed.ts --load 150 --tokens /tmp/tokens && LOAD_TOKENS=/tmp/tokens LOAD_BASE_URL="$APP_ORIGIN" node tests/load/run.ts; rc=$?; cat /tmp/report.json; exit $rc' ||
    rc=$?
  log "report_end"
  [ "$rc" = 0 ] || { err "load generator exited with code $rc"; finish 1; }
  finish 0
}

staging_cmd_down() {
  staging_down || { err "staging rm failed"; finish 1; }
  log "staging: down"
  finish 0
}

# --- Разбор --------------------------------------------------------------------------------------------
SUB="${1:-}"
shift || true
case "$ENV_NAME:$SUB" in
  prod:deploy) prod_deploy "$@" ;;
  prod:rollback) prod_rollback "$@" ;;
  prod:status) prod_status ;;
  staging:up) staging_up "$@" ;;
  staging:down) staging_cmd_down ;;
  staging:load) staging_load ;;
  staging:status) staging_status ;;
  *) err "unknown command"; finish 2 ;;
esac
