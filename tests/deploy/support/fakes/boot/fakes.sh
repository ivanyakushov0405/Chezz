# Подмены системных команд для deploy/bootstrap.sh (tests/deploy/bootstrap.test.ts).
# Файл режется по строкам «#@@ <имя>»: каждая секция — тело отдельной подмены (после `. lib.sh` и записи argv в журнал).
# Команды без секции (systemctl, ufw, openssl, …) только пишут argv в журнал и выходят с 0.

#@@ useradd
u=""; groups=""; prim=""; nug=0
while [ $# -gt 0 ]; do
  case "$1" in
    -G|--groups) groups="$2"; shift 2 ;;
    --groups=*) groups="${1#*=}"; shift ;;
    -g|--gid) prim="$2"; shift 2 ;;
    --gid=*) prim="${1#*=}"; shift ;;
    -N|--no-user-group) nug=1; shift ;;
    -s|-d|-c|-p|-u|-k|-K|-e|-f|-b|-Z|--shell|--home-dir|--comment|--password|--uid|--skel|--key|--base-dir|--expiredate|--inactive) shift 2 ;;
    -*) shift ;;
    *) u="$1"; shift ;;
  esac
done
[ -n "$u" ] || { echo "useradd: no user name" >&2; exit 2; }
has_user "$u" && { echo "useradd: user '$u' already exists" >&2; exit 9; }
[ -z "$prim" ] || has_group "$prim" || { echo "useradd: group '$prim' does not exist" >&2; exit 6; }
IFS=',' read -r -a gl <<< "$groups"
for g in "${gl[@]}"; do [ -z "$g" ] || has_group "$g" || { echo "useradd: group '$g' does not exist" >&2; exit 6; }; done
if [ -z "$prim" ] && [ "$nug" = 0 ]; then
  has_group "$u" && { echo "useradd: group $u exists - if you want to add this user to that group, use -g." >&2; exit 9; }
  printf '%s\n' "$u" >> "$CFG/groups"
  prim="$u"
fi
printf '%s\n' "$u" >> "$CFG/users"
[ -z "$prim" ] || printf '%s %s\n' "$u" "$prim" >> "$CFG/primary"
for g in "${gl[@]}"; do [ -z "$g" ] || add_member "$u" "$g"; done
mkdir -p "$ROOT/home/$u"
exit 0

#@@ usermod
u=""; groups=""; append=0; setg=0
while [ $# -gt 0 ]; do
  case "$1" in
    -aG|-Ga) append=1; setg=1; groups="$2"; shift 2 ;;
    -G|--groups) setg=1; groups="$2"; shift 2 ;;
    -a|--append) append=1; shift ;;
    -p|--password|-s|--shell|-d|--home|-c|--comment|-g|--gid|-l|--login|-u|--uid|-e|-f) shift 2 ;;
    -*) shift ;;
    *) u="$1"; shift ;;
  esac
done
has_user "$u" || { echo "usermod: user '$u' does not exist" >&2; exit 6; }
if [ "$setg" = 1 ]; then
  IFS=',' read -r -a gl <<< "$groups"
  for g in "${gl[@]}"; do [ -z "$g" ] || has_group "$g" || { echo "usermod: group '$g' does not exist" >&2; exit 6; }; done
  if [ "$append" = 0 ]; then
    awk -v u="$u" '$1 != u' "$CFG/members" > "$CFG/members.tmp"
    mv -f "$CFG/members.tmp" "$CFG/members"
  fi
  for g in "${gl[@]}"; do [ -z "$g" ] || add_member "$u" "$g"; done
fi
exit 0

#@@ groupadd
g=""; force=0
while [ $# -gt 0 ]; do
  case "$1" in
    -f|--force) force=1; shift ;;
    -g|--gid|-K|-p|--key|--password) shift 2 ;;
    -*) shift ;;
    *) g="$1"; shift ;;
  esac
done
[ -n "$g" ] || exit 2
if has_group "$g"; then
  [ "$force" = 1 ] && exit 0
  echo "groupadd: group '$g' already exists" >&2
  exit 9
fi
printf '%s\n' "$g" >> "$CFG/groups"
exit 0

#@@ gpasswd
if [ "${1-}" = -a ]; then
  has_user "$2" || exit 3
  has_group "$3" || exit 3
  add_member "$2" "$3"
fi
exit 0

#@@ getent
case "${1-}" in
  passwd) f=users ;;
  group) f=groups ;;
  *) exit 2 ;;
esac
if [ -z "${2-}" ]; then cat "$CFG/$f"; exit 0; fi
grep -qx -- "$2" "$CFG/$f" || exit 2
if [ "$1" = passwd ]; then
  printf '%s:x:1001:1001::/home/%s:/bin/bash\n' "$2" "$2"
else
  printf '%s:x:1001:%s\n' "$2" "$(awk -v g="$2" '$2 == g { print $1 }' "$CFG/members" | tr '\n' ',' | sed 's/,$//')"
fi
exit 0

#@@ id
u=""; o=""
for a in "$@"; do case "$a" in -*) o="$o${a#-}" ;; *) u="$a" ;; esac; done
if [ -z "$u" ]; then
  case "$o" in
    *u*n*|*n*u*|*G*n*|*n*G*|*g*n*|*n*g*) echo root ;;
    *u*|*g*|*G*) echo 0 ;;
    *) echo "uid=0(root) gid=0(root) groups=0(root)" ;;
  esac
  exit 0
fi
has_user "$u" || { echo "id: '$u': no such user" >&2; exit 1; }
gs="$( { awk -v u="$u" '$1 == u { print $2 }' "$CFG/primary"; awk -v u="$u" '$1 == u { print $2 }' "$CFG/members"; } | tr '\n' ' ' | sed 's/ $//')"
case "$o" in
  *G*n*|*n*G*) echo "$gs" ;;
  *u*n*|*n*u*) echo "$u" ;;
  *u*|*g*|*G*) echo 1001 ;;
  *) echo "uid=1001($u) gid=1001($u) groups=$gs" ;;
esac
exit 0

#@@ chown
spec=""
for a in "$@"; do
  case "$a" in
    -*) ;;
    *)
      if [ -z "$spec" ]; then spec="$a"
      else [ -e "$a" ] || { echo "chown: cannot access '$a': No such file or directory" >&2; exit 1; }
      fi ;;
  esac
done
own="${spec%%:*}"; grp=""
case "$spec" in *:*) grp="${spec#*:}" ;; esac
[ -z "$own" ] || has_user "$own" || { echo "chown: invalid user: '$spec'" >&2; exit 1; }
[ -z "$grp" ] || has_group "$grp" || { echo "chown: invalid group: '$spec'" >&2; exit 1; }
exit 0

#@@ apt-get
case " $* " in
  *" install "*)
    case " $* " in *" docker-ce "*|*" docker.io "*) has_group docker || printf 'docker\n' >> "$CFG/groups" ;; esac ;;
esac
exit 0

#@@ curl
# Сети нет: -o/--output создаёт пустой файл, иначе ничего не печатает.
out=""; want=0
for a in "$@"; do
  if [ "$want" = 1 ]; then out="$a"; want=0; continue; fi
  case "$a" in
    --output=*) out="${a#*=}" ;;
    --output|-o) want=1 ;;
    --*) ;;
    -*o) want=1 ;;
  esac
done
if [ -n "$out" ] && [ "$out" != "-" ]; then mkdir -p "$(dirname "$out")"; : > "$out"; fi
exit 0

#@@ gpg
out=""; want=0
for a in "$@"; do
  if [ "$want" = 1 ]; then out="$a"; want=0; continue; fi
  case "$a" in
    --output=*) out="${a#*=}" ;;
    --output|-o) want=1 ;;
    --*) ;;
    -*o) want=1 ;;
  esac
done
if [ -n "$out" ] && [ "$out" != "-" ]; then mkdir -p "$(dirname "$out")"; : > "$out"; fi
exit 0

#@@ dpkg
case "${1-}" in
  --print-architecture) echo amd64 ;;
  -s|--status|-l|--list) exit 1 ;;
esac
exit 0

#@@ fallocate
p="${!#}"
mkdir -p "$(dirname "$p")"
: > "$p"
exit 0

#@@ mkswap
p="${!#}"
[ -f "$p" ] || { echo "mkswap: cannot open $p" >&2; exit 1; }
exit 0

#@@ swapon
p=""; nh=0; show=""
for a in "$@"; do
  case "$a" in
    /*) p="$a" ;;
    --noheadings) nh=1 ;;
    --show=*) show="${a#*=}" ;;
  esac
done
if [ -n "$p" ]; then
  grep -qx -- "$p" "$CFG/swaps" && { echo "swapon: $p: swapon failed: Device or resource busy" >&2; exit 255; }
  [ -f "$p" ] || { echo "swapon: cannot open $p" >&2; exit 255; }
  printf '%s\n' "$p" >> "$CFG/swaps"
  exit 0
fi
[ -s "$CFG/swaps" ] || exit 0
if [ "$show" = NAME ]; then
  [ "$nh" = 1 ] || echo NAME
  cat "$CFG/swaps"
  exit 0
fi
[ "$nh" = 1 ] || echo "NAME TYPE SIZE USED PRIO"
while IFS= read -r s; do echo "$s file 2G 0B -2"; done < "$CFG/swaps"
exit 0

#@@ sshd
case " $* " in
  *" -t "*|*" -T "*) [ -f "$CFG/sshd_bad" ] && { echo "sshd: bad configuration options" >&2; exit 255; } ;;
esac
exit 0

#@@ git
# git clone: клон с копией deploy/ рабочей копии; остальные подкоманды ничего не делают.
[ "${1-}" = clone ] || exit 0
shift
pos=()
while [ $# -gt 0 ]; do
  case "$1" in
    -b|--branch|--depth|--origin|-o|-c|--config) shift 2 ;;
    -*) shift ;;
    *) pos+=("$1"); shift ;;
  esac
done
t="${pos[1]-}"
[ -n "$t" ] || { echo "fake git: нет каталога назначения" >&2; exit 128; }
if [ -n "$(ls -A "$t" 2>/dev/null)" ]; then
  echo "fatal: destination path '$t' already exists and is not an empty directory." >&2
  exit 128
fi
mkdir -p "$t/.git"
cp -R "$REPO/deploy" "$t/deploy"
exit 0

#@@ docker
# R-e: к любому вызову compose файлы env/prod.env, staging.env, compose.prod.env, compose.staging.env уже созданы.
case " $* " in
  *" compose "*)
    for f in prod.env staging.env compose.prod.env compose.staging.env; do
      [ -f "$ROOT/srv/chezz/env/$f" ] || printf 'R-E-MISSING %s: docker %s\n' "$f" "$*" >> "$LOG"
    done ;;
esac
exit 0

#@@ chpasswd
printf 'chpasswd-stdin %s\n' "$(cat)" >> "$LOG"
exit 0

#@@ debconf-set-selections
cat > /dev/null
exit 0

#@@ sudo
while [ $# -gt 0 ]; do
  case "$1" in
    -u|-g|-C|--user|--group) shift 2 ;;
    --) shift; break ;;
    -*) shift ;;
    *) break ;;
  esac
done
exec "$@"

#@@ runuser
while [ $# -gt 0 ]; do
  case "$1" in
    -u|-g|--user|--group) shift 2 ;;
    --) shift; break ;;
    -*) shift ;;
    *) break ;;
  esac
done
exec "$@"

#@@ su
cmd=""
while [ $# -gt 0 ]; do
  case "$1" in
    -c|--command) cmd="$2"; shift 2 ;;
    -s|--shell|-g|--group) shift 2 ;;
    *) shift ;;
  esac
done
[ -n "$cmd" ] || exit 1
exec bash -c "$cmd"

#@@ lsb_release
case " $* " in
  *c*) echo noble ;;
  *) echo "Ubuntu 24.04 LTS" ;;
esac
exit 0
