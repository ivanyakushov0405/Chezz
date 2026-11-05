# apps/web — SPA

Vite + React + TypeScript, CSS Modules, chessground, Stockfish WASM в Web Worker, `lucide-react` (ARCHITECTURE §4.2, §12). Метка задач: `[frontend]`.

## Структура (ARCHITECTURE §12)
```
src/pages/                  страницы
src/features/<модуль>/      доменные компоненты (games, challenges, rating …)
src/shared/api/             клиент REST и WebSocket поверх packages/protocol
src/shared/ui/              общие компоненты (DESIGN §7) и tokens.css
public/pieces/<set>/, public/sounds/   статика с LICENSE.md
```
Экраны и состав — DESIGN §9; состояния — DESIGN §10.4; макеты — Figma (DESIGN §16).

## Правила (ссылки — читать разделом)
- Стили — CSS Modules + токены; литералов цвета и размеров нет (DESIGN §1, §3, §17).
- Экран: `data-screen`, `data-state`, все состояния своей строки §10.4, `AsyncState` (DESIGN §10).
- Строки — ключи RU и EN в `packages/i18n` (DESIGN §15).
- 360 px без прокрутки, клавиатура, контраст AA (DESIGN §8, §14).
- Типы — только `packages/protocol`; адреса — `PAGES` (API §14); клиент не решает исход партии (ARCHITECTURE §10).
- Главная ≤ 300 КБ gzip; Stockfish — лениво и со своего домена (ARCHITECTURE §12).
- Sentry: `sendDefaultPii: false`, `beforeSend`/`beforeBreadcrumb` через `maskChallengeIds` из `packages/protocol`, без Session Replay (SECURITY §15).
- Нет UI-кита, Tailwind, CSS-in-JS, чужих шрифтов и CDN (DESIGN §1).
- Тесты разработчика — `*.test.tsx` рядом с компонентом, Vitest + jsdom (TESTING §5).

## Проверки
`npm run check`; `npx vitest run --project unit apps/web packages/i18n`.
