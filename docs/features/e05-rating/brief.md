# E05: Рейтинг Glicko-2 — ядро, Rating, RatingHistory, `applyResult`

Slug: `e05-rating` · ROADMAP: E05 · Трекер: KAN-8 · Риск: high (Glicko-2 — профиль, «Режим работы»)

## Цель
Модуль `rating` сервера: Glicko-2 по методу Lichess, без периодов (ТЗ §4.7), сверенный с эталоном (ТЗ §7). Хранит Rating и RatingHistory, отдаёт `applyResult` для транзакции конца партии (ARCHITECTURE §9.1 п.7, §11). Вызывать его будет `games` в E06. Интерфейса нет: показ — E11, таблица лидеров — E14.

## Входит / не входит
- Входит: `rating/domain/glicko2.ts` (`rateMany`, A29) и помощники показа; таблицы `ratings` и `rating_history`; `rating.service`: `getRating`, `getRatings`, `applyResult`; векторы `fixtures/glicko2/` и их прогон; закрытие F6-Q3.
- Не входит: REST `getRatingHistory` и `getLeaderboard` (E11, E14; в `PENDING_CATALOG` остаются), кэш лидеров (E14), вызов из `games` (E06). `packages/protocol` не меняется.

## Критерии готовности
- К-1: `rateMany` проходит векторы видов A и B: пример Glickman, ≥ 30 партий 4 игроков от независимой реализации (F6 §7.5), с допусками вектора.
- К-2: векторы вида C. Перед пересчётом RD растёт по формуле ARCHITECTURE §11 (c = 0,21436 периода в сутки), но не выше 350; при `elapsedDays = 0` роста нет.
- К-3: нет строки Rating → `getRating` отдаёт 1500 / 350 / 0,06, `games_count = 0`; строка в БД не создаётся.
- К-4: `applyResult(trx, …)` в транзакции вызывающего записывает обоим Rating (upsert), `games_count + 1`, `updated_at = ended_at` и две строки RatingHistory (`game_id`, `category`, `rating_before`, `rating_after`). Возвращает `{white, black}` в форме `RatingChange` — целые, округлённые до показа.
- К-5: откат транзакции вызывающего не оставляет изменений ни в `ratings`, ни в `rating_history`.
- К-6: категории независимы: блиц не трогает Rating пули того же игрока.
- К-7: `elapsedDays` — сутки от `updated_at` своей строки Rating до `ended_at`; у белых и чёрных — свои. RD соперника в пересчёте — тоже с ростом за его простой (ARCHITECTURE §11, добавлено после ревью, решение Ivan).
- К-8: показ: `provisional = rd > 110` (110 → нет «?»), рейтинг округляется до целого (ТЗ §4.7).
- E-1: второй `applyResult` с тем же `game_id` — ошибка, рейтинг не пересчитан дважды (уникальный `(game_id, user_id)`).
- E-2: `white_id = black_id` — ошибка до записи.

## Шаги
0. Документы — правка ARCHITECTURE §11, §17 и TESTING §18 (ниже), коммит `docs(...)`.
1. Векторы (слепые тесты, `tester`, режим 1, opus): `fixtures/glicko2/{glickman,sequence,decay}.json`, `README.md` (источник, независимая реализация — F6-Q2, константа F6-Q3); `apps/server/test/acceptance/glicko2-vectors.test.ts`. Красный по причине «нет `rateMany`». К-1, К-2.
2. Ядро: `rating/domain/glicko2.ts` (`rateMany`, рост RD, итерация волатильности ε = 10⁻⁶), `rating/domain/display.ts` (`isProvisional`, `roundRating`) и unit-тесты. Векторы шага 1 зеленеют. К-1, К-2, К-8.
3. Хранение и сервис: миграция `0004_ratings.ts`, `rating/{tables,repo,service}.ts`, `database.ts`, `app.ts` (L2 после `users`), `service.int.test.ts`. К-3…К-7, E-1, E-2.

## Решения
- Рост RD: прибавка σ′² из шага 6 статьи остаётся, а у `lila` её нет (`skipDeviationIncrease = true`). Иначе пример Glickman (вид B, не пропускается) не сходится. Разница при σ = 0,06 — доли процента RD.
- У `rating_history.game_id` пока нет внешнего ключа на `games` — таблицы ещё нет. Ключ добавит E06 своей миграцией.
- Блокировки: в одной транзакции `INSERT … ON CONFLICT DO NOTHING` строк обоих, затем `SELECT … FOR UPDATE` по возрастанию `user_id`, как `lockForGame` (§9.1 п.1).
- Рейтинг хранится как `double precision`, `rating_before` и `rating_after` — без округления. Округление — только при выдаче, поэтому «+12» совпадает с разницей показанных чисел.
- Отвергнуто: взять у `lila` ограничения RD ≥ 45, σ ≤ 0,1, ±700 и τ = 0,75 — в ТЗ §4.7 свои параметры.

## Правки документов основ
1. **ARCHITECTURE §11**, пункт «Рост RD за время без игр…». Было: «константа не задана: открытый вопрос F6-Q3 (17)…» до конца пункта. Стало:
   «- Рост RD за время без игр (метод Lichess; F6-Q3 закрыт в E05 по исходникам `lichess-org/lila` `Glicko.scala` и `scalachess` `RatingCalculator.previewDeviation`): перед пересчётом φ′ = √(φ² + c · elapsedDays · σ²) в шкале Glicko-2, σ — прежняя волатильность, **c = 0,21436** периода в сутки (`lila` `Glicko.periodsPerDay`: RD типичного игрока 60 → 110 за год); RD после роста — не больше 350 (стартовое, G24). Затем — один шаг статьи (шаги 3–8, ε = 10⁻⁶) как период из одной партии; при `elapsedDays = 0` роста нет. Отличие от `lila`: там шаг идёт без прибавки σ′² (`skipDeviationIncrease = true`), у нас прибавка остаётся — иначе не сходятся пример Glickman и векторы «одна партия = один период» (F6 §7.5). Прочие ограничения `lila` (RD ≥ 45, σ ≤ 0,1, изменение ≤ 700, τ = 0,75) не берутся — параметры ТЗ §4.7. `elapsedDays` — сутки от `Rating.updated_at` до конца партии; нет строки Rating — 0. Векторы вида C считаются по этой формуле (F6 §7.5).»
2. **ARCHITECTURE §17** — убрать строку F6-Q3.
3. **TESTING §18.1** — убрать строку F6-Q3. В §18.2 п.3 — «Не выполнено: константа роста RD — F6-Q3…» → «константа роста RD — закрыто в E05 (ARCHITECTURE §11)».

## Вопросы к Ivan
Нет.
