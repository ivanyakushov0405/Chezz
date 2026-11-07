# Ревью e02-deploy

## T-1 — итерация 1
Вердикт: CHANGES_REQUESTED
### Блокеры
- [eslint.config.js:11, :77-93] `tests/deploy/**/*.ts` добавлен в `VITEST_FILES`, и на него действует общий запрет `skipIf`. Исключения для `tests/deploy/` нет. Проверено: `it.skipIf(process.platform === "win32")(...)` в `tests/deploy/x.test.ts` даёт ошибку `no-restricted-syntax` («.skipIf запрещены… только векторы вида C»). TESTING §1 (V24) и design (A1, «Выжимка» tests, ADR п.5) это исключение прямо разрешают. Тесты прав файлов из T-2…T-4 без него не пройдут `npm run check`, а eslint.config.js не входит в зону tester. → Что сделать: добавить блок для `files: ["tests/deploy/**/*.ts"]` по образцу `GLICKO_VECTORS`. В нём `.only/.skip/.todo/runIf` остаются запрещены, а `skipIf` разрешён только с аргументом `process.platform === "win32"`. Пример селектора запрета: `CallExpression[callee.object.name=/^(it|test|describe|suite)$/][callee.property.name='skipIf']:not([arguments.0.type='BinaryExpression'][arguments.0.operator='==='][arguments.0.left.object.name='process'][arguments.0.left.property.name='platform'][arguments.0.right.value='win32'])`. Если `vitest/no-disabled-tests` тоже срабатывает на `skipIf`, выключить его только в этом блоке. Обновить комментарий у `GLICKO_VECTORS`: «единственное место» уже не так. Проверить, что `it.skipIf(process.platform === "win32")` проходит линт, а `it.skipIf(true)` и `it.skip` дают ошибку. Пункты чек-листа: 2а (TESTING §1, §11), 1 (design T-1: «правила Vitest» для `tests/deploy/**` с учётом исключения V24).

### Желательно
- [vitest.config.ts:72] `groupOrder: 3` у `deploy-image` — отступление, в design его нет. Оно разумно: проект не идёт параллельно с `int`/`contract`, которые делят тестовую БД, а AC-5 запускает `app` на той же БД. Предлагаю принять и отразить в TESTING §6 → architect-apply.
- [package.json:19] `test:affected` (`vitest run --changed origin/main`) захватит проект `deploy-image`, если меняются `*.image.test.ts` или `tests/deploy/support/*`. Тогда локальному прогону нужны Docker и сеть. CI это не затрагивает: в `ci.yml` нет `test:affected`. Стоит упомянуть в TESTING §6 рядом с примечанием про `--changed` → architect-apply.
- [vitest.config.ts:73-77] У `deploy-image` нет явного `exclude`, работает значение Vitest по умолчанию. Это корректно. Для симметрии с `deploy` можно указать `exclude: ["**/node_modules/**"]`. Это вкусовое замечание.
- Согласованность с основой tester 89edfb1 в порядке: `tests/deploy/tsconfig.json` (`lib: es2024`, `types: node`, `include: **/*.ts`) совпадает с design; ссылка в корневом `tsconfig.json` есть; `support/bash.ts` подхватывается ESLint и `tsc -b`. Тесты tester не изменены: `git diff` по `tests` и `fixtures` пуст.
- Зависимость `yaml@^2.9.1` (devDependency, ISC, без транзитивных) — причина указана в design T-1, требование SECURITY §18 выполнено.

## T-1 — итерация 2
Вердикт: CHANGES_REQUESTED
Блокер итерации 1 закрыт по сути. Сам проверил линтом через stdin на `tests/deploy/x.test.ts`: `it.skipIf(process.platform === "win32")` проходит; `it.skipIf(true)`, `it.skipIf(process.platform !== "win32")`, `it.skip`, `it.only` падают. Комментарий у `GLICKO_VECTORS` обновлён.
### Блокеры
- [eslint.config.js:113-128] Новый блок ослабил запрет `.skip` в `tests/deploy/` по сравнению с общим блоком `VITEST_FILES`. Проверено линтом: в `tests/deploy/` проходят `it.concurrent.skip(...)` и `const s = it.skip; s(...)`. В `apps/server/test/` оба варианта дают ошибку. Причин две. (1) `"vitest/no-disabled-tests": "off"`: правило на `skipIf` не срабатывает (проверено: с ним `skipIf(process.platform === "win32")` даёт rc=0), поэтому выключать его не нужно. При этом TESTING §11 разрешает снимать его только для 7.5 (вид C). (2) В блоке пропал селектор `MemberExpression[...][property.name=/^(only|skip|todo)$/]`. → Что сделать: удалить строку `"vitest/no-disabled-tests": "off"`; вернуть в `no-restricted-syntax` блока селектор `MemberExpression[object.name=/^(it|test|describe|suite)$/][property.name=/^(only|skip|todo)$/]` из общего блока; в первом селекторе блока оставить `bench`, как в общем. Проверить, что `it.concurrent.skip` и `const s = it.skip` падают, а `it.skipIf(process.platform === "win32")` проходит. Пункт чек-листа 2а (TESTING §1, §11).
### Желательно
- Позже (исполнитель не трогал, оставлено по указанию оркестратора): все пункты «Желательно» итерации 1 — `groupOrder: 3` → TESTING §6, примечание про `test:affected` и `deploy-image` (→ architect-apply), явный `exclude` у `deploy-image`.

## T-1 — лимит раундов
k = 4 > 3. Выбор Ivan (2026-11-08): (1) подсказка и ещё 2 раунда.

## T-1 — итерация 3
Вердикт: APPROVE
Блокер итерации 2 закрыт. Блок `tests/deploy/**/*.ts` (eslint.config.js:112-131) больше не выключает `vitest/no-disabled-tests`; селектор `MemberExpression` вернулся; для `it.concurrent.*` добавлен свой селектор. Сам проверил линтом через stdin на `tests/deploy/x.test.ts`. Без ошибок проходят `it.skipIf(process.platform === "win32")`, `it(...)`, `it.concurrent(...)`. Ошибку дают `it.skipIf(true)`, `it.skip`, `it.concurrent.skip`, `const s = it.skip`, `describe.only`, `it.todo`, `it.runIf(true)`. TESTING §1 и §11 соблюдены.
### Блокеры
- нет
### Желательно
- [eslint.config.js:123] Сообщение у селектора `concurrent` не упоминает `.runIf`, хотя селектор его ловит. Это косметика.
- Позже: пункты «Желательно» итерации 1 — `groupOrder: 3` → TESTING §6, примечание про `test:affected` и `deploy-image` (→ architect-apply), явный `exclude` у `deploy-image`.
