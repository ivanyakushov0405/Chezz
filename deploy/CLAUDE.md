# deploy, scripts/ops, .github — выкатка и CI

Зона `devops` (метки `[infra]`, `[ci]`). Источник — `docs/OPERATIONS.md` (§1 — правила для агентов).

## Структура (ARCHITECTURE §13.3)
```
deploy/Dockerfile, compose.yml, compose.test.yml, Caddyfile   OPERATIONS §6
.dockerignore (корень, контекст сборки)                        OPERATIONS §6.2 — зона devops
deploy/bootstrap.sh, systemd/                                  §5 (запускает Ivan)
deploy/remote/                entry.sh, deploy.sh, watch.sh, backup.sh — §9.3, §12.3, §14
scripts/ops/                  скрипты Ivan для прода; агенты пишут, не запускают (§15)
.github/workflows/            ci.yml (§8), deploy.yml (§9.2), load.yml (§11)
```

## Правила
- Выкатка, откат, staging, нагрузка — только workflow (`gh workflow run`), запускает оркестратор с подтверждением Ivan (OPERATIONS §1, §10).
- Агентам — нет SSH, ключей, значений секретов, запуска `scripts/ops/` (SECURITY §16).
- Секреты — только environments `prod`/`staging`; не печатать в шагах (OPERATIONS §7, SECURITY §17).
- Триггеры и `permissions` — только по OPERATIONS §8, §9.2; список PR O45 — inline в `deploy.yml` (§9.2а).
- В репозитории нет `example.com`, IP VPS, ключа хоста, имени бакета, ID чата (OPERATIONS §1); проверка — правило в `scripts/check-architecture.sh` (OPERATIONS §8), devops правит только его.
- Первая выкатка — `env=prod` с `bootstrap=true`, запускает Ivan; staging до неё → код 7 (O40, O44). Поэтому эпик «Выкатка» — без staging из ветки (профиль).
- `.github/workflows/**` коммитит и пушит Ivan сам (TESTING §12, OPERATIONS §16.2).

## Проверки
`bash -n <скрипт>`; `bash scripts/check-workflows.sh`; `docker compose -f deploy/compose.yml config -q`; `compose.test.yml` — `docker compose -f deploy/compose.test.yml up -d --wait`; `Dockerfile` или `.dockerignore` — `docker build -f deploy/Dockerfile .` (до мержа образ больше никто не собирает).
