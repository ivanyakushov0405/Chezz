# apps/server — процесс `app`

Node.js 24 + TypeScript: Fastify, `@fastify/websocket`, Kysely + `pg`, zod (через `packages/protocol`), pino, prom-client, Sentry (ARCHITECTURE §4.1). Метки задач: `[backend:<module>]`; схемы протокола — `[contracts]` в `packages/`.

## Структура (ARCHITECTURE §13.1, §7.2)
```
src/main.ts, src/app.ts       сборка зависимостей; buildApp(config, deps) — для тестов (TESTING §7.3)
src/platform/time.ts          TimeSource
src/<модуль>/                 api.ts → service.ts → domain/, repo.ts; events.ts
src/seo/templates/            HTML публичных страниц (ARCHITECTURE §12.1)
migrations/                   Kysely Migrator, только добавляющие
scripts/seed.ts               сид (TESTING §7.6), не в образе
test/support/                 startApp, фабрики, ManualTimeSource — зона backend
test/contract/, test/acceptance/   тесты tester — не править
```
Модули и разрешённые зависимости — таблица ARCHITECTURE §7.1; владение таблицами — §8.

## Правила (ссылки — читать разделом)
- Слои: `api` не импортирует `repo`; `domain/` без I/O и без `Date.now()` (ARCHITECTURE §7.2).
- Время и таймеры — только `TimeSource` (§7.2, A27).
- Ход — в PostgreSQL одной транзакцией до рассылки (§9.2); в комнате ничего тяжёлого (§9.4).
- Вход — строгая схема; права — в `service`; ошибки — `ErrorCode` (SECURITY §1, §7; API §5).
- Логи и Sentry без ПДн, cookie, токенов; `id` вызова — через `maskChallengeIds` из `packages/protocol` (SECURITY §15).
- Маршрут или сообщение — по API §15; проверки — API §16.
- Тесты разработчика: `*.test.ts` (unit) и `*.int.test.ts` (реальная PostgreSQL) рядом с кодом (TESTING §5).

## Проверки
`npm run check`; `npm run db:test:up && npx vitest run --project int <файл>`; `npx vitest run --project contract <файл>`.
