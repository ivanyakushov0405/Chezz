#!/usr/bin/env bash
# Оценка стоимости в токенах.
#
#   token-report.sh [--agent-budget 1500] [--command-budget 4000] [--section-budget 1500] [документ ...]
#       промпты агентов и команд (загружаются на каждый вызов / висят в контексте оркестратора)
#       и документы: размер и самый крупный неделимый раздел (его нельзя прочитать частями)
#   token-report.sh --forecast setup [--rounds 2] [--doc-tokens 6000] [--read-tokens 5000]
#       прогноз /setup: число вызовов по моделям и токены — по таблице линз из DOCUMENTS.md
#
# Оценка: кириллица ≈ 1 токен на 2,7 символа, латиница и прочее ≈ 1 на 4. Это порядок величины, не счёт.
# Фактический расход смотрите командой /cost в Claude Code. Выход 1 — есть превышения бюджетов.
set -euo pipefail

agent_budget=1500; command_budget=4000; section_budget=1500; docs=()
forecast=""; rounds=2; doc_tokens=6000; read_tokens=5000
while (( $# )); do
  case "$1" in
    --agent-budget) agent_budget="$2"; shift 2 ;;
    --command-budget) command_budget="$2"; shift 2 ;;
    --section-budget) section_budget="$2"; shift 2 ;;
    --forecast) forecast="$2"; shift 2 ;;
    --rounds) rounds="$2"; shift 2 ;;
    --doc-tokens) doc_tokens="$2"; shift 2 ;;
    --read-tokens) read_tokens="$2"; shift 2 ;;
    *) docs+=("$1"); shift ;;
  esac
done
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"; claude="$root/.claude"
[[ -d "$claude/agents" ]] || claude="$(cd "$here/../.." && pwd)"
S="$here/section.sh"

est() {  # $1 файл → оценка токенов с учётом доли кириллицы
  local chars bytes cyr
  chars=$(wc -m < "$1"); bytes=$(wc -c < "$1")
  cyr=$(( bytes - chars )); (( cyr < 0 )) && cyr=0; (( cyr > chars )) && cyr=$chars
  echo $(( cyr * 10 / 27 + (chars - cyr) / 4 ))
}

if [[ "$forecast" == setup ]]; then
  D="$claude/kit/DOCUMENTS.md"
  table="$("$S" "$D" --title "строго в этом порядке")"
  lenses="$("$S" "$D" --title "Линзы критиков")"
  p_author=$(est "$claude/agents/foundation-author.md"); p_critic=$(est "$claude/agents/critic.md"); p_builder=$(est "$claude/agents/profile-builder.md")
  awk -F'|' -v R="$rounds" -v DT="$doc_tokens" -v RT="$read_tokens" -v PA="$p_author" -v PC="$p_critic" -v PB="$p_builder" -v L="$lenses" '
    BEGIN {
      n = split(L, ll, "\n")
      for (i = 1; i <= n; i++) if (ll[i] ~ /^\| `/) { split(ll[i], c, "|"); name = c[2]; gsub(/[ `]/, "", name); m = c[4]; gsub(/ /, "", m); model[name] = m }
      printf "| Док | Линзы | Автор (вызовы) | Критики opus | Критики sonnet |\n|---|---|---|---|---|\n"
    }
    /^\| F[0-9]/ {
      doc = $2; gsub(/ /, "", doc); ls = $(NF - 1); gsub(/ /, "", ls)
      k = split(ls, arr, ","); o = 0; s = 0
      for (j = 1; j <= k; j++) { if (model[arr[j]] == "sonnet") s++; else o++ }
      # раунд 1: все линзы; следующие раунды: примерно половина линз (только с 🔴); + 1 финальная consistency при R > 1
      co = o + (R - 1) * o / 2; cs = s + (R - 1) * s / 2 + (R > 1 ? 1 : 0)
      a = (doc == "F8" ? 0 : R); b = (doc == "F8" ? R : 0)
      printf "| %s | %s | %d | %.0f | %.0f |\n", doc, ls, a + b, co, cs
      A += a; B += b; CO += co; CS += cs
    }
    END {
      in_author = PA + DT + RT; in_critic = PC + DT + RT * 0.6 + 600; in_builder = PB + 7 * DT * 0.4
      out_author = DT; out_critic = 1200; out_builder = 15000
      opus_calls = A + B + CO; sonnet_calls = CS
      tin = A * in_author + B * in_builder + (CO + CS) * in_critic
      tout = A * out_author + B * out_builder + (CO + CS) * out_critic
      printf "\nВызовов: автор %d, сборщик %d, критики opus %.0f, sonnet %.0f → **opus ≈ %.0f, sonnet ≈ %.0f**\n", A, B, CO, CS, opus_calls, sonnet_calls
      printf "Токены: вход ≈ %.0f тыс., выход ≈ %.0f тыс. (раундов в среднем %d, документ ≈ %d, чтение ТЗ и документов ≈ %d на вызов)\n", tin / 1000, tout / 1000, R, DT, RT
      printf "Плюс пробный прогон /feature размера S: обычно 6–12 вызовов. Сравните с фактом через /cost.\n"
    }' <<<"$table"
  exit 0
fi

over=0
echo "## Промпты"
printf '%-8s %s\n' "≈tok" "файл"
for f in "$claude"/agents/*.md "$claude"/commands/*.md; do
  [[ -f "$f" ]] || continue
  t=$(est "$f"); flag=""
  case "$f" in
    */agents/foundation-author.md|*/agents/critic.md|*/agents/profile-builder.md) flag="(этап /setup — вызывается редко)" ;;
    */agents/*)   (( t > agent_budget ))   && { flag="> бюджета агента $agent_budget (грузится на каждый вызов)"; over=1; } ;;
    */commands/*) (( t > command_budget )) && { flag="> бюджета команды $command_budget (висит в контексте оркестратора)"; over=1; } ;;
  esac
  printf '%-8s %s %s\n' "$t" "${f#"$root"/}" "$flag"
done

if (( ${#docs[@]} == 0 )); then for f in "$root"/docs/*.md; do [[ -f "$f" ]] && docs+=("$f"); done; fi
if (( ${#docs[@]} )); then
  echo; echo "## Документы — читать разделами (section.sh)"
  printf '%-8s %-10s %s\n' "≈tok" "макс.лист" "файл"
  for f in "${docs[@]}"; do
    t=$(est "$f")
    ratio=$(( $(wc -m < "$f") > 0 ? t * 1000 / ( $(wc -m < "$f") / 3 + 1 ) : 1000 ))
    maxs=$("$S" --toc "$f" 6 | awk -v r="$ratio" '{ gsub(/≈/, ""); lv[NR] = length($2); tk[NR] = $3 + 0 }
      END { for (i = 1; i <= NR; i++) if (i == NR || lv[i + 1] <= lv[i]) if (tk[i] > m) m = tk[i]; print int(m * r / 1000) }')
    flag=""; (( maxs > section_budget )) && { flag="неделимый раздел > $section_budget — разбить"; over=1; }
    printf '%-8s %-10s %s %s\n' "$t" "$maxs" "${f#"$root"/}" "$flag"
  done
fi
exit $over
