#!/usr/bin/env bash
# Зоны агентов: что агенту можно менять. Правила — в .claude/zones.conf.
#
# Основной сценарий оркестратора (вокруг каждого вызова агента):
#   T=$(bash <(git show HEAD:.claude/kit/scripts/check-zone.sh) begin <зона>[:<параметр>] [slug])
#   … вызов агента …
#   bash <(git show "${T%%.*}":.claude/kit/scripts/check-zone.sh) end <зона>[:<параметр>] [slug] --since "$T"
#
#   begin   — снимок состояния (хеш дерева со всеми незакоммиченными и новыми файлами + HEAD) и активная зона
#             для хука. Печатает токен: держи его у себя, не в файлах — агент не может его подделать.
#   end     — что изменилось с токена; конфиг зон берётся ИЗ СНИМКА, а не из рабочей копии; новые коммиты
#             агента — нарушение. Снимает активную зону.
#   check   — то же, что end, но зону не снимает: check <зона> [slug] --since <токен>
#   --match <зона> [slug] <путь>   — разрешён ли путь (для хука; конфиг из HEAD)
#   --validate                     — согласованность zones.conf и меток в profile.md (рабочая копия)
#   --list                         — показать зоны
#
# Выход: 0 — всё в зоне; 1 — нарушения (печатаются); 2 — ошибка вызова.
set -euo pipefail

root="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "not a git repository" >&2; exit 2; }
cd "$root"
gitdir="$(git rev-parse --git-dir)"
ACTIVE="$gitdir/agent-zone"

# ---------- общие функции
conf_from() {  # $1 — ревизия или пусто (рабочая копия); печатает zones.conf
  if [[ -z "${1:-}" ]]; then cat .claude/zones.conf 2>/dev/null; else git show "$1:.claude/zones.conf" 2>/dev/null; fi
}
rows_of() { awk '!/^[[:space:]]*(#|$)/ { z=$1; k=$2; $1=""; $2=""; sub(/^[[:space:]]+/, ""); print z "\t" k "\t" $0 }'; }

glob_to_re() {
  local g="$1" re="" i c
  for (( i=0; i<${#g}; i++ )); do
    c="${g:i:1}"
    case "$c" in
      '*') if [[ "${g:i+1:1}" == '*' ]]; then re+='.*'; (( i++ )) || true; else re+='[^/]*'; fi ;;
      '?') re+='[^/]' ;;
      '.'|'+'|'('|')'|'['|']'|'{'|'}'|'^'|'$'|'|'|'\') re+="\\$c" ;;
      *) re+="$c" ;;
    esac
  done
  printf '^%s$' "$re"
}

state_token() {  # хеш дерева рабочего состояния (с новыми файлами, без игнорируемых) + HEAD
  local idx tree head
  idx="$(mktemp "$gitdir/zone-index.XXXXXX")"
  [[ -f "$gitdir/index" ]] && cp "$gitdir/index" "$idx" || rm -f "$idx"
  GIT_INDEX_FILE="$idx" git add -A -- . >/dev/null 2>&1
  tree="$(GIT_INDEX_FILE="$idx" git write-tree)"
  rm -f "$idx"
  head="$(git rev-parse -q --verify HEAD 2>/dev/null || echo none)"
  printf '%s.%s' "$tree" "$head"
}

# Жёсткие правила поверх zones.conf: .claude меняет только сборка конвейера, а kit, команды и настройки — только человек.
hard_violation() {  # $1 путь, $2 зона → печатает причину, если нарушение
  local f="$1" z="$2"
  case "$f" in
    .claude/kit/*|.claude/commands/*|.claude/settings.json|.claude/settings.local.json)
      echo "protected (human only)"; return ;;
    .claude/*) [[ "$z" == setup-pipeline ]] || { echo "only setup-pipeline may change .claude/"; return; } ;;
    .env.example) ;;
    .env|.env.*|*/.env|*/.env.*) echo "secrets file"; return ;;
  esac
}

# ---------- режимы без проверки изменений
case "${1:-}" in
  --list) conf_from "" | rows_of | awk -F'\t' '{ printf "%-16s %-6s %s\n", $1, $2, $3 }'; exit 0 ;;
  --validate)
    errs=0; rows="$(conf_from "" | rows_of)"
    [[ -n "$rows" ]] || { echo "ERROR .claude/zones.conf is missing or empty"; exit 1; }
    zones="$(cut -f1 <<<"$rows" | sort -u)"
    while IFS=$'\t' read -r z k v; do
      [[ "$k" =~ ^(allow|deny|param)$ ]] || { echo "ERROR zones.conf: zone '$z' has unknown kind '$k'"; errs=$((errs+1)); }
      if [[ "$k" == allow && "$v" == *'{param}'* ]] && ! awk -F'\t' -v z="$z" '$1==z && $2=="param"{f=1} END{exit !f}' <<<"$rows"; then
        echo "ERROR zones.conf: zone '$z' uses {param} but has no 'param' line"; errs=$((errs+1)); fi
    done <<<"$rows"
    for z in $zones; do
      [[ "$z" == always ]] && continue
      awk -F'\t' -v z="$z" '$1==z && $2=="allow"{f=1} END{exit !f}' <<<"$rows" || { echo "ERROR zones.conf: zone '$z' has no allow rules"; errs=$((errs+1)); }
    done
    if [[ -f .claude/profile.md ]]; then
      labels="$(awk '/^## /{s=($0 ~ /^## Метки задач/)} s && /^\| *`\[/' .claude/profile.md)"
      [[ -n "$labels" ]] || echo "WARN profile.md: section '## Метки задач' is empty"
      while IFS='|' read -r _ label agent zone _; do
        label="$(xargs <<<"$label")"; agent="$(xargs <<<"$agent")"; zone="$(xargs <<<"$zone")"
        [[ -z "$label" ]] && continue
        grep -qx "$zone" <<<"$zones" || { echo "ERROR profile.md: label $label -> zone '$zone' not in zones.conf"; errs=$((errs+1)); }
        [[ -f ".claude/agents/$agent.md" ]] || { echo "ERROR profile.md: label $label -> agent '$agent' has no .claude/agents/$agent.md"; errs=$((errs+1)); }
      done <<<"$labels"
    else
      echo "WARN profile.md not found — run /setup to create it"
    fi
    (( errs == 0 )) && echo "OK: zones.conf and profile labels are consistent"; exit $(( errs > 0 )) ;;
esac

# ---------- разбор аргументов: <режим> <зона>[:<параметр>] [slug] [--since <токен>] [путь для --match]
mode="${1:-}"; shift || true
case "$mode" in begin|end|check|--match) ;; *) echo "usage: see header of $0" >&2; exit 2 ;; esac
zone_arg="${1:-}"; [[ -n "$zone_arg" ]] || { echo "zone required" >&2; exit 2; }; shift
slug=""; since=""; mpath=""
while (( $# )); do
  case "$1" in
    --since) since="${2:-}"; shift 2 ;;
    *) if [[ "$mode" == --match && $# -eq 1 ]]; then mpath="$1"; else slug="$1"; fi; shift ;;
  esac
done
zone="${zone_arg%%:*}"; param=""; [[ "$zone_arg" == *:* ]] && param="${zone_arg#*:}"

# конфиг: для end/check — из снимка, иначе — из HEAD (если есть), иначе из рабочей копии
rev=""
if [[ "$mode" == end || "$mode" == check ]]; then
  [[ "$since" == *.* ]] || { echo "--since <token from begin> required" >&2; exit 2; }
  rev="${since%%.*}"
elif git rev-parse -q --verify HEAD >/dev/null 2>&1 && git cat-file -e HEAD:.claude/zones.conf 2>/dev/null; then
  rev="HEAD"
fi
rows="$(conf_from "$rev" | rows_of)"
[[ -n "$rows" ]] || { echo "zones.conf not found in ${rev:-working copy} — commit .claude/ first" >&2; exit 2; }
awk -F'\t' -v z="$zone" '$1==z{f=1} END{exit !f}' <<<"$rows" || { echo "unknown zone: $zone" >&2; exit 2; }

allowed_params="$(awk -F'\t' -v z="$zone" '$1==z && $2=="param"{print $3}' <<<"$rows" | xargs)"
if [[ -n "$allowed_params" ]]; then
  [[ -n "$param" ]] || { echo "zone '$zone' needs a parameter: $zone:<one of: $allowed_params>" >&2; exit 2; }
  [[ " $allowed_params " == *" $param "* ]] || { echo "unknown $zone parameter '$param' (known: $allowed_params)" >&2; exit 2; }
fi
# slug обязателен, только если без него у зоны не остаётся ни одного allow-правила
if [[ -z "$slug" ]] && ! awk -F'\t' -v z="$zone" '$1==z && $2=="allow" && !index($3, "{slug}"){f=1} END{exit !f}' <<<"$rows"; then
  echo "zone '$zone' needs slug" >&2; exit 2
fi

build() {  # регэкспы для вида $2 зоны $1; правила с {slug} без slug пропускаются
  local p
  while IFS= read -r p; do
    [[ -z "$p" ]] && continue
    if [[ "$p" == *'{slug}'* ]]; then [[ -n "$slug" ]] || continue; p="${p//\{slug\}/$slug}"; fi
    p="${p//\{param\}/$param}"
    glob_to_re "$p"; echo
  done < <(awk -F'\t' -v z="$1" -v k="$2" '$1==z && $2==k{print $3}' <<<"$rows")
}
mapfile -t allow  < <(build "$zone" allow)
mapfile -t deny   < <(build "$zone" deny)
mapfile -t always < <(build always allow)
match_any() { local f="$1"; shift; local r; for r in "$@"; do [[ -n "$r" && "$f" =~ $r ]] && return 0; done; return 1; }

verdict() {  # $1 путь → печатает причину нарушения или ничего
  local f="$1" why
  why="$(hard_violation "$f" "$zone")"; [[ -n "$why" ]] && { echo "$why"; return; }
  match_any "$f" "${always[@]}" && return
  match_any "$f" "${deny[@]}" && { echo "denied in zone"; return; }
  match_any "$f" "${allow[@]}" || echo "outside zone"
}

# ---------- режимы
if [[ "$mode" == --match ]]; then
  [[ -n "$mpath" ]] || { echo "path required" >&2; exit 2; }
  mpath="${mpath#"$root"/}"; mpath="${mpath#./}"
  why="$(verdict "$mpath")"; [[ -z "$why" ]] && exit 0; echo "$mpath: $why"; exit 1
fi

if [[ "$mode" == begin ]]; then
  printf '%s\t%s\n' "$zone_arg" "$slug" > "$ACTIVE"
  state_token; echo; exit 0
fi

# end / check
before_tree="${since%%.*}"; before_head="${since#*.}"
now="$(state_token)"; now_tree="${now%%.*}"; now_head="${now#*.}"
bad=()
if [[ "$before_head" != "$now_head" ]]; then
  bad+=("HEAD moved $before_head -> $now_head: the agent made commits (only the orchestrator commits)")
fi
while IFS= read -r -d '' f; do
  why="$(verdict "$f")"; [[ -n "$why" ]] && bad+=("$f: $why")
done < <(git diff -z --name-only --no-renames "$before_tree" "$now_tree")

[[ "$mode" == end ]] && rm -f "$ACTIVE"
if (( ${#bad[@]} )); then echo "OUT OF ZONE '$zone_arg':"; printf '  %s\n' "${bad[@]}"; exit 1; fi
echo "OK: all changes are in zone '$zone_arg'"
