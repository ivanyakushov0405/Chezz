#!/usr/bin/env bash
# Первичная настройка VPS (OPERATIONS §5; design E02 A7, П10). Запускает Ivan один раз от root:
#   ssh root@<ip> 'bash -s -- --repo-url <url> --ops-key "<ключ>" --ci-prod-key "<ключ>" \
#     --ci-staging-key "<ключ>" --ops-password-hash "<openssl passwd -6>"' < deploy/bootstrap.sh
# Идемпотентен: повторный запуск не дублирует строки, не трогает клон, env-файлы и ключи ops;
# authorized_keys deploy пересобирается из двух строк. Неверный аргумент — код 2 без изменений.
# BOOTSTRAP_ROOT — префикс путей файлов (только тесты, ADR-0011 п.4); на VPS пуст.
# Весь скрипт — функции и один вызов main в последней строке: bash -s читает текст из stdin,
# поэтому stdin команд переключается на /dev/null, чтобы они не съели остаток скрипта.

set -euo pipefail

R="${BOOTSTRAP_ROOT:-}"

KEY_RE='^ssh-ed25519 [A-Za-z0-9+/]+={0,3}( [A-Za-z0-9._@-]+)?$'
URL_RE='^https://github\.com/[A-Za-z0-9-]+/[A-Za-z0-9._-]+\.git$'
HASH_RE='^\$6\$'

ENTRY=/srv/chezz/repo/deploy/remote/entry.sh
TIMERS=(chezz-backup.timer chezz-staging-ttl.timer)
UNITS=(chezz-backup.service chezz-backup.timer chezz-staging-ttl.service chezz-staging-ttl.timer)

usage() {
  echo "bootstrap: $1" >&2
  echo "usage: bash -s -- --repo-url <url> --ops-key <key> --ci-prod-key <key> --ci-staging-key <key> --ops-password-hash <hash>" >&2
  exit 2
}

parse_args() {
  REPO_URL="" OPS_KEY="" CI_PROD_KEY="" CI_STAGING_KEY="" OPS_HASH=""
  local seen=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --repo-url|--ops-key|--ci-prod-key|--ci-staging-key|--ops-password-hash)
        [ $# -ge 2 ] || usage "нет значения у $1"
        case "$1" in
          --repo-url) REPO_URL="$2" ;;
          --ops-key) OPS_KEY="$2" ;;
          --ci-prod-key) CI_PROD_KEY="$2" ;;
          --ci-staging-key) CI_STAGING_KEY="$2" ;;
          --ops-password-hash) OPS_HASH="$2" ;;
        esac
        seen="$seen $1"
        shift 2 ;;
      *) usage "неизвестный аргумент: $1" ;;
    esac
  done
  local a
  for a in --repo-url --ops-key --ci-prod-key --ci-staging-key --ops-password-hash; do
    case "$seen " in *" $a "*) ;; *) usage "нет $a" ;; esac
  done
  [[ "$REPO_URL" =~ $URL_RE ]] || usage "--repo-url: ожидается https://github.com/<владелец>/<репозиторий>.git"
  [[ "$OPS_KEY" =~ $KEY_RE ]] || usage "--ops-key: ожидается одна строка ssh-ed25519"
  [[ "$CI_PROD_KEY" =~ $KEY_RE ]] || usage "--ci-prod-key: ожидается одна строка ssh-ed25519"
  [[ "$CI_STAGING_KEY" =~ $KEY_RE ]] || usage "--ci-staging-key: ожидается одна строка ssh-ed25519"
  [[ "$OPS_HASH" =~ $HASH_RE ]] || usage "--ops-password-hash: ожидается хэш \$6\$ (openssl passwd -6)"
  [ "$(id -u)" = 0 ] || usage "запускать от root"
}

log() { printf 'bootstrap: %s\n' "$*"; }

# Файл целиком из stdin; права и владелец — после записи.
write_file() {
  local path="$1" mode="$2"
  mkdir -p "$(dirname "$path")"
  cat > "$path"
  chmod "$mode" "$path"
}

install_packages() {
  log "пакеты и Docker Engine"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg
  local codename arch
  codename="$(sed -n 's/^VERSION_CODENAME=//p' "$R/etc/os-release" | tr -d '"')"
  arch="$(dpkg --print-architecture)"
  mkdir -p "$R/etc/apt/keyrings"
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o "$R/etc/apt/keyrings/docker.asc"
  chmod 644 "$R/etc/apt/keyrings/docker.asc"
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' \
    "$arch" "$codename" | write_file "$R/etc/apt/sources.list.d/docker.list" 644
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin \
    age rclone curl jq git unattended-upgrades
}

configure_docker_journald() {
  log "docker и journald"
  printf '{"log-driver":"journald","live-restore":true}\n' | write_file "$R/etc/docker/daemon.json" 644
  printf '[Journal]\nMaxRetentionSec=14day\nSystemMaxUse=1G\n' | write_file "$R/etc/systemd/journald.conf.d/chezz.conf" 644
  systemctl restart systemd-journald
  systemctl enable docker
  systemctl restart docker
}

configure_unattended() {
  log "unattended-upgrades: только security, без перезагрузки"
  write_file "$R/etc/apt/apt.conf.d/52chezz-unattended" 644 <<'EOF'
// Chezz (OPERATIONS §5 п.4): только обновления безопасности, без автоматической перезагрузки.
#clear Unattended-Upgrade::Allowed-Origins;
Unattended-Upgrade::Allowed-Origins {
        "${distro_id}:${distro_codename}-security";
        "${distro_id}ESMApps:${distro_codename}-apps-security";
        "${distro_id}ESM:${distro_codename}-infra-security";
};
Unattended-Upgrade::Automatic-Reboot "false";
EOF
  write_file "$R/etc/apt/apt.conf.d/20auto-upgrades" 644 <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
}

create_users() {
  log "пользователи ops и deploy"
  groupadd -f ops
  if id ops >/dev/null 2>&1; then
    usermod -aG sudo,docker ops
  else
    useradd -m -s /bin/bash -g ops -G sudo,docker ops
  fi
  usermod -p "$OPS_HASH" ops
  if id deploy >/dev/null 2>&1; then
    usermod -aG docker,ops deploy
  else
    useradd -m -s /bin/bash -G docker,ops deploy
  fi
}

install_keys() {
  log "authorized_keys"
  local ops_ssh="$R/home/ops/.ssh" deploy_ssh="$R/home/deploy/.ssh"
  mkdir -p "$ops_ssh" "$deploy_ssh"
  chmod 700 "$ops_ssh" "$deploy_ssh"
  if [ ! -e "$ops_ssh/authorized_keys" ]; then
    printf '%s\n' "$OPS_KEY" | write_file "$ops_ssh/authorized_keys" 600
  fi
  printf 'command="%s prod",restrict %s\ncommand="%s staging",restrict %s\n' \
    "$ENTRY" "$CI_PROD_KEY" "$ENTRY" "$CI_STAGING_KEY" | write_file "$deploy_ssh/authorized_keys" 600
  chown -R ops:ops "$ops_ssh"
  chown -R deploy:deploy "$deploy_ssh"
}

configure_firewall() {
  log "ufw"
  ufw default deny incoming
  ufw allow 22/tcp
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw allow 443/udp
  ufw --force enable
}

configure_swap() {
  log "swap 2 ГБ"
  local sw="$R/swapfile" line="/swapfile none swap sw 0 0"
  if [ ! -f "$sw" ]; then
    fallocate -l 2G "$sw"
    chmod 600 "$sw"
    mkswap "$sw"
  fi
  if ! swapon --show=NAME --noheadings | grep -qxF -- "$sw"; then
    swapon "$sw"
  fi
  grep -qxF -- "$line" "$R/etc/fstab" || printf '%s\n' "$line" >> "$R/etc/fstab"
}

make_dir() {
  local path="$1" owner="$2" mode="$3"
  mkdir -p "$path"
  chown "$owner" "$path"
  chmod "$mode" "$path"
}

# Пустой файл, только если его нет (OPERATIONS §5: существующие *.env не перезаписываются; design R-e).
make_empty_file() {
  local path="$1" mode="$2"
  if [ ! -e "$path" ]; then
    : > "$path"
    chmod "$mode" "$path"
    chown deploy:ops "$path"
  fi
}

create_dirs() {
  log "каталоги /srv/chezz, /var/lib/chezz, /var/backups/chezz"
  make_dir "$R/srv/chezz" root:root 755
  make_dir "$R/srv/chezz/repo" deploy:deploy 755
  make_dir "$R/srv/chezz/env" deploy:ops 2750
  make_dir "$R/srv/chezz/state" deploy:ops 2750
  make_dir "$R/var/lib/chezz" deploy:ops 770
  make_dir "$R/var/backups/chezz" deploy:deploy 700
  local env="$R/srv/chezz/env"
  make_empty_file "$env/prod.env" 600
  make_empty_file "$env/staging.env" 600
  make_empty_file "$env/compose.prod.env" 640
  make_empty_file "$env/compose.staging.env" 640
}

clone_repo() {
  local dir="$R/srv/chezz/repo"
  if [ -e "$dir/.git" ]; then
    log "клон уже есть — не трогаю (переключает только prod deploy, O9)"
    return
  fi
  log "клон main"
  # cwd и HOME root недоступны deploy — git запускается из / с его HOME.
  (cd / && runuser -u deploy -- env HOME=/home/deploy git clone --branch main "$REPO_URL" "$dir")
}

install_units() {
  log "юниты systemd"
  local u
  mkdir -p "$R/etc/systemd/system"
  for u in "${UNITS[@]}"; do
    cp "$R/srv/chezz/repo/deploy/systemd/$u" "$R/etc/systemd/system/$u"
    chmod 644 "$R/etc/systemd/system/$u"
  done
  systemctl daemon-reload
  systemctl enable --now "${TIMERS[@]}"
}

# Последним: ошибка в конфиге не должна закрыть доступ (design R-c) — перезапуск только после sshd -t.
configure_sshd() {
  log "sshd"
  write_file "$R/etc/ssh/sshd_config.d/00-chezz.conf" 644 <<'EOF'
# Chezz (OPERATIONS §5 п.2)
PasswordAuthentication no
PermitRootLogin no
AllowUsers ops deploy
EOF
  sshd -t
  systemctl restart ssh
}

main() {
  parse_args "$@"
  exec < /dev/null
  install_packages
  configure_docker_journald
  configure_unattended
  create_users
  install_keys
  configure_firewall
  configure_swap
  create_dirs
  clone_repo
  install_units
  configure_sshd
  log "готово. Дальше — IP и known_hosts в vars environments, затем deploy.yml env=prod bootstrap=true (OPERATIONS §5)"
}

main "$@"; exit $?
