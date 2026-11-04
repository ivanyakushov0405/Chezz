#!/usr/bin/env bash
# Матрица покрытия ТЗ: какие нумерованные разделы ТЗ упомянуты в документах проекта.
#
#   tz-coverage.sh [--tz docs/TZ.md] [--prefix "ТЗ §"] [--ignore "1 2"] [--md] [источник ...]
#
# Источники по умолчанию: docs/**/*.md (кроме ТЗ и docs/setup/), CLAUDE.md во всех папках.
# Считаются листовые разделы (без подразделов). Лист покрыт, только если на НЕГО есть ссылка «<префикс>N.N»
# или он входит в диапазон «§a–b». Ссылка на раздел выше лист НЕ покрывает — иначе покрытие легко накрутить
# строкой «ТЗ §1 … ТЗ §6». Такие листья показываются отдельно как «только через раздел выше».
# Выход: 0 — непокрытых нет и висячих ссылок нет; 1 — есть; 2 — ошибка вызова.
set -euo pipefail

tz="docs/TZ.md"; prefix="ТЗ §"; ignore=""; md=0; sources=()
while (( $# )); do
  case "$1" in
    --tz) tz="$2"; shift 2 ;;
    --prefix) prefix="$2"; shift 2 ;;
    --ignore) ignore="$2"; shift 2 ;;
    --md) md=1; shift ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) sources+=("$1"); shift ;;
  esac
done
[[ -f "$tz" ]] || { echo "TZ not found: $tz" >&2; exit 2; }
if (( ${#sources[@]} == 0 )); then
  while IFS= read -r -d '' f; do sources+=("$f"); done < <(
    find . \( -path ./node_modules -o -path ./.git \) -prune -o -type f \( -path './docs/*.md' -o -name CLAUDE.md \) -print0 2>/dev/null)
fi
filtered=()
tzreal="$(realpath "$tz")"
for f in "${sources[@]}"; do
  [[ "$(realpath "$f")" == "$tzreal" || "$f" == *docs/setup/* ]] && continue
  filtered+=("$f")
done
(( ${#filtered[@]} )) || { echo "no source documents found" >&2; exit 2; }

num='[0-9]+(\.[0-9]+)*'
dash='(–|—|-)'
# ссылки вида «ТЗ §3.4», «ТЗ §3.8.5–3.8.11», «ТЗ §3.7.2, §3.7.3»
refs_raw="$(grep -ohE "${prefix}${num}(\s*${dash}\s*${num})?(\s*,\s*(§)?\s*${num}(\s*${dash}\s*${num})?)*" "${filtered[@]}" 2>/dev/null || true)"
# ссылки в колонке таблицы с заголовком «ТЗ» без префикса: | … | 3.4.2–3.4.10, 3.8.3 |
col="${prefix%%[[:space:]§]*}"
refs_table="$(awk -F'|' -v col="$col" -v prefix="$prefix" '
  /^\|/ {
    if (idx == 0) { for (i = 1; i <= NF; i++) { c = $i; gsub(/^[ \t]+|[ \t]+$/, "", c); if (c == col) idx = i } ; next }
    c = $idx; gsub(/^[ \t]+|[ \t]+$/, "", c)
    gsub(/§/, "", c); if (c ~ /^[0-9]/) print prefix c
    next
  }
  { idx = 0 }' "${filtered[@]}" 2>/dev/null || true)"
refs_raw="$refs_raw"$'\n'"$refs_table"
# откуда каждая ссылка (для висячих)
refs_where="$(grep -oHnE "${prefix}${num}" "${filtered[@]}" 2>/dev/null || true)"

awk -v md="$md" -v ignore="$ignore" -v prefix="$prefix" -v refs_raw="$refs_raw" -v refs_where="$refs_where" '
function depth(n,  a) { return split(n, a, ".") }
function parent(n) { sub(/\.[0-9]+$/, "", n); return n }
function last(n,  a, k) { k = split(n, a, "."); return a[k] + 0 }
function addref(n) { gsub(/[^0-9.]/, "", n); sub(/\.+$/, "", n); if (n != "") ref[n] = 1 }
function addrange(a, b,   i, p) {
  addref(a); addref(b)
  if (depth(a) == depth(b) && parent(a) == parent(b) && depth(a) > 1)
    for (i = last(a) + 1; i < last(b); i++) addref(parent(a) "." i)
}
BEGIN {
  split(ignore, ig, " "); for (i in ig) skip[ig[i]] = 1
  # разбор ссылок
  nl = split(refs_raw, lines, "\n")
  for (i = 1; i <= nl; i++) {
    s = lines[i]; if (s == "") continue
    sub(prefix, "", s)
    np = split(s, parts, ",")
    for (j = 1; j <= np; j++) {
      p = parts[j]; gsub(/§| /, "", p)
      if (match(p, /(–|—|-)/)) { a = substr(p, 1, RSTART - 1); b = substr(p, RSTART + RLENGTH); addrange(a, b) }
      else addref(p)
    }
  }
}
# разделы ТЗ: «### 3.4.2. Название»
/^#+ [0-9]+(\.[0-9]+)*\. / {
  n = $2; sub(/\.$/, "", n); title = $0; sub(/^#+ [0-9.]+ /, "", title)
  top = n; sub(/\..*/, "", top)
  if (top in skip) next
  order[++cnt] = n; ttl[n] = title; exists[n] = 1; topof[n] = top
  if (!(top in topseen)) { topseen[top] = 1; tops[++ntop] = top; toptitle[top] = (n == top ? title : "") }
}
END {
  for (k = 1; k <= cnt; k++) { n = order[k]; p = n; while (p ~ /\./) { p = parent(p); haschild[p] = 1 } }
  for (k = 1; k <= cnt; k++) {
    n = order[k]
    if (n in ref) st[n] = "direct"
    else {
      st[n] = ""
      p = n; while (p ~ /\./) { p = parent(p); if (p in ref) { st[n] = "parent"; break } }
      if (st[n] == "") for (r in ref) if (index(r, n ".") == 1) { st[n] = "child"; break }
      if (st[n] == "") st[n] = "none"
    }
  }
  # статистика по листьям
  for (k = 1; k <= cnt; k++) { n = order[k]; if (n in haschild) continue
    t = topof[n]; leaves[t]++; L++
    if (st[n] == "direct") { d[t]++; D++ } else if (st[n] == "parent") { pa[t]++; P++ } else if (st[n] == "none") { no[t]++; N++ } else { ch[t]++; C++ } }
  # висячие ссылки
  nd = 0
  for (r in ref) if (!(r in exists)) { top = r; sub(/\..*/, "", top); if (!(top in skip)) dang[++nd] = r }

  if (md) {
    print "# Покрытие ТЗ"
    print ""
    printf "Листовых разделов: %d · **покрыто прямо: %d** · только через раздел выше (не покрыто): %d · без ссылок (не покрыто): %d\n\n", L, D, P, N + C
    print "| Раздел ТЗ | Листьев | Прямо | Только через раздел выше | Без ссылок |"
    print "|---|---|---|---|---|"
    for (i = 1; i <= ntop; i++) { t = tops[i]; printf "| %s. %s | %d | %d | %d | %d |\n", t, toptitle[t], leaves[t], d[t], pa[t], no[t] + ch[t] }
    print ""
    print "## Только через раздел выше — не покрыто"
    print "На лист нет своей ссылки, есть только на главу. Нужна ссылка на сам раздел."
    print ""
    for (k = 1; k <= cnt; k++) { n = order[k]; if ((n in haschild) || st[n] != "parent") continue; print "- §" n " " ttl[n]; sp++ }
    if (sp == 0) print "Нет."
    print ""
    print "## Без ссылок — не покрыто"
    print "Показан верхний раздел ветки без ссылок; его подразделы не повторяются."
    print ""
  } else {
    printf "leaves=%d covered=%d only_parent=%d uncovered=%d dangling=%d\n", L, D, P, N + C, nd
    for (k = 1; k <= cnt; k++) { n = order[k]; if ((n in haschild) || st[n] != "parent") continue; print "ONLY_PARENT " n " " ttl[n] }
  }
  shown = 0
  for (k = 1; k <= cnt; k++) { n = order[k]; if (st[n] != "none" && st[n] != "child") continue
    p = n; up = 0; while (p ~ /\./) { p = parent(p); if ((p in st) && (st[p] == "none" || st[p] == "child")) { up = 1; break } }
    if (up) continue
    printf (md ? "- §%s %s\n" : "UNCOVERED %s %s\n"), n, ttl[n]; shown++ }
  if (md && shown == 0) print "Нет."
  if (md) { print ""; print "## Ссылки на несуществующие разделы" ; print "" }
  for (i = 1; i <= nd; i++) {
    r = dang[i]; where = ""
    nw = split(refs_where, wl, "\n")
    for (j = 1; j <= nw; j++) { w = wl[j]; v = w; sub(/^.*§/, "", v); if (v == r) { split(w, wp, ":"); where = where (where ? ", " : "") wp[1] ":" wp[2] } }
    printf (md ? "- §%s — %s\n" : "DANGLING %s %s\n"), r, where
  }
  if (md && nd == 0) print "Нет."
  exit (N + C + P > 0 || nd > 0)
}' "$tz"
