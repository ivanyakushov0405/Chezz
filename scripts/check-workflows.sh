#!/usr/bin/env bash
# Триггеры и права workflow (OPERATIONS §1, §8, §9.2, §11; TESTING §12). Вспомогательная проверка:
# основная защита — diff .github/ перед git push (OPERATIONS §1, O36).
# Запуск из корня: bash scripts/check-workflows.sh [каталог workflow, по умолчанию .github/workflows]
# Коды: 0 — чисто; 1 — нарушения (файл: правило); 2 — ошибка запуска.
#
# Правила:
# - ни в одном workflow нет pull_request_target, workflow_run, фильтров paths / paths-ignore;
# - ci.yml: только pull_request и push, оба с branches: [main]; permissions: contents: read
#   (верхний уровень обязателен), у job не шире; нет secrets.* и environment:;
# - deploy.yml, load.yml и любые другие workflow: только workflow_dispatch;
#   права job не шире OPERATIONS §9.2 (deploy) и §11 (load), остальное — не шире contents: read;
# - permissions: read-all / write-all запрещены; job без permissions при отсутствии верхнего уровня — нарушение.
# YAML разбирается построчно (блочный стиль, отступы пробелами), как пишутся workflow этого репозитория.
set -u
export LC_ALL=C

cd "$(dirname "$0")/.." || exit 2

DIR="${1:-.github/workflows}"
failed=0

fail() { # <файл> <сообщение>
  failed=1
  echo "$1: $2" >&2
}

if [ ! -d "$DIR" ]; then
  echo "check-workflows: ${DIR} not found — nothing to check"
  exit 0
fi

mapfile -t files < <(find "$DIR" -maxdepth 1 -type f \( -name '*.yml' -o -name '*.yaml' \) | sort)
if [ "${#files[@]}" -eq 0 ]; then
  echo "check-workflows: no workflow files in ${DIR}"
  exit 0
fi

has_ci=0
for f in "${files[@]}"; do
  case "$(basename "$f")" in ci.yml | ci.yaml) has_ci=1 ;; esac
done
[ "$has_ci" -eq 1 ] || fail "$DIR" "ci.yml not found (OPERATIONS §8)"

# Текст без комментариев и \r (для поиска запрещённых слов).
strip_comments() {
  sed -e 's/\r$//' -e '/^[[:space:]]*#/d' -e 's/[[:space:]]#.*$//' "$1"
}

# Разбор: записи через TAB
#   EVENT <событие> | EVENTKEY <событие> <ключ> <значение> | EVENTITEM <событие> <ключ> <элемент>
#   JOB <job> | PERM <_top|job> <ключ|_inline> <значение>
parse() {
  awk -v Q="'" '
    function trim(s) { sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s); return s }
    function unq(s) {
      s = trim(s)
      if (s ~ /^".*"$/ || s ~ ("^" Q ".*" Q "$")) s = substr(s, 2, length(s) - 2)
      return s
    }
    # разбор "ключ: значение" в K, V
    function kv(s,   p) {
      p = index(s, ":")
      if (p == 0) { K = unq(s); V = ""; return }
      K = unq(substr(s, 1, p - 1)); V = trim(substr(s, p + 1))
    }
    function inline_list(ev, key, v,   n, i, a) {
      gsub(/^\[|\]$/, "", v)
      n = split(v, a, ",")
      for (i = 1; i <= n; i++) if (unq(a[i]) != "") print "EVENTITEM\t" ev "\t" key "\t" unq(a[i])
    }
    {
      sub(/\r$/, "")
      line = $0
      if (line ~ /^[ \t]*#/ || line ~ /^[ \t]*$/) next
      sub(/[ \t]+#.*$/, "", line)
      match(line, /^ */); ind = RLENGTH; body = substr(line, ind + 1)
      if (body == "---") next

      if (ind == 0) {
        kv(body); top = K
        if (top == "true") top = "on"
        eind = -1; skind = -1; jind = -1; jkind = -1; inperm = 0
        if (top == "on" && V != "") {
          v = V; gsub(/^\[|\]$/, "", v)
          n = split(v, a, ",")
          for (i = 1; i <= n; i++) if (unq(a[i]) != "") print "EVENT\t" unq(a[i])
        }
        if (top == "permissions" && V != "") print "PERM\t_top\t_inline\t" unq(V)
        next
      }

      if (top == "on") {
        if (eind < 0) eind = ind
        if (ind == eind) {
          if (body ~ /^-/) { print "EVENT\t" unq(substr(body, 2)); next }
          kv(body); ev = K; skind = -1
          print "EVENT\t" ev
          if (V != "" && V != "null" && V != "{}" && V != "~") print "EVENTKEY\t" ev "\t_inline\t" V
          next
        }
        if (skind < 0) skind = ind
        if (ind == skind && body !~ /^-/) {
          kv(body); sk = K
          print "EVENTKEY\t" ev "\t" sk "\t" V
          if (V ~ /^\[/) inline_list(ev, sk, V)
          next
        }
        if (body ~ /^-/) print "EVENTITEM\t" ev "\t" sk "\t" unq(substr(body, 2))
        next
      }

      if (top == "permissions") { kv(body); print "PERM\t_top\t" K "\t" unq(V); next }

      if (top == "jobs") {
        if (jind < 0) jind = ind
        if (ind == jind) { kv(body); job = K; jkind = -1; inperm = 0; print "JOB\t" job; next }
        if (jkind < 0) jkind = ind
        if (ind == jkind) {
          kv(body); inperm = (K == "permissions")
          if (inperm && V != "") print "PERM\t" job "\t_inline\t" unq(V)
          next
        }
        if (inperm && ind > jkind) { kv(body); print "PERM\t" job "\t" K "\t" unq(V) }
      }
    }
  ' "$1"
}

level() { # none < read < write
  case "$1" in
    none) echo 0 ;;
    read) echo 1 ;;
    write) echo 2 ;;
    *) echo 9 ;;
  esac
}

# Разрешённые права «ключ=уровень ...» для job (OPERATIONS §9.2, §11).
allowed_perms() { # <файл-база> <job>
  case "$1:$2" in
    deploy:plan | load:plan) echo "contents=read actions=read pull-requests=read" ;;
    deploy:build | load:build) echo "contents=read packages=write" ;;
    *) echo "contents=read" ;;
  esac
}

check_perms() { # <файл> <база> <записи parse>
  local f="$1" base="$2" records="$3"
  local top_present=0 scope key value allowed want got
  printf '%s\n' "$records" | grep -q $'^PERM\t_top\t' && top_present=1

  if [ "$base" = "ci" ] && [ "$top_present" -eq 0 ]; then
    fail "$f" "top-level permissions: contents: read required (OPERATIONS §8)"
  fi

  while IFS=$'\t' read -r _ scope key value; do
    [ -z "$scope" ] && continue
    if [ "$key" = "_inline" ]; then
      case "$value" in
        "{}") continue ;;
        *) fail "$f" "permissions of ${scope}: '${value}' not allowed, list keys explicitly (OPERATIONS §8, §9.2)"; continue ;;
      esac
    fi
    if [ "$scope" = "_top" ]; then allowed="contents=read"; else allowed="$(allowed_perms "$base" "$scope")"; fi
    want="none"
    for pair in $allowed; do [ "${pair%%=*}" = "$key" ] && want="${pair#*=}"; done
    got="$(level "$value")"
    if [ "$got" -eq 9 ]; then
      fail "$f" "permissions of ${scope}: ${key}: '${value}' unknown level"
    elif [ "$got" -gt "$(level "$want")" ]; then
      fail "$f" "permissions of ${scope}: ${key}: ${value} wider than allowed (${allowed}) (OPERATIONS §8, §9.2, §11)"
    fi
  done < <(printf '%s\n' "$records" | grep $'^PERM\t' || true)

  if [ "$top_present" -eq 0 ]; then
    while IFS=$'\t' read -r _ job; do
      [ -z "$job" ] && continue
      printf '%s\n' "$records" | grep -q "^PERM"$'\t'"${job}"$'\t' \
        || fail "$f" "job ${job}: no permissions and no top-level permissions (OPERATIONS §8)"
    done < <(printf '%s\n' "$records" | grep $'^JOB\t' || true)
  fi
}

for f in "${files[@]}"; do
  name="$(basename "$f")"
  base="${name%.*}"
  text="$(strip_comments "$f")"
  records="$(parse "$f")"

  # Общие запреты (OPERATIONS §1, §8; TESTING §12).
  printf '%s\n' "$text" | grep -qE '(^|[^A-Za-z0-9_])pull_request_target([^A-Za-z0-9_]|$)' \
    && fail "$f" "pull_request_target forbidden (OPERATIONS §1)"
  printf '%s\n' "$text" | grep -qE '(^|[^A-Za-z0-9_])workflow_run([^A-Za-z0-9_]|$)' \
    && fail "$f" "workflow_run forbidden (OPERATIONS §1)"
  printf '%s\n' "$records" | grep -qE $'^EVENTKEY\t[^\t]+\t(paths|paths-ignore)\t' \
    && fail "$f" "paths / paths-ignore filters forbidden (TESTING §12, V19)"

  events="$(printf '%s\n' "$records" | awk -F'\t' '$1 == "EVENT" { print $2 }' | sort -u | tr '\n' ' ')"
  [ -z "$events" ] && fail "$f" "no triggers found (on:)"

  if [ "$base" = "ci" ]; then
    [ "$events" = "pull_request push " ] \
      || fail "$f" "triggers must be exactly pull_request and push, got: ${events}(OPERATIONS §8)"
    for ev in pull_request push; do
      keys="$(printf '%s\n' "$records" | awk -F'\t' -v e="$ev" '$1 == "EVENTKEY" && $2 == e { print $3 }' | sort -u | tr '\n' ' ')"
      [ "$keys" = "branches " ] \
        || fail "$f" "${ev}: only 'branches: [main]' allowed, got keys: ${keys:-none} (OPERATIONS §8)"
      items="$(printf '%s\n' "$records" | awk -F'\t' -v e="$ev" '$1 == "EVENTITEM" && $2 == e && $3 == "branches" { print $4 }' | sort -u | tr '\n' ' ')"
      [ "$items" = "main " ] \
        || fail "$f" "${ev}: branches must be [main], got: ${items:-none} (OPERATIONS §8)"
    done
    # По исходному тексту, без удаления комментариев: « #» в кавычках не должен скрывать secrets.*
    # (упоминание в комментарии ci.yml тоже не нужно).
    grep -qE 'secrets\.' "$f" \
      && fail "$f" "secrets.* forbidden in ci.yml, comments included (OPERATIONS §1)"
    printf '%s\n' "$text" | grep -qE '^[[:space:]]+environment:' \
      && fail "$f" "environment: forbidden in ci.yml (OPERATIONS §1)"
  else
    [ "$events" = "workflow_dispatch " ] \
      || fail "$f" "only workflow_dispatch allowed, got: ${events}(OPERATIONS §1, §9.2, §11)"
  fi

  check_perms "$f" "$base" "$records"
done

if [ "$failed" -ne 0 ]; then
  echo "check-workflows: FAILED (OPERATIONS §1, §8, §9.2)" >&2
  exit 1
fi
echo "check-workflows: ok (${#files[@]} file(s))"
