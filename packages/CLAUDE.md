# packages — общий код сервера и клиента

| Пакет | Что | Метка | Источник |
|---|---|---|---|
| `protocol/` | схемы zod и типы REST, WebSocket, `REST_ROUTES`, `ErrorCode`, `PAGES`, снимок `snapshot/protocol.json` | `[contracts]` | API §15, §16 |
| `chess/` | обёртка chess.js: ход, SAN, окончания, «может ли поставить мат» | `[contracts]` | ARCHITECTURE §10 |
| `i18n/` | строки RU/EN и `t()` для `apps/web` и `seo` | `[frontend]` | DESIGN §15 |

## Правила
- Раскладка и имена `protocol` — API §15; ключи `snake_case`, входящие схемы строгие (API §1).
- Несовместимое изменение протокола — `PROTOCOL_VERSION` + 1 в той же задаче (API §7).
- `chess/test/` и `fixtures/` — тесты tester, не править (TESTING §5). Новый баг правил — сначала фикстура (TESTING §7.4).
- `maskChallengeIds(text)` — единственная реализация маскировки `id` вызова, в `protocol`; её импортируют `apps/server` (pino) и `apps/web` (Sentry), unit-тест на каждое поле (SECURITY §15, S37).
- Тесты пакета (`schemas.test.ts`, `snapshot.test.ts`, `pages.test.ts`) — рядом с кодом, проект `unit` (TESTING §11).
- Ключи RU = EN; `error.<code>` на каждый `ErrorCode` (DESIGN §11, §17).
- Задача `[contracts]` идёт до задач, которые используют её схемы (`.claude/profile.md`, «Метки задач»).
- Новый пакет или зависимость — в корне только свой блок: ссылка `tsconfig.json`, `package-lock.json`, вызов `check-api-doc.sh` в `check` (профиль, «Скелет», задача 3).

## Проверки
`npm run check`; `npx vitest run --project unit packages`.
