#!/usr/bin/env bash
# Хук PreToolUse: блокирует опасные действия в момент вызова инструмента (первая линия защиты).
# Вторая линия — check-zone.sh end после агента. Подключается в .claude/settings.json.
#
# Всегда:
#   - чтение и запись секретов (.env, .env.* кроме .env.example);
#   - правка .claude/kit, .claude/commands, .claude/settings*.json (это меняет только человек).
# Пока работает агент (оркестратор сделал `check-zone.sh begin`, есть .git/agent-zone):
#   - запись файлов вне зоны агента (правила зон — из HEAD);
#   - git commit / push / reset / checkout / stash / rebase / merge / tag и прочее, меняющее историю или дерево;
#   - запись в .claude/ и .git/ через shell, обращения к agent-zone и zones.conf.
# Блокировка: код выхода 2, причина — в stderr (её увидит агент).
set -uo pipefail

input="$(cat)"
field() {  # $1 — имя поля в tool_input или верхнего уровня
  if command -v jq >/dev/null 2>&1; then
    jq -r --arg k "$1" '(.tool_input[$k] // .[$k] // empty) | tostring' <<<"$input" 2>/dev/null
  else  # грубый разбор без jq: "ключ":"значение"
    sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\(\([^\"\\\\]\|\\\\.\)*\)\".*/\1/p" <<<"$input" | head -1 | sed 's/\\"/"/g; s/\\\\/\\/g'
  fi
}
block() { echo "BLOCKED by .claude/kit/hooks/guard.sh: $*" >&2; exit 2; }

tool="$(field tool_name)"
root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
gitdir="$(git -C "$root" rev-parse --git-dir 2>/dev/null || echo .git)"; [[ "$gitdir" = /* ]] || gitdir="$root/$gitdir"
active=""; [[ -f "$gitdir/agent-zone" ]] && active="$(cat "$gitdir/agent-zone")"

rel() { local p="$1"; p="${p#"$root"/}"; p="${p#./}"; printf '%s' "$p"; }
is_secret() { case "$1" in .env.example|*/.env.example) return 1 ;; .env|.env.*|*/.env|*/.env.*) return 0 ;; esac; return 1; }
is_protected() { case "$1" in .claude/kit/*|.claude/commands/*|.claude/settings.json|.claude/settings.local.json) return 0 ;; esac; return 1; }

case "$tool" in
  Read|Edit|Write|MultiEdit|NotebookEdit)
    p="$(field file_path)"; [[ -z "$p" ]] && p="$(field notebook_path)"
    [[ -z "$p" ]] && exit 0
    p="$(rel "$p")"
    is_secret "$p" && block "secrets file $p — values are set by a human, agents use .env.example"
    [[ "$tool" == Read ]] && exit 0
    is_protected "$p" && block "$p is protected — only a human edits the kit, commands and settings"
    if [[ -n "$active" ]]; then
      zone="${active%%$'\t'*}"; slug="${active#*$'\t'}"
      args=(--match "$zone"); [[ -n "$slug" ]] && args+=("$slug"); args+=("$p")
      if git -C "$root" cat-file -e HEAD:.claude/kit/scripts/check-zone.sh 2>/dev/null; then
        why="$(cd "$root" && bash <(git show HEAD:.claude/kit/scripts/check-zone.sh) "${args[@]}" 2>&1)" || block "zone '$zone': $why"
      else
        why="$(cd "$root" && bash .claude/kit/scripts/check-zone.sh "${args[@]}" 2>&1)" || block "zone '$zone': $why"
      fi
    fi
    ;;
  Bash)
    cmd="$(field command)"
    # секреты: любое упоминание .env, кроме .env.example
    stripped="$(sed -E 's/\.env\.example//g' <<<"$cmd")"
    grep -qE '(^|[^A-Za-z0-9_.-])\.env($|[^A-Za-z0-9_-]|\.[A-Za-z0-9_-]+)' <<<"$stripped" \
      && block "commands must not touch secrets files (.env)"
    # запись в защищённое из shell — всегда
    grep -qE '(>|>>|tee|sed[[:space:]]+-i|perl[[:space:]]+-p?i|mv|cp|rm|truncate|chmod|ln)[^|;&]*\.claude/(kit|commands|settings)' <<<"$cmd" \
      && block "shell writes to protected .claude files"
    if [[ -n "$active" ]]; then
      zone="${active%%$'\t'*}"
      grep -qE '(^|[;&|[:space:](])git[[:space:]]+(-C[[:space:]]+[^[:space:]]+[[:space:]]+)?(commit|push|reset|rebase|merge|checkout|switch|stash|tag|restore|clean|cherry-pick|revert|update-ref|branch[[:space:]]+-[dDmM]|am|apply)([[:space:]]|$)' <<<"$cmd" \
        && block "zone '$zone': agents do not change git history or switch the tree — the orchestrator commits"
      grep -qE 'agent-zone|zones\.conf' <<<"$cmd" && block "zone '$zone': agents do not touch zone settings"
      grep -qE '(>|>>|tee|sed[[:space:]]+-i|perl[[:space:]]+-p?i|mv|cp|rm|truncate|chmod|ln)[^|;&]*(\.claude/|\.git/)' <<<"$cmd" \
        && block "zone '$zone': shell writes to .claude/ or .git/"
    fi
    ;;
esac
exit 0
