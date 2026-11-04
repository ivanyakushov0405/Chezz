#!/usr/bin/env bash
# Печатает только нужные разделы markdown-файла — чтобы агенты не читали большие документы целиком.
#
#   section.sh <файл> <id> [<id> ...] [--with-refs]   разделы по номеру: 15.4, §3.4.2, 6
#   section.sh <файл> --title "<текст>" [...]         разделы, в заголовке которых есть текст ("T-3 ")
#   section.sh --toc <файл> [глубина]                 оглавление: строка, уровень, ≈токенов, заголовок
#   section.sh --changed <файл> <ревизия>             какие разделы изменились по git diff с ревизией
#
# --with-refs — дочитать разделы этого же файла, на которые ссылается прочитанное («§9.5», «§15.7»), на глубину 1.
#   Ссылки с префиксом другого документа («ТЗ §3.4») не дочитываются.
# Раздел — от заголовка до следующего заголовка того же или более высокого уровня (подразделы входят).
# Номер совпадает, если заголовок начинается с него и дальше идёт «.» или пробел: «### 3.4.2. …», «### 15.4 …».
# Заголовки внутри блоков кода (```) не считаются. Выход 1 — ничего не найдено.
set -euo pipefail

toc() {  # $1 файл, $2 глубина
  awk -v maxd="${2:-6}" '
    /^```/ { fence = !fence }
    !fence && /^#+[ \t]/ { match($0, /^#+/); lvl[++n] = RLENGTH; line[n] = NR; t = $0; sub(/^#+[ \t]+/, "", t); title[n] = t }
    { chars[NR] = length($0) + 1 }
    END {
      for (i = 1; i <= n; i++) {
        end = NR
        for (j = i + 1; j <= n; j++) if (lvl[j] <= lvl[i]) { end = line[j] - 1; break }
        s = 0; for (k = line[i]; k <= end; k++) s += chars[k]
        if (lvl[i] <= maxd) printf "%6d  %s  ≈%6d tok  %s\n", line[i], substr("######", 1, lvl[i]), s / 3, title[i]
      }
    }' "$1"
}

extract() {  # $1 файл, $2 режим id|title, $3 значение → печатает раздел
  awk -v id="$3" -v mode="$2" '
    function is_match(t) {
      if (mode == "title") return index(t, id) > 0
      if (index(t, id) != 1) return 0
      nx = substr(t, length(id) + 1, 1)
      return nx == "." || nx == " " || nx == "\t" || nx == ""
    }
    /^```/ { fence = !fence }
    {
      if (!fence && /^#+[ \t]/) {
        match($0, /^#+/); l = RLENGTH; t = $0; sub(/^#+[ \t]+/, "", t)
        if (on && l <= lvl) on = 0
        if (!on && is_match(t)) { on = 1; lvl = l; if (printed) print ""; printed = 1 }
      }
      if (on) print
    }' "$1"
}

case "${1:-}" in
  --toc) toc "${2:?file}" "${3:-6}"; exit 0 ;;
  --changed)
    file="${2:?file}"; rev="${3:?revision}"
    if ! git cat-file -e "$rev:$file" 2>/dev/null; then echo "ALL (file is new since $rev)"; exit 0; fi
        old_tmp="$(mktemp)"; git show "$rev:$file" > "$old_tmp"
    lines="$( { git diff --no-index -U0 -- "$old_tmp" "$file" || true; } | awk '/^@@/ { …без изменений… }')"
    rm -f "$old_tmp"
    awk -v L="$lines" '
      BEGIN { n = split(L, ch, "\n"); for (i = 1; i <= n; i++) want[ch[i]] = 1 }
      /^```/ { fence = !fence }
      !fence && /^#+[ \t]/ { cur = $0; sub(/^#+[ \t]+/, "", cur) }
      (NR in want) && !(cur in seen) { seen[cur] = 1; print (cur == "" ? "(before first heading)" : cur) }' "$file"
    exit 0 ;;
esac

file="${1:?usage: section.sh <file> <id>... [--with-refs] | --title <text> | --toc <file> | --changed <file> <rev>}"; shift
[[ -f "$file" ]] || { echo "not found: $file" >&2; exit 2; }
mode=id; ids=(); refs=0
while (( $# )); do
  case "$1" in
    --title) mode=title; ids+=("${2:?text}"); shift 2 ;;
    --with-refs) refs=1; shift ;;
    *) ids+=("${1#§}"); shift ;;
  esac
done
(( ${#ids[@]} )) || { echo "no section id given" >&2; exit 2; }

found=0; printed=""; done_ids=" "
for id in "${ids[@]}"; do
  out="$(extract "$file" "$mode" "$id")"
  if [[ -n "$out" ]]; then printf '%s\n' "$out"; found=1; printed+="$out"$'\n'; done_ids+="$id "; else echo "section not found: $id" >&2; fi
done
(( found )) || exit 1

if (( refs )); then
  # ссылки «§N.N» без префикса другого документа (слово перед § не учитываем, если это «ТЗ» или похожее)
  more="$(grep -oE '(^|[^[:alpha:]])(ТЗ |TZ |Spec )?§[0-9]+(\.[0-9]+)*' <<<"$printed" | grep -vE '(ТЗ|TZ|Spec) §' | grep -oE '[0-9]+(\.[0-9]+)*' | sort -uV || true)"
  extra=""
  for r in $more; do
    skip=0
    for d in $done_ids; do [[ "$r" == "$d" || "$r" == "$d".* ]] && skip=1; done
    (( skip )) && continue
    sec="$(extract "$file" id "$r")"; [[ -n "$sec" ]] || continue
    extra+=$'\n'"$sec"$'\n'; done_ids+="$r "
  done
  [[ -n "$extra" ]] && printf '\n<!-- связанные разделы (по ссылкам, глубина 1) -->\n%s' "$extra"
fi
