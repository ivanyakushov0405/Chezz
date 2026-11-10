# Общие функции подмен для deploy/bootstrap.sh (tests/deploy/bootstrap.test.ts).
# Пути @@CFG@@, @@ROOT@@, @@LOG@@, @@REPO@@ подставляет тест. Состояние подменного VPS — файлы в $CFG:
#   users, groups — по имени в строке; primary, members — «пользователь группа»; swaps — включённые swap-файлы;
#   sshd_bad — `sshd -t` → 255.
CFG='@@CFG@@'
ROOT='@@ROOT@@'
LOG='@@LOG@@'
REPO='@@REPO@@'
has_user() { [ -n "$1" ] && grep -qx -- "$1" "$CFG/users"; }
has_group() { [ -n "$1" ] && grep -qx -- "$1" "$CFG/groups"; }
add_member() { grep -qx -- "$1 $2" "$CFG/members" || printf '%s %s\n' "$1" "$2" >> "$CFG/members"; }
