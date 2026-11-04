# Журнал /setup

Режим: **new** · ветка `setup/foundation` · ТЗ v0.1 (`docs/TZ.md`, 20 пронумерованных разделов)
Прогноз: opus ≈ 36, sonnet ≈ 24 вызова; вход ≈ 481 тыс., выход ≈ 167 тыс. токенов.

## Документы

| F# | Файл | Раздел | Статус |
|---|---|---|---|
| — | `docs/setup/BUSINESS.md` | весь | создан (только по ТЗ, допущения D1–D11) |
| F1 | `docs/GLOSSARY.md` | весь | v0.3, утверждён Ivan 2026-11-04 |
| F2 | `docs/ARCHITECTURE.md` | весь | — |
| F3 | `docs/SECURITY.md` | весь | — |
| F4 | `docs/API_CONVENTIONS.md` | весь | — |
| F5 | `docs/DESIGN_SYSTEM.md` | весь | — |
| F6 | `docs/TESTING.md` | весь | — |
| F7 | `docs/OPERATIONS.md` | весь | — |
| F8 | `.claude/profile.md` и др. | — | — |

## Счётчик вызовов

| Модель | Вызовов |
|---|---|
| opus | 8 |
| sonnet | 3 |

## Вызовы

| # | Агент | Модель | Зона | Что | Итог |
|---|---|---|---|---|---|
| 1 | foundation-author | opus | setup-author | business | заблокирован guard.sh (пути Windows) |
| 2 | foundation-author | opus | setup-author | business, повтор | заблокирован guard.sh |
| 3 | foundation-author | opus | setup-author | business, после фикса kit | BUSINESS.md создан |
| 4 | foundation-author | opus | setup-author | F1 draft | GLOSSARY.md v0.1 |
| 5 | critic tz | opus | setup-critic | F1 r1 | 🔴1 🟠2 🟡3 |
| 6 | critic consistency | sonnet | setup-critic | F1 r1 | 🔴1 🟠2 🟡4 |
| 7 | foundation-author | opus | setup-author | F1 respond r1 | принято 13/13, v0.2 |
| 8 | critic tz | opus | setup-critic | F1 r2 (изменённые §) | 🔴0 🟠0 🟡1 |
| 9 | critic consistency | sonnet | setup-critic | F1 r2, весь документ (финальная сверка) | 🔴0 🟠0 🟡3 |
| 10 | foundation-author | opus | setup-author | BUSINESS + F1 по решениям человека | F1 v0.3, админка/жалобы — вне этапа |
| 11 | critic consistency | sonnet | setup-critic | F1 r3, весь документ | 🔴0 🟠0 🟡3 |
