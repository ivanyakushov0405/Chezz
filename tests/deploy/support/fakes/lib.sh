# Общие функции подменных команд (tests/deploy/support/vps.ts). Пути @@CFG@@, @@LOG@@ подставляет vps.ts.
CFG='@@CFG@@'
LOG='@@LOG@@'
cfg() { if [ -f "$CFG/$1" ]; then cat "$CFG/$1"; else printf '%s' "${2-}"; fi; }
has() { [ -f "$CFG/$1" ]; }
running() { [ -n "$1" ] && [ -f "$CFG/running" ] && grep -qx -- "$1" "$CFG/running"; }
add_running() { local s; for s in "$@"; do running "$s" || printf '%s\n' "$s" >> "$CFG/running"; done; }
del_running() {
  local s
  [ -f "$CFG/running" ] || return 0
  for s in "$@"; do
    grep -vx -- "$s" "$CFG/running" > "$CFG/running.tmp" || true
    mv -f "$CFG/running.tmp" "$CFG/running"
  done
}
rev_of() { [ -n "$1" ] && [ -f "$CFG/revisions" ] && awk -v d="$1" '$1 == d { print $2; exit }' "$CFG/revisions"; }
cur() { cfg current_version ""; }
# bad <режим>: текущая версия app «плохая» и режим поломки совпадает.
bad() {
  local v
  v="$(cur)"
  [ -n "$v" ] && [ -f "$CFG/bad_versions" ] && grep -qx -- "$v" "$CFG/bad_versions" && [ "$(cfg bad_mode up)" = "$1" ]
}
# EC-29: правка клона во время команды (новый файл + mv, как при переключении клона).
tamper() {
  local f
  has tamper || return 0
  has tampered && return 0
  : > "$CFG/tampered"
  for f in "$CHEZZ_ROOT"/repo/deploy/remote/*.sh; do
    [ -f "$f" ] || continue
    printf '#!/usr/bin/env bash\necho tampered\necho result=tampered\nexit 42\n' > "$f.new"
    mv -f "$f.new" "$f"
  done
}
