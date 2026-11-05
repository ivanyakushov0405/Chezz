# Reopen 1R — consistency, раунд 2

## Статус прошлых находок
- **consistency-1 🟠: закрыта.** ARCHITECTURE A29 и §11 задают `rateMany(player, games, elapsedDays)`, зеркально вектору TESTING 7.5. Владелец F6-Q3 один: architect фичи `rating`, ответ вносится только в ARCHITECTURE §11; ARCHITECTURE §17 и TESTING §18.1 согласованы. TESTING 7.5: вид B пропускается, только пока нет `rateMany`, вид C ждёт константу. TESTING 18.2 п.3 помечен «выполнен частично».
- **consistency-2 🟡: закрыта.** GLOSSARY §13: Q6 → SECURITY S15/§13, Q10 → S23/§16.
- **consistency-3 🟡: закрыта.** Устаревших оговорок «правка в F3-Q3» в SECURITY и ARCHITECTURE нет; сам F3-Q3 открыт честно.
- **consistency-4 🟡: закрыта.** ARCHITECTURE A28, §9.1 п.1, §7.3; API P33 и 12.3; коды `player_busy`, `opponent_busy`, `challenge_cancelled`, `unauthenticated` есть в каталоге F4; SECURITY §13 даёт тот же смысл.
- **consistency-5 🟡: закрыта для F1–F6.** Шапки F2–F6 ссылаются на GLOSSARY v0.4, ARCHITECTURE v0.5, SECURITY v0.4, API v0.4, DESIGN v0.4 с пометкой «утверждаются вместе». Остаток — шапка F7 (см. «Вне линзы»).

## Сверка новых правок
- A28/P33 ↔ F3 §13: согласованы.
- A29 `rateMany` ↔ F6 §7.5, F6-Q3: согласованы.
- V23 `seedSessionToken` ↔ F6 §7.6/§9: формула HMAC и 43 символа base64url совпадают с F3 §5 и F7 O15. F3 §17 функцию не упоминает, только потребителей `SEED_TOKEN_SECRET`; расхождения нет.
- S37 ↔ F7 O18: согласованы (`:id` после `/challenge/` и `/api/challenges/`, `/game/<id>` не маскируется).
- Права env в F3 S24, §16, §17 ↔ F7 §7: совпадают (600 `deploy` для `prod.env`/`staging.env`; 640 `deploy:ops` для `ops.env` и `compose.*.env`).
- GLOSSARY §13 Q6/Q10 ↔ F3: согласованы.
- F4-Q8: 4.3 «MUST NOT `system` до ответа», срок — до первой фичи `settings`; совпадает с §17.
- Путь `tests/e2e/support/open-screen.ts` одинаков в F5 U39 и F6 §9.
- Дублей номеров в таблицах решений нет.

## 🔴
Нет.

## 🟠
Нет.

## 🟡
Нет.

## Вне линзы
- Шапка F7 (v0.4, утверждён) ссылается на GLOSSARY v0.3 и ARCHITECTURE v0.4; после утверждения reopen устареет.
- F7 §23 пометить выполненным и убрать обратную ссылку F7 §6.1 → F2 §5 (tz-5) при следующем reopen F7. Автор уже отметил оба пункта.

## Счёт
🔴 0 / 🟠 0 / 🟡 0
