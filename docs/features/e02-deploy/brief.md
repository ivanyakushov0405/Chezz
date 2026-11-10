# Бриф: E02 «Выкатка» — остаток (T-4, T-5)

Продолжение на ветке `feature/e02-deploy` в режиме `/epic`. T-1…T-3 сделаны и закоммичены, тесты T-4 есть (коммит 7a031a4). Требования — `requirements.md` (утверждены), решения и интерфейсы — `design.md` (утверждён); бриф их не повторяет, а ссылается.

**Риск: high** (deploy, ci) — ревью эпика на opus.

## Критерии
Номер К = номер AC в `requirements.md`, чтобы имена тестов не менялись.
- К-45…К-49 (AC-45…AC-49, EC-35, EC-36, A7, R-c, R-e) — `bootstrap.sh` и юниты systemd; проверка — `tests/deploy/bootstrap.test.ts`, `tests/deploy/systemd.test.ts`.
- К-50…К-61 (AC-50…AC-61, EC-1…EC-7, EC-24, EC-30, EC-32, EC-40, EC-41, A6, A10) — `deploy.yml`.
- К-62, К-63 (AC-62, AC-63) — `load.yml`.
- К-64 (AC-64) — `npm run check` зелёный; `ci.yml` не меняется; `dependabot.yml` получает `docker-compose` для `/deploy` (weekly).

## Шаги
1. **T-4 [infra]** — `deploy/bootstrap.sh`, `deploy/systemd/chezz-{backup,staging-ttl}.{service,timer}` по П10, A7, R-e (env-файлы создаются до первого вызова compose), проверка root через `id -u`. Готово: `--project deploy` зелёный, `bash -n`, `check`.
2. **T-5 [ci]** — `.github/workflows/deploy.yml`, `load.yml`, `.github/dependabot.yml` по П11 и OPERATIONS §9–§11. Тесты пишу сам в том же шаге: `tests/deploy/workflows/{deploy.static,deploy.plan,load,dependabot}.test.ts` (разбор `yaml`; блоки `run:` из `plan` выполняются в temp-репозитории с подменой `gh`). Готово: `bash scripts/check-workflows.sh`, `--project deploy`, `check`. Коммит `.github/**` и push — Ivan.
3. **Хвосты документов** — правки ниже, после «да».

## Правки документов основ (⛔)
1. `docs/OPERATIONS.md` §6.1, после строки про `env_file` (добавлена в E02): «- Образы в `compose.yml` имеют значение по умолчанию `chezz.invalid/unset/<пакет>` (`${PROD_APP_IMAGE:-…}`, так же у двух staging): с пустыми `compose.*.env` работают `ps` и `rm`, а `pull` и `up` падают — из зоны `.invalid` образ не скачать.»
2. `docs/ROADMAP.md`, таблица: статус E01 и E03 — «сделан (PR #3)» / «сделан (PR #9)»; E02 — «в работе». (Ivan сказал «да» 2026-11-08.)
3. `.claude/profile.md`, «Эпик «Выкатка»» — убрать `backup.age.pub` (E20) и дописать прогон devops `npx vitest run --project deploy` вместо `test:affected`. Профиль правит Ivan — только предложение, файл не трогаю.

## Вопросы
1. GHCR — вариант (а) из `design.md` (Public вручную после первого `build`) по-прежнему в силе?
2. Шаг 2 даёт `.github/**`: я готовлю файлы и тесты, коммит и push — ваши (у токена нет права Workflows). Так и оставляем?

## Позже (не в этом эпике)
`docker build` в `ci.yml`; таймауты docker-вызовов в `image.image.test.ts`; `db` получает весь `prod.env`; `groupOrder: 3` в TESTING §6; `test:affected` и `deploy-image`; shellcheck для `bootstrap.sh`.
