#!/usr/bin/env bash
# Проверки правил, которых не видит dependency-cruiser (ARCHITECTURE §7.4, §5; OPERATIONS §1, §8).
# Запуск из корня: bash scripts/check-architecture.sh. Код 0 — чисто; 1 — нарушения (файл:строка: правило).
# Несуществующие пути пропускаются (скелет растёт по задачам). Правку правила F2–F5 вносит тот, кто меняет правило
# (TESTING §11); правило «адреса только из PAGES» добавляет задача фронтенда.
set -u
export LC_ALL=C

cd "$(dirname "$0")/.." || exit 2

SELF="scripts/check-architecture.sh"
SRC="apps/server/src"
MIGRATIONS="apps/server/migrations"
failed=0

# report <правило> <строки grep -n "файл:строка:текст">
report() {
  local rule="$1" lines="$2"
  [ -z "$lines" ] && return 0
  failed=1
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    local file="${line%%:*}" rest="${line#*:}"
    local num="${rest%%:*}"
    echo "${file}:${num}: [${rule}]" >&2
  done <<<"$lines"
}

# Файлы *.ts / *.tsx под каталогом (если он есть), без node_modules.
ts_files() {
  [ -d "$1" ] || return 0
  find "$1" -type f \( -name '*.ts' -o -name '*.tsx' \) -not -path '*/node_modules/*' | sort
}

grep_files() { # <ERE> <файлы…> → файл:строка:текст
  local re="$1"
  shift
  [ "$#" -eq 0 ] && return 0
  grep -nHE -- "$re" "$@" 2>/dev/null || true
}

# --- 1. SQL Kysely только в repo.ts (ARCHITECTURE §7.4; миграции, test/support и seed.ts вне apps/server/src) ---
SQL_RE='\.(selectFrom|insertInto|updateTable|deleteFrom|replaceInto|mergeInto)\(|(^|[^A-Za-z0-9_])sql(<[^>]*>)?`|(^|[^A-Za-z0-9_])sql\.(raw|lit|ref|id|table|join|val)\('
mapfile -t non_repo < <(ts_files "$SRC" | grep -vE '/repo\.ts$')
report "SQL only in <module>/repo.ts (ARCHITECTURE §7.4)" "$(grep_files "$SQL_RE" "${non_repo[@]}")"

# --- 2. repo.ts — только таблицы своего модуля: ключи XTables из своего tables.ts (ARCHITECTURE §7.4, §8) ---
TABLE_CALL_RE='(selectFrom|insertInto|updateTable|deleteFrom|replaceInto|mergeInto|innerJoin|leftJoin|rightJoin|fullJoin|with)\([[:space:]]*["'"'"'][A-Za-z0-9_]+'
while IFS= read -r repo; do
  [ -z "$repo" ] && continue
  dir="$(dirname "$repo")"
  own=""
  # ключи блока «interface XTables { имя_таблицы: XxxTable; … }» (или type XTables = { … })
  [ -f "$dir/tables.ts" ] && own="$(awk '
    /(interface|type)[[:space:]]+[A-Za-z0-9_]+Tables[[:space:]]*(=[[:space:]]*)?\{/ { inside = 1; next }
    inside && /^[[:space:]]*\}/ { inside = 0 }
    inside { if (match($0, /^[[:space:]]*[a-z][a-z0-9_]*[[:space:]]*:/)) { s = substr($0, RSTART, RLENGTH); gsub(/[[:space:]:]/, "", s); print s } }
  ' "$dir/tables.ts" | sort -u)"
  while IFS= read -r hit; do
    [ -z "$hit" ] && continue
    num="${hit%%:*}"
    table="$(printf '%s' "${hit#*:}" | grep -oE '["'"'"'][A-Za-z0-9_]+' | head -1 | tr -d "\"'")"
    # with("cte") — общее табличное выражение, не таблица
    case "${hit#*:}" in with\(*) continue ;; esac
    if ! printf '%s\n' "$own" | grep -qxF -- "$table"; then
      failed=1
      echo "${repo}:${num}: [repo uses table '${table}' not declared in $(basename "$dir")/tables.ts (ARCHITECTURE §7.4, §8)]" >&2
    fi
  done < <(grep -noE "$TABLE_CALL_RE" "$repo" 2>/dev/null || true)
done < <(ts_files "$SRC" | grep -E '/repo\.ts$')

# --- 3. Время в domain/ — только параметром (ARCHITECTURE §7.2) ---
mapfile -t domain_files < <(ts_files "$SRC" | grep -E "^${SRC}/[^/]+/domain/")
report "no Date.now / performance.now / new Date() in domain/ (ARCHITECTURE §7.2)" \
  "$(grep_files 'Date\.now[[:space:]]*\(|performance\.now[[:space:]]*\(|new[[:space:]]+Date[[:space:]]*\([[:space:]]*\)' "${domain_files[@]}")"

# --- 4. Миграции только добавляющие (ARCHITECTURE §5) ---
mapfile -t migration_files < <(ts_files "$MIGRATIONS")
report "additive migrations only: no dropTable/dropColumn/renameColumn/renameTo/setDataType (ARCHITECTURE §5)" \
  "$(grep_files '\.(dropTable|dropColumn|renameColumn|renameTo|setDataType)\(' "${migration_files[@]}")"
if [ "${#migration_files[@]}" -gt 0 ]; then
  report "additive migrations only: no DROP/RENAME/ALTER TYPE in SQL (ARCHITECTURE §5)" \
    "$(grep -niHE 'drop[[:space:]]+(table|column)|rename[[:space:]]+(column|to)|alter[[:space:]]+column[[:space:]]+[^[:space:]]+[[:space:]]+(set[[:space:]]+data[[:space:]]+)?type' "${migration_files[@]}" 2>/dev/null || true)"
fi

# --- 5. Фабрики сервисов вызывает только app.ts (ADR-0005 п.4) ---
if [ -d "$SRC" ]; then
  for dir in "$SRC"/*/; do
    [ -d "$dir" ] || continue
    module="$(basename "$dir")"
    own="create$(printf '%s' "${module:0:1}" | tr '[:lower:]' '[:upper:]')${module:1}Service"
    while IFS= read -r hit; do
      [ -z "$hit" ] && continue
      case "$hit" in *"${own}("*) continue ;; esac
      report "foreign create<Module>Service( in ${module}/ — only app.ts calls factories (ADR-0005 п.4)" "$hit"
    done < <(ts_files "$dir" | while IFS= read -r f; do grep -nHoE 'create[A-Z][A-Za-z0-9]*Service\(' "$f" 2>/dev/null; done)
  done
fi

# --- 6. Нет example.com в .github, deploy, scripts (OPERATIONS §1, §8) ---
# CLAUDE.md — инструкции агентам, где правило названо словами; сам скрипт содержит шаблон.
ops_dirs=()
for d in .github deploy scripts; do [ -d "$d" ] && ops_dirs+=("$d"); done
if [ "${#ops_dirs[@]}" -gt 0 ]; then
  report "no example.com in .github, deploy, scripts (OPERATIONS §1)" \
    "$(grep -rnIE 'example\.com' "${ops_dirs[@]}" --exclude=CLAUDE.md 2>/dev/null | grep -vF "${SELF}:" || true)"
fi

if [ "$failed" -ne 0 ]; then
  echo "check-architecture: FAILED (rules: ARCHITECTURE §5, §7.2, §7.4; ADR-0005; OPERATIONS §1)" >&2
  exit 1
fi
echo "check-architecture: ok"
