#!/usr/bin/env bash
# Word → docs/TZ.md с сохранением нумерации разделов и проверкой результата. Механическая работа — не для LLM.
#
#   tz-convert.sh <ТЗ.docx> [--out docs/TZ.md] [--auto-number]
#
# Что делает: pandoc → GitHub markdown; убирает оглавление (раздел «Содержание»/«Оглавление»/«Contents»);
# убирает пустые строки между пунктами списков; добавляет шапку для агентов; печатает сводку.
# Проверка нумерации: если в Word нумерация автоматическая, pandoc её теряет — заголовки останутся без номеров,
# и покрытие ТЗ посчитать будет нельзя. Тогда скрипт останавливается (выход 3). С --auto-number он
# пронумерует заголовки по уровням (1, 1.1, 1.1.1 …) — **сверьте с Word**: скрипт печатает первые заголовки.
# Выход: 0 — готово; 2 — ошибка вызова; 3 — нумерация потеряна, нужен --auto-number и сверка человеком.
set -euo pipefail

src="${1:?usage: tz-convert.sh <file.docx> [--out docs/TZ.md] [--auto-number]}"; shift
out="docs/TZ.md"; auto=0
while (( $# )); do case "$1" in --out) out="$2"; shift 2 ;; --auto-number) auto=1; shift ;; *) echo "unknown arg $1" >&2; exit 2 ;; esac; done
[[ -f "$src" ]] || { echo "not found: $src" >&2; exit 2; }
command -v pandoc >/dev/null || { echo "pandoc is required: https://pandoc.org/installing.html" >&2; exit 2; }

tmp="$(mktemp)"; trap 'rm -f "$tmp" "$tmp.2"' EXIT
pandoc "$src" -t gfm --wrap=none -o "$tmp"

# 1) убрать оглавление и лишние пустые строки в списках; посчитать заголовки
awk '
  /^```/ { fence = !fence }
  !fence && /^#+[ \t]/ {
    match($0, /^#+/); l = RLENGTH; t = $0; sub(/^#+[ \t]+/, "", t)
    if (skip && l <= skiplvl) skip = 0
    if (t ~ /^(Содержание|Оглавление|Contents|Table of [Cc]ontents)[ \t]*$/) { skip = 1; skiplvl = l; next }
  }
  skip { next }
  { lines[++n] = $0 }
  END {
    for (i = 1; i <= n; i++) {
      if (lines[i] == "" && i > 1 && i < n && lines[i-1] ~ /^[ \t]*([-*]|[0-9]+\.)[ \t]/ && lines[i+1] ~ /^[ \t]*([-*]|[0-9]+\.)[ \t]/) continue
      if (lines[i] == "" && prev_blank) continue
      print lines[i]; prev_blank = (lines[i] == "")
    }
  }' "$tmp" > "$tmp.2"

total=$(grep -cE '^#+[ \t]' "$tmp.2" || true)
numbered=$(grep -cE '^#+ [0-9]+(\.[0-9]+)*\.? ' "$tmp.2" || true)
echo "headings: $total, numbered: $numbered" >&2

if (( total == 0 )); then echo "no headings found — check that Word uses heading styles (Заголовок 1, 2, …)" >&2; exit 3; fi
if (( numbered * 2 < total )); then
  if (( ! auto )); then
    echo "numbering looks lost (automatic numbering in Word). Re-run with --auto-number and compare with Word." >&2; exit 3
  fi
  # 2) пронумеровать по уровням, начиная с минимального уровня заголовков
  minl=$(grep -oE '^#+' "$tmp.2" | awk '{ print length }' | sort -n | head -1)
  awk -v minl="$minl" '
    /^```/ { fence = !fence }
    !fence && /^#+[ \t]/ {
      match($0, /^#+/); l = RLENGTH - minl + 1; t = $0; sub(/^#+[ \t]+/, "", t)
      c[l]++; for (k = l + 1; k <= 9; k++) c[k] = 0
      num = c[1]; for (k = 2; k <= l; k++) num = num "." c[k]
      print substr("#########", 1, RLENGTH) " " num ". " t; next
    }
    { print }' "$tmp.2" > "$tmp"
  mv "$tmp" "$tmp.2"
  echo "auto-numbered. First headings — compare with Word:" >&2
  grep -E '^#+ ' "$tmp.2" | head -15 >&2
fi

mkdir -p "$(dirname "$out")"
{
  echo "# Техническое задание"
  echo
  echo "> Сконвертировано из \`$(basename "$src")\` скриптом \`.claude/kit/scripts/tz-convert.sh\`. Нумерация разделов сохранена: ссылки «ТЗ §3.4.2» ведут на заголовок \`### 3.4.2.\`."
  echo ">"
  echo "> **Агентам:** файл большой — целиком не читать. Оглавление: \`.claude/kit/scripts/section.sh --toc docs/TZ.md 3\`, раздел: \`section.sh docs/TZ.md 3.4.2\`."
  echo
  cat "$tmp.2"
} > "$out"
echo "written: $out ($(grep -cE '^#+ [0-9]' "$out") numbered sections)" >&2
