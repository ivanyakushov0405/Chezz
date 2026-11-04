#!/usr/bin/env bash
# Сравнение двух редакций ТЗ: перенумерация, изменённый текст, удалённые и новые разделы,
# **переиспользованные номера** (старый номер теперь означает другой раздел) и какие ссылки в документах это задевает.
#
#   tz-diff.sh <старое ТЗ> <новое ТЗ> [--prefix "ТЗ §"] [--md] [источник ...]
#   Старое ТЗ обычно берут из git:  git show HEAD:docs/TZ.md > /tmp/tz-old.md
#
# Разделы сопоставляются по заголовку (без номера), затем — по совпадению текста. Источники по умолчанию —
# как у tz-coverage.sh: docs/**/*.md (кроме ТЗ и docs/setup/) и CLAUDE.md.
# Выход: 0 — редакции эквивалентны по нумерации и тексту; 1 — есть что проверить; 2 — ошибка вызова.
set -euo pipefail

old="${1:?usage: tz-diff.sh <old> <new> [--prefix P] [--md] [sources...]}"; new="${2:?new TZ}"; shift 2
prefix="ТЗ §"; md=0; sources=()
while (( $# )); do case "$1" in --prefix) prefix="$2"; shift 2 ;; --md) md=1; shift ;; *) sources+=("$1"); shift ;; esac; done
[[ -f "$old" && -f "$new" ]] || { echo "file not found" >&2; exit 2; }
if (( ${#sources[@]} == 0 )); then
  while IFS= read -r -d '' f; do sources+=("$f"); done < <(
    find . \( -path ./node_modules -o -path ./.git \) -prune -o -type f \( -path './docs/*.md' -o -name CLAUDE.md \) -print0 2>/dev/null)
fi
src=(); for f in "${sources[@]}"; do [[ "$f" == *docs/setup/* || "$f" -ef "$old" || "$f" -ef "$new" ]] && continue; src+=("$f"); done

mapfile_out="$(awk -v md="$md" '
function norm(s) { gsub(/[ \t\r]+/, " ", s); sub(/^ /, "", s); sub(/ $/, "", s); return s }
FNR == 1 { f++; cur = "" }
/^```/ { fence[f] = !fence[f] }
!fence[f] && /^#+ [0-9]+(\.[0-9]+)*\. / {
  n = $2; sub(/\.$/, "", n); t = $0; sub(/^#+ [0-9.]+ /, "", t); t = norm(t)
  cur = n; if (f == 1) { on[++oc] = n; ot[n] = t } else { nn[++nc] = n; nt[n] = t }
  next
}
cur != "" { s = norm($0); if (s == "") next; if (f == 1) ob[cur] = ob[cur] " " s; else nb[cur] = nb[cur] " " s }
END {
  # сопоставление по заголовку: при нескольких кандидатах — тот же номер, иначе первый свободный
  for (i = 1; i <= nc; i++) { n = nn[i]; byt[nt[n]] = byt[nt[n]] " " n }
  for (i = 1; i <= oc; i++) {
    o = on[i]; k = split(byt[ot[o]], c, " "); best = ""
    for (j = 1; j <= k; j++) if (c[j] == o && !(c[j] in used)) best = c[j]
    if (best == "") for (j = 1; j <= k; j++) if (!(c[j] in used)) { best = c[j]; break }
    if (best != "") { map[o] = best; used[best] = 1 }
  }
  # оставшиеся — по совпадению текста (заголовок переименован)
  for (i = 1; i <= oc; i++) { o = on[i]; if ((o in map) || ob[o] == "") continue
    for (j = 1; j <= nc; j++) { n = nn[j]; if (!(n in used) && nb[n] == ob[o]) { map[o] = n; used[n] = 1; ren[o] = 1; break } } }
  for (i = 1; i <= oc; i++) { o = on[i]
    if (!(o in map)) { print "REMOVED\t" o "\t-\t" ot[o]; continue }
    n = map[o]; kind = ""
    if (n != o) kind = kind "RENUMBERED,"
    if (ren[o]) kind = kind "RETITLED,"
    if (ob[o] != nb[n]) kind = kind "CHANGED,"
    if (kind != "") { sub(/,$/, "", kind); print kind "\t" o "\t" n "\t" ot[o] }
    if ((o in nt) && map[o] != o) print "REUSED\t" o "\t" o "\t" "старый: " ot[o] " → теперь: " nt[o]
  }
  for (j = 1; j <= nc; j++) { n = nn[j]; if (!(n in used)) print "ADDED\t-\t" n "\t" nt[n] }
}' "$old" "$new")"

[[ -z "$mapfile_out" ]] && { echo "Редакции совпадают по нумерации и тексту."; exit 0; }

refs_for() {  # строки документов со ссылкой на номер $1 (точное совпадение номера)
  local num="${1//./\\.}"
  (( ${#src[@]} )) || return 0
  grep -nHE "${prefix}${num}([^0-9.]|\.[^0-9]|$)" "${src[@]}" 2>/dev/null | cut -d: -f1,2 | paste -sd' ' - || true
}

if (( md )); then
  echo "# Сравнение редакций ТЗ"; echo
  printf '%s\n' "$mapfile_out" | awk -F'\t' '{ split($1, k, ","); for (i in k) c[k[i]]++ } END {
    printf "Перенумеровано: %d · переименовано: %d · изменён текст: %d · удалено: %d · добавлено: %d · **номер теперь означает другой раздел: %d**\n\n",
      c["RENUMBERED"], c["RETITLED"], c["CHANGED"], c["REMOVED"], c["ADDED"], c["REUSED"] }'
  echo "| Что | Было | Стало | Раздел | Ссылки в документах |"; echo "|---|---|---|---|---|"
fi
attention=0
while IFS=$'\t' read -r kind o n title; do
  refs=""; [[ "$o" != "-" ]] && refs="$(refs_for "$o")"
  [[ "$kind" != ADDED ]] && attention=1
  if (( md )); then printf '| %s | %s | %s | %s | %s |\n' "$kind" "$o" "$n" "$title" "${refs:-—}"
  else printf '%s\t%s\t%s\t%s\t%s\n' "$kind" "$o" "$n" "$title" "$refs"; fi
done <<<"$mapfile_out"
if (( md )); then
  echo; echo "**REUSED** — самое опасное: ссылка «${prefix}N» не стала висячей, но теперь ведёт на другой раздел. Каждую такую ссылку нужно исправить на новый номер."
  echo "Ссылки в колонках таблиц без префикса сравнение не видит — их проверяет критик tz."
fi
exit $attention
