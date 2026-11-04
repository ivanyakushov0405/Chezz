# Формат профиля проекта

Проектная конкретика конвейера хранится в двух файлах. Каркас (команды, роли, остановки) их читает и сам ничего о проекте не знает. При смене основ меняется профиль, а не каждый агент.

## `.claude/profile.md` — для оркестратора и агентов
Заголовки разделов фиксированы: команды ищут их по имени.

```markdown
# Профиль проекта: <название>

## Документы
| # | Документ | Файл | Раздел |
|---|---|---|---|
| TZ | ТЗ | docs/TZ.md | — |
| F1 | Глоссарий | docs/GLOSSARY.md | — |
| F2 | Архитектура | docs/API_CONVENTIONS.md | §1 |

## Префикс ссылок на ТЗ
ТЗ §

## Приложения и модули
| Имя | Тип | Путь | Группа или слой |
|---|---|---|---|
| api | backend | apps/api | — |
| orders | module | apps/api/src/modules/orders | L2 |

## Метки задач
| Метка | Агент | Зона | Параметр |
|---|---|---|---|
| `[contracts]` | backend-dev | contracts | — |
| `[backend:<module>]` | backend-dev | backend | module |
| `[frontend]` | frontend-dev | frontend | — |
| `[infra]`, `[ci]` | devops | devops | — |
| `[e2e]` | tester | tests | — |

## Правила по зонам
Для ревьюера: какие разделы документов основ содержат MUST / MUST NOT для каждой зоны. Ревьюер проверяет их все, независимо от выжимки архитектора.
| Зона | Разделы |
|---|---|
| backend | docs/ARCHITECTURE.md §2–3; docs/API_CONVENTIONS.md §4, §7; docs/SECURITY.md §2, §5 |
| frontend | docs/DESIGN_SYSTEM.md §1–4; docs/API_CONVENTIONS.md §4; docs/SECURITY.md §6 |
| devops | docs/OPERATIONS.md §2–6; docs/SECURITY.md §7 |

## Проверки
| Имя | Когда | Команда |
|---|---|---|
| typecheck | после разработчика | pnpm turbo typecheck --filter=...[main] |
| boundaries | после разработчика зоны backend | pnpm --filter api lint:boundaries |
| affected-tests | прогон тестов | pnpm turbo test --filter=...[main] |
| infra-up | перед тестами | docker compose -f infra/docker-compose.yml up -d |

## Выкатка
Только запуск CI-workflow. Секреты сред — только в CI; локальной машине доступ к staging и проду не нужен.
ci-workflow: ci.yml          # проверка «main зелёный»
| Имя | Команда |
|---|---|
| deploy-staging | gh workflow run deploy.yml -f env=staging -f version=<версия> |
| smoke-staging | gh workflow run smoke.yml -f env=staging |
| rollback-staging | gh workflow run rollback.yml -f env=staging |
| deploy-prod | gh workflow run deploy.yml -f env=prod -f version=<версия> |
| smoke-prod | gh workflow run smoke.yml -f env=prod |
| post-deploy-check | gh workflow run post-deploy-check.yml -f env=prod -f window=20m |
| rollback-prod | gh workflow run rollback.yml -f env=prod |
Нет раздела или команда — не запуск CI-workflow → `/release` не запускается.

## Трекер
type: files            # files | jira
jira.project: —        # ключ проекта, если jira
jira.epic: Epic
jira.task: Task
jira.status: todo=To Do; in_progress=In Progress; review=In Review; done=Done

## Модели
Opus: analyst, designer, architect, arbiter, reviewer, <разработчики с рисками>
Sonnet: <остальные разработчики>, tester

## Рассуждения
sequential-thinking: off; roles: architect, arbiter; max-thoughts: 8   # on — только если MCP подключён; по умолчанию выключено (дорого)

## Размеры фич
S — без analyst и designer; M — без designer, если нет UI; L — всё.
Лимит вызовов агентов на фичу: 40.
```

## `.claude/zones.conf` — для `check-zone.sh`
Одна строка — одно правило: `<зона> <allow|deny|param> <значение>`. Пустые строки и `#` — комментарии.

```
# зона          вид    шаблон
always          allow  docs/features/*/log.md
analyst         allow  docs/features/{slug}/requirements.md
backend         param  orders billing users
backend         allow  apps/api/src/modules/{param}/**
backend         deny   apps/api/test/contract/**
```
- `*` — любые символы внутри одной папки, `**` — на любую глубину, `{slug}` и `{param}` подставляются;
- `always` — разрешено в любой зоне;
- `param` — допустимые значения параметра зоны; вызов: `check-zone.sh backend:orders`;
- `deny` сильнее `allow`.

Базовые зоны (`always`, setup-*, analyst, roadmap, designer, architect, review) приходят с набором; проектные (tests, разработчики) дописывает `profile-builder`.
