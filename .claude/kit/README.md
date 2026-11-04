# Набор агентской разработки

Универсальная папка `.claude` для Claude Code. Ничего не знает о конкретном проекте: всю конкретику создаёт `/setup` из ТЗ и ограничений бизнеса.

## Что внутри
```
.claude/
  settings.json               хук-охранник и запреты: секреты, kit, команды, force-push; подтверждение push и запуска CI
  commands/
    setup.md        /setup    — ТЗ → документы основ с критикой → конвейер; reopen F<N>; tz-changed
    roadmap.md      /roadmap  — ТЗ → эпики (файлы или Jira)
    feature.md      /feature  — эпик → требования → макеты → план → задачи → PR
    fix.md          /fix      — баг, рефакторинг, зависимости, хотфикс
    release.md      /release  — только через CI: staging → smoke → ⛔ прод → наблюдение → откат
  agents/
    foundation-author.md      пишет документы основ и отвечает на критику
    critic.md                 критикует по одной линзе
    profile-builder.md        собирает конвейер: профиль, зоны, агентов, CLAUDE.md
  zones.conf                  зоны агентов (проектные дописывает /setup)
  kit/
    DOCUMENTS.md              документы основ F1–F8, порядок, линзы, цикл, экономия токенов
    PROFILE_FORMAT.md         формат .claude/profile.md и .claude/zones.conf
    lenses/                   tz, security, proportionality, consistency, agentability, roster
    templates/agents/*.tmpl   analyst, designer, architect, arbiter, developer, devops, tester, reviewer
    hooks/guard.sh            PreToolUse: блокирует запись вне зоны, коммиты агентов, правку .claude и .env
    scripts/
      check-zone.sh           begin/end вокруг агента: снимок дерева, конфиг из снимка, ловит коммиты
      section.sh              раздел файла, --with-refs, оглавление, --changed по git diff
      tz-convert.sh           Word → docs/TZ.md с проверкой нумерации
      tz-coverage.sh          покрытие ТЗ: лист покрыт только своей ссылкой
      tz-diff.sh              сравнение редакций ТЗ: перенумерация и переиспользованные номера
      token-report.sh         стоимость промптов и документов; --forecast setup
```

## Требования
Claude Code, git, bash. Опционально: jq (хук работает и без него), pandoc (ТЗ из Word), gh (CI, PR, выкатка), Atlassian MCP (Jira), MCP инструмента макетов.

## Как начать
1. Скопируйте `.claude/` в корень репозитория, `chmod +x .claude/kit/scripts/*.sh .claude/kit/hooks/*.sh`, закоммитьте.
2. Положите ТЗ (Word или markdown).
3. `/setup new` → ответы о бизнесе (нагрузка, команда, бюджет — обязательно цифрами) → документы по одному → конвейер → пробная фича. Затем новая сессия Claude Code.
4. `/roadmap` → `/feature <эпик> размер S|M|L` → `/release`.

## Защита в два слоя
1. **Хук** (`kit/hooks/guard.sh`) блокирует действие в момент вызова: запись вне зоны активного агента, git commit/push агентом, правку `.claude/kit`, `.claude/commands`, настроек и `.env`.
2. **Проверка после агента** (`check-zone.sh end`): состояние до вызова — хеш дерева git, который хранит оркестратор; правила зон и сам скрипт берутся из этого снимка, а не из рабочей копии; коммит агента — нарушение.
Ни один слой не держится только на тексте промпта.
