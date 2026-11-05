# F6 — ответ на reopen 1R, раунд 1

Документ: `docs/TESTING.md` v0.3 → v0.4 (2026-11-05), статус «на ревью (reopen)».
Основание: решение Ivan — переоткрыть F1–F6 одним заходом (этап 1R). Вход — OPERATIONS §23 п.10–11; сверка своего 18.2 п.8 с OPERATIONS v0.4.

| ID | Решение | Что сделано или почему нет |
|---|---|---|
| OPERATIONS §23 п.10 | принято | §7.6: при `SEED_TOKEN_SECRET` (staging) токен Session каждого сид-игрока (`--demo` и `--load`) — `HMAC-SHA256(SEED_TOKEN_SECRET, ник)`; без переменной — как прежде; хелпер входа e2e считает cookie той же функцией; пример. Решение V20 (3.3). Применено к обоим режимам: код сида публичен, детерминированные токены `load_*` на staging так же предсказуемы, как `seed_player_*` |
| OPERATIONS §23 п.11 (smoke) | принято | §9: smoke — job `staging` `deploy.yml` после SSH-шагов, `E2E_BASE_URL=${{ vars.APP_ORIGIN }}`, `--project=desktop`, `SEED_TOKEN_SECRET` в env шага. Добавлено следствие OPERATIONS §9.6 п.1: при `E2E_BASE_URL` `webServer` не запускается (staging засеян шагом `up`). Решение V21 |
| OPERATIONS §23 п.11 (нагрузка) | принято | §10: генератор — `tools-staging` через `load.yml` (OPERATIONS §11), `LOAD_BASE_URL` = `APP_ORIGIN`, токены `/tmp/tokens`, отчёт — по `LOAD_REPORT` (`/tmp/report.json`), не `tests/load/report.json`; лимит IP — `RATE_LIMIT_IP_PER_MIN`. §6: у `npm run load` добавлена `LOAD_REPORT`. Решение V21 |
| OPERATIONS §23 п.11 (PostgreSQL) | принято | §7.1: `postgres:18`, как prod (OPERATIONS §6.1, §6.4). Решение V22 |
| TESTING §18.2 п.8 | принято | Сверено с OPERATIONS v0.4 — выполнено всё: `compose.test.yml` §6.4; `ci.yml`, `check`/`e2e`, `if` вместо `paths` §8; обязательные проверки §16.1 п.1; `load.yml` и файл токенов в `tmpfs` §11; smoke и ручной вход §9.6; PostgreSQL 18 §6.1; форки без секретов §8, §16.1 п.4–5. Пункт помечен выполненным со ссылками; невыполненного нет |
| §18.2 (F2/F3/F4/F5) | принято | Добавлена отметка: п.1–5 (F2) и 10 (F3) выполняются в этом reopen их авторами; п.6 (F4) — API v0.4, P32; п.7 (F5) — DESIGN v0.4, U39. П.9 (F8) остаётся |

Итого: принято 6, отклонено 0, человеку 0.

Изменённые разделы: статус и основа (+ OPERATIONS v0.4), «Как читать», 3.3 (новый: V20–V22), 6, 7.1, 7.6, 9, 10, 18.2.
