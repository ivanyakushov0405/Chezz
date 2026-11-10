# shellcheck shell=bash
# Общая библиотека скриптов VPS deploy/remote/*.sh (OPERATIONS §9.3–§9.6, §14.1; design E02 П2–П8; ADR-0011).
# Подключается через `.`; сама ничего не выполняет, кроме определения путей.
# Правила: секреты не печатаются и не попадают в argv внешних команд; трассировка shell запрещена (SECURITY §17).
# Внешние команды — только по имени из PATH (тесты подменяют docker, curl, flock, setsid, sleep, df).

export LC_ALL=C

CHEZZ_ROOT="${CHEZZ_ROOT:-/srv/chezz}"
CHEZZ_BACKUP_DIR="${CHEZZ_BACKUP_DIR:-/var/backups/chezz}"
REPO="$CHEZZ_ROOT/repo"
ENV_DIR="$CHEZZ_ROOT/env"
STATE_DIR="$CHEZZ_ROOT/state"
LOCK_FILE="$STATE_DIR/lock"
COMPOSE_FILE="$REPO/deploy/compose.yml"
ALLOWLIST_FILE="$REPO/deploy/env.allowlist"
AGE_PUB="$REPO/deploy/backup.age.pub"

SHA_RE='^[0-9a-f]{40}$'
DIGEST_RE='^sha256:[0-9a-f]{64}$'

PROD_METRICS_URL="http://127.0.0.1:9464/metrics"
PROD_CONTAINER="chezz-app-1"
STAGING_CONTAINER="chezz-app-staging-1"
# Ключи [ops], которые идут в compose.prod.env (интерполяция edge), остальные [ops] — в ops.env (П4).
COMPOSE_PROD_KEYS="APP_DOMAIN ACME_EMAIL SENTRY_INGEST"
STAGING_TTL_SECONDS=43200

# Значения образов и доменов берутся только из env-файлов compose: переменная окружения их перекрыла бы.
unset PROD_APP_IMAGE STAGING_APP_IMAGE STAGING_TOOLS_IMAGE APP_DOMAIN ACME_EMAIL SENTRY_INGEST

log() { printf '%s\n' "$*"; }
err() { printf 'error: %s\n' "$*"; }

now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# result_name <код> <среда> — имя для строки result= (OPERATIONS §9.3).
result_name() {
  case "$1" in
    0) printf 'ok' ;;
    1) if [ "$2" = prod ]; then printf 'rolled_back'; else printf 'up_failed'; fi ;;
    2) printf 'bad_command' ;;
    3) printf 'prod_busy' ;;
    4) printf 'broken' ;;
    5) printf 'backup_failed' ;;
    6) printf 'base_mismatch' ;;
    7) printf 'prod_missing' ;;
    8) printf 'pull_failed' ;;
    9) printf 'locked' ;;
    *) printf 'broken' ;;
  esac
}

# compose <аргументы…> — проект chezz; compose.prod.env последним (EC-38).
compose() {
  docker compose -p chezz -f "$COMPOSE_FILE" \
    --env-file "$ENV_DIR/compose.staging.env" --env-file "$ENV_DIR/compose.prod.env" "$@"
}

# ensure_compose_env_files — пустые compose-файлы окружения (640), если их нет: без них compose не
# запускается (`--env-file`). OPERATIONS §5: их создаёт bootstrap.sh, deploy.sh пересоздаёт. Только не для status.
ensure_compose_env_files() {
  local f
  for f in "$ENV_DIR/compose.staging.env" "$ENV_DIR/compose.prod.env"; do
    [ -f "$f" ] && continue
    : | atomic_write "$f" 640 || return 1
    log "created empty $(basename "$f")"
  done
}

# svc_running <сервис> — сервис compose запущен (ошибка compose = не запущен).
svc_running() {
  local out
  local -a prof=()
  case "$1" in *-staging) prof=(--profile staging) ;; esac
  out="$(compose "${prof[@]}" ps -q --status running "$1" 2>/dev/null)" || return 1
  [ -n "$out" ]
}

# env_get <файл> <ключ> — значение ключа env-файла (последнее), пусто — если нет.
env_get() {
  local line val=""
  [ -f "$1" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in "$2="*) val="${line#*=}" ;; esac
  done < "$1"
  printf '%s' "$val"
}

# read_line <файл> — первая строка файла без \r; пусто — если файла нет.
read_line() {
  local line=""
  [ -f "$1" ] || return 0
  IFS= read -r line < "$1" || true
  printf '%s' "${line%$'\r'}"
}

# atomic_write <файл> <права> — содержимое из stdin; временный файл в том же каталоге + mv (П4).
atomic_write() {
  local dst="$1" mode="$2" dir tmp
  dir="$(dirname "$dst")"
  tmp="$(mktemp "$dir/.tmp.XXXXXX")" || return 1
  if ! chmod "$mode" "$tmp" || ! cat > "$tmp" || ! mv -f "$tmp" "$dst"; then
    rm -f "$tmp"
    return 1
  fi
}

# write_state <имя> <строка>
write_state() { printf '%s\n' "$2" | atomic_write "$STATE_DIR/$1" 640; }

# registry — ghcr.io/<владелец в нижнем регистре> из remote.origin.url клона (П2).
registry() {
  local url
  url="$(git -C "$REPO" config --get remote.origin.url 2>/dev/null)" || return 1
  [[ "$url" =~ github\.com[:/]([A-Za-z0-9-]+)/ ]] || return 1
  printf 'ghcr.io/%s' "${BASH_REMATCH[1],,}"
}

# image_revision <ref> — метка org.opencontainers.image.revision образа.
image_revision() {
  local rev
  rev="$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$1" 2>/dev/null)" || return 1
  rev="${rev%%[[:space:]]*}"
  [ -n "$rev" ] || return 1
  printf '%s' "$rev"
}

# digest_of <ref> — sha256:… из ссылки на образ; пусто — если нет.
digest_of() {
  if [[ "$1" =~ (sha256:[0-9a-f]{64}) ]]; then printf '%s' "${BASH_REMATCH[1]}"; fi
}

# prod_metrics — текст /metrics prod; код ≠ 0 — не отвечает.
prod_metrics() { curl -fsS --max-time 5 "$PROD_METRICS_URL" 2>/dev/null; }

# metric_int <имя> — целая часть первого значения метрики из stdin; нет — 0.
metric_int() {
  local line val
  while IFS= read -r line; do
    case "$line" in
      "$1 "* | "$1{"*)
        val="${line%$'\r'}"
        val="${val##* }"
        val="${val%%.*}"
        if [[ "$val" =~ ^[0-9]+$ ]]; then
          printf '%s' "$val"
          return 0
        fi
        ;;
    esac
  done
  printf '0'
}

# prod_games_active — chezz_games_active prod; метрики нет или app не отвечает — 0 (§9.4 п.2).
prod_games_active() {
  local m
  m="$(prod_metrics)" || { printf '0'; return 0; }
  metric_int chezz_games_active <<< "$m"
}

# health_ok — проверки б) и в): https://$APP_DOMAIN/api/health = {"status":"ok"}, есть HSTS и CSP.
health_ok() {
  local domain out body headers
  domain="$(env_get "$ENV_DIR/compose.prod.env" APP_DOMAIN)"
  if [ -z "$domain" ]; then err "APP_DOMAIN is not set in compose.prod.env"; return 1; fi
  out="$(curl -fsS --max-time 10 -D - "https://$domain/api/health" 2>/dev/null)" || { log "check b: health request failed"; return 1; }
  body="${out##*$'\n'}"
  body="${body%$'\r'}"
  if [ "$body" != '{"status":"ok"}' ]; then log "check b: health is not ok"; return 1; fi
  headers="${out,,}"
  case "$headers" in *strict-transport-security:*) ;; *) log "check c: no Strict-Transport-Security"; return 1 ;; esac
  case "$headers" in *content-security-policy:*) ;; *) log "check c: no Content-Security-Policy"; return 1 ;; esac
  return 0
}

# run_checks <revision> — проверки а–г (OPERATIONS §9.4 п.11).
run_checks() {
  local rev="$1" m restarts
  m="$(prod_metrics)" || { log "check a: metrics unavailable"; return 1; }
  case $'\n'"${m//$'\r'/}"$'\n' in
    *$'\n'"app_info{version=\"$rev\"} 1"$'\n'*) log "check a: ok" ;;
    *) log "check a: no app_info{version=\"$rev\"} 1"; return 1 ;;
  esac
  health_ok || return 1
  log "check b, c: ok"
  sleep 60
  restarts="$(docker inspect -f '{{.RestartCount}}' "$PROD_CONTAINER" 2>/dev/null)" || { log "check d: no container"; return 1; }
  restarts="${restarts//[[:space:]]/}"
  if [ "$restarts" != 0 ]; then log "check d: RestartCount=$restarts"; return 1; fi
  health_ok || { log "check d: health after 60 s failed"; return 1; }
  log "check d: ok"
}

# staging_down — гасит staging (app-staging, db-staging с томами). Без staging.env compose с профилем
# staging не загружается: тогда staging никогда не поднимался и гасить нечего.
staging_down() {
  ensure_compose_env_files || return 1
  if compose --profile staging rm -sfv app-staging db-staging; then
    rm -f "$STATE_DIR/staging.started"
    return 0
  fi
  if [ ! -f "$ENV_DIR/staging.env" ]; then
    log "staging.env is absent: staging was never up"
    rm -f "$STATE_DIR/staging.started"
    return 0
  fi
  return 1
}

# --- Секреты (П4, A2) ---------------------------------------------------------------------------------
# read_secrets — разбирает stdin (строки KEY=VALUE до EOF) в SEC (ключ → значение) и SEC_KEYS (порядок).
# Проверяет только форму; содержимое строк не печатается (это могут быть части секретов).
read_secrets() {
  declare -gA SEC=()
  SEC_KEYS=()
  local line key val n=0
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n + 1))
    [ -n "$line" ] || continue
    case "$line" in *=*) ;; *) err "secrets line $n: no '='"; return 1 ;; esac
    key="${line%%=*}"
    val="${line#*=}"
    if ! [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]]; then err "secrets line $n: bad key"; return 1; fi
    if [[ "$val" == *[\$\'\"\`\\]* || "$val" == *$'\r'* ]]; then err "secrets line $n: forbidden character in value of $key"; return 1; fi
    if [ -n "${SEC[$key]+x}" ]; then err "secrets line $n: duplicate key $key"; return 1; fi
    SEC[$key]="$val"
    SEC_KEYS+=("$key")
  done
}

# parse_allowlist <разделы…> — allowlist из stdin; ALLOW (ключ → раздел), ALLOW_REQ (ключ → required|optional),
# ALLOW_KEYS (порядок). Учитываются только перечисленные разделы.
parse_allowlist() {
  declare -gA ALLOW=() ALLOW_REQ=()
  ALLOW_KEYS=()
  local line section="" name kind want s
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    line="${line%%#*}"
    [[ "$line" =~ ^[[:space:]]*$ ]] && continue
    if [[ "$line" =~ ^\[([a-z]+)\][[:space:]]*$ ]]; then section="${BASH_REMATCH[1]}"; continue; fi
    read -r name kind _ <<< "$line"
    want=0
    for s in "$@"; do [ "$s" = "$section" ] && want=1; done
    [ "$want" = 1 ] || continue
    case "$kind" in required | optional) ;; *) err "allowlist: bad line for $name"; return 1 ;; esac
    ALLOW[$name]="$section"
    ALLOW_REQ[$name]="$kind"
    ALLOW_KEYS+=("$name")
  done
}

# check_secrets <среда> — ключи из ALLOW, обязательные не пусты, APP_ENV = среда (A2).
check_secrets() {
  local k
  for k in "${SEC_KEYS[@]}"; do
    if [ -z "${ALLOW[$k]+x}" ]; then err "secret $k is not allowed for $1"; return 1; fi
  done
  for k in "${ALLOW_KEYS[@]}"; do
    if [ "${ALLOW_REQ[$k]}" = required ] && [ -z "${SEC[$k]-}" ]; then err "required secret $k is empty or missing"; return 1; fi
  done
  if [ "${SEC[APP_ENV]-}" != "$1" ]; then err "APP_ENV does not match $1"; return 1; fi
}

# emit_section <раздел> [исключить…] — строки KEY=VALUE непустых ключей раздела в порядке allowlist.
emit_section() {
  local sec="$1" k x skip
  shift
  for k in "${ALLOW_KEYS[@]}"; do
    [ "${ALLOW[$k]}" = "$sec" ] || continue
    [ -n "${SEC[$k]-}" ] || continue
    skip=0
    for x in "$@"; do [ "$x" = "$k" ] && skip=1; done
    [ "$skip" = 1 ] && continue
    printf '%s=%s\n' "$k" "${SEC[$k]}"
  done
  return 0
}
