# Chezz

Веб-сервис онлайн-шахмат: вход через Google, вызовы и автоподбор, Glicko-2, таблица лидеров. Бета до 1 000 игроков, один VPS (BUSINESS §1). Разрабатывает и сопровождает Ivan с агентами.

## Документы
Основы — `docs/` (F1–F7, пути и роли — `.claude/profile.md`, «Документы»). Большие — **только разделами**: `.claude/kit/scripts/section.sh <файл> <номер>`, оглавление — `section.sh --toc <файл> 3`. В каждом документе §1 — «Правила для агентов».
Конвейер: `.claude/profile.md` (метки, зоны, проверки, выкатка), `docs/PIPELINE_DECISIONS.md` (откуда каждое решение).

## Структура (ARCHITECTURE §13)
```
apps/server/      Node.js 24 + TS, процесс app: модули src/<модуль>/ (ARCHITECTURE §7)
apps/web/         Vite + React SPA (ARCHITECTURE §12, DESIGN_SYSTEM)
packages/         protocol (схемы zod), chess (правила), i18n (RU/EN)
fixtures/, tests/ тесты тестировщика (TESTING §5)
deploy/, scripts/ops/, .github/   выкатка и CI (OPERATIONS)
```
Корневые конфиги (`package.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.*`, `package-lock.json`) правят backend, contracts и frontend — каждый свой блок, по очереди (профиль, «Метки задач»).

## Главные правила
- Имена — только из `docs/GLOSSARY.md` (GLOSSARY §1, §12).
- Один процесс `app`; новый сервис, хранилище, внешний сервис — только правкой документов (ARCHITECTURE §1, §14).
- Ход, часы, итог решает сервер; типы протокола — только `packages/protocol` (ARCHITECTURE §1, API §1).
- «Кто я» — из Session; секретов и ПДн нет в коде, логах, репозитории (он публичный) (SECURITY §1).
- Вне этапа — жалобы, админ-панель, бан, турниры, бот, чат (BUSINESS §1.7, GLOSSARY §3).
- Тесты tester пишет до кода; developer их не правит (TESTING §1).

## Команды (TESTING §6; из корня, на Windows — Git Bash)
```
npm run db:test:up        PostgreSQL для тестов (Docker Desktop)
npm run check             tsc + ESLint + Stylelint + границы + сверка API
npm run test:affected     затронутое (перед ним git fetch origin main)
npm run test:e2e          Playwright
```

## Git, GitHub, выкатка (OPERATIONS §1, §10, §16)
- Агенты не коммитят и не пушат. Коммитит оркестратор, конкретными путями.
- Сессия — только fine-grained токен (`GH_TOKEN`, OPERATIONS §16.2). Нельзя: `gh api`, `curl`/`wget` к GitHub, `gh auth|secret|variable|repo edit`, `gh run cancel|rerun`, `gh pr review`, обёртки вокруг них.
- Перед `git push` и `gh pr merge` с изменениями `.github/`, `deploy/`, `scripts/ops/` — показать Ivan diff этих путей (O36). Мерж — только `gh pr merge <N> --match-head-commit <SHA своего push>`.
- `.github/workflows/**` коммитит и пушит Ivan сам (у токена нет права Workflows).
- Выкатка — только CI-workflow из профиля, раздел «Выкатка»; `bootstrap=true`, `image=`, `force=` — только Ivan.
