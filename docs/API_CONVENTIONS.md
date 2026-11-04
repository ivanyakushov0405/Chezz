# F4. API-конвенции

Статус: утверждён (Ivan, 2026-11-04), версия 0.3 от 2026-11-04 (ответ на ревью — `docs/setup/reviews/F4-response-r1.md`; ответы человека на F4-Q1..Q3 — P14, P15, P25, 12.2). Основа: `docs/TZ.md` v0.1, `docs/setup/BUSINESS.md`, `docs/GLOSSARY.md` v0.3, `docs/ARCHITECTURE.md` v0.4, `docs/SECURITY.md` v0.3 (все утверждены), `docs/adr/`.
Утверждает: Ivan (BUSINESS D9).

Как читать: агент открывает только нужный раздел. 1 — правила, 2 — решения (2.1 транспорт и ошибки, 2.2 пагинация, версии и каталог REST, 2.3 realtime, 2.4 решения ревью r1), 3 — транспорт и адреса, 4 — формат JSON и общие объекты (4.1 правила, 4.2 игроки и партии, 4.3 аккаунт и состояние партии), 5 — ошибки, 6 — пагинация, 7 — версии, 8 — WebSocket: подключение, конверт, подписки, 9 — WebSocket: партия, 10 — переподключение и закрытие, 11 — межмодульное взаимодействие, 12 — каталог REST (12.1–12.6), 13 — каталог WebSocket, 14 — маршруты SPA, 15 — как добавить маршрут или сообщение, 16 — проверки, 17 — открытые вопросы и правки для reopen. Номера: решения `P#`, вопросы `F4-Qn`; ссылки — `GLOSSARY G#`, `ARCHITECTURE A#` / `§N`, `SECURITY S#` / `§N`.

- Где F3 уточняет F2 (список SECURITY F3-Q3), этот документ следует F3.
- Источник правды для чисел и форм — разделы 3–16; в таблице решений они повторены справочно. Расхождение — ошибка документа, верен раздел.

## 1. Правила для агентов

Как проверяется каждое правило — раздел 16.

- MUST: схемы запросов, ответов и сообщений WebSocket — в `packages/protocol` по раскладке и именам раздела 15; типы — `z.infer` (ARCHITECTURE A14). В `apps/web` и `apps/server` своих типов протокола нет.
- MUST: ключи JSON и параметры запроса — `snake_case`, имена и значения перечислений — из `docs/GLOSSARY.md` и раздела 4. Новое поле, которого нет ни там, ни в разделе 4, — сначала строкой в 17.2, потом в код.
- MUST: входящие тела и сообщения — строгая схема (`z.strictObject`): лишнее поле — `validation_failed` (SECURITY §1). Клиент разбирает ответы сервера нестрого.
- MUST: ошибка — только формат раздела 5 и код из `ErrorCode` (5.2). Новый код — строкой в 5.2 в той же задаче.
- MUST: «кто я» — только из Session (SECURITY §1). В телах и сообщениях нет `user_id`, `creator_id`, `white_id`, цвета стороны.
- MUST: столбец «Кто» в разделах 12 и 13 — точный список; остальным — `unauthenticated` (гость), `onboarding_required` (П1), `forbidden` или код, указанный в строке.
- MUST: команды партии из 9.1, помеченные `ply`, несут его; сервер не принимает их с чужим `ply`. Подписки и `pong` `ply` не несут.
- MUST: время с клиента не принимается ни в каком виде (SECURITY §8).
- MUST: изменяющие REST — только POST/PATCH (DELETE не используется), с проверкой `Origin` (SECURITY §6); GET ничего не меняет.
- MUST NOT: заголовки CORS и `@fastify/cors` — SPA и API на одном origin (раздел 3).
- MUST NOT: версия в URL (`/api/v1`) — версия одна (раздел 7).
- MUST NOT: эндпоинты и сообщения для того, что вне этапа: жалобы, админ-панель, бан, аннулирование, дашборд (GLOSSARY §3, BUSINESS §1.7).
- MUST NOT: поля User вне публичной проекции (SECURITY §12); своё — только в `Me`.

## 2. Таблица решений

Источники: ТЗ, бизнес, по умолчанию, ревью. У «по умолчанию» — более простая альтернатива и почему не она. Номера P# сквозные.

### 2.1. Транспорт, формат, ошибки

| № | Решение | Источник | Альтернатива и почему не она |
|---|---|---|---|
| P1 | REST + JSON под `/api`, вход — переходы `/auth/google/*`, одно WebSocket-подключение `/ws` на вкладку; только HTTPS и `wss://` (раздел 3) | ТЗ §5, §6; ARCHITECTURE A1, §12; SECURITY §6 | Всё через WebSocket — теряются HTTP-статусы, `Origin` на POST и простые тесты REST |
| P2 | Ключи JSON и query — `snake_case`; пути REST — строчные, ресурсы во множественном числе, слова через `-`. Ресурс профиля в API — `profiles` (глоссарий «Профиль», модуль `profile`), страница SPA — `/player/:nickname` (адрес для людей). Закрывает GLOSSARY G4 для JSON | GLOSSARY G4; ARCHITECTURE A23; по умолчанию; ревью r1 (consistency-7) | `camelCase` в JSON — у поля два написания, нужен слой переименования |
| P3 | `id` — строка; время — ISO 8601 UTC с мс; длительности — целые мс с `_ms`; контроль — секунды (G5); рейтинг — целое (раздел 4.1) | ТЗ §4.5, §4.7; GLOSSARY G5; по умолчанию | Unix-время числом — нечитаемо в логах; секунды в часах — теряются доли для ≤ 0,5 с (ТЗ §7) |
| P4 | Пустое — `null`; в ответах все поля схемы присутствуют; в запросах необязательные можно опускать | по умолчанию | Опускать пустые поля — у клиента два случая (`undefined` и `null`) |
| P5 | Успех — ресурс без конверта; ошибка — `{"error": {…}}` с кодом из `ErrorCode`, интерфейс показывает `error.<code>` (раздел 5). Исключение — `GET /api/health` (12.6) | ТЗ §5 «Локализация»; GLOSSARY §12; по умолчанию | Только статус и текст — нельзя отличить «вызов истёк» от «уже принят» |
| P6 | HTTP-статусы — 200, 201, 204, 302, 400, 401, 403, 404, 409, 413, 415, 429, 500, 503 (5.2, 12.6) | по умолчанию; 503 — ревью r1 (consistency-3) | 422 для доменных ошибок — граница «400 или 422», агенты разойдутся |

### 2.2. Пагинация, версии, каталог REST

| № | Решение | Источник | Альтернатива и почему не она |
|---|---|---|---|
| P7 | Курсорная пагинация — только история партий; остальные списки — одним ответом (раздел 6) | ТЗ §4.8, §4.9; по умолчанию | `offset` — новая партия сдвигает страницы, в списке дубль |
| P8 | Одна версия протокола `PROTOCOL_VERSION`; несовпадение → `client_outdated`, перезагрузка (раздел 7) | ARCHITECTURE §5 (один образ); по умолчанию | `/api/v1` — внешних клиентов нет; без проверки старая вкладка получает непонятные `validation_failed` |
| P9 | Лобби и Seek — только WebSocket; Seek снимается, когда у игрока закрыто последнее соединение; после переподключения подбор начинается заново (осознанная цена: окно ±100 и отсчёт 60 с с нуля) | ТЗ §4.3, §4.4; ARCHITECTURE §6.1; по умолчанию; ревью r1 (tz-4) | Держать Seek после обрыва — подбор сведёт ушедшего, а при перезапуске Seek всё равно теряется (память) |
| P10 | `/api/me` гостю — `200 {"user": null}`; в `Me` — `active_game_id`, `open_challenge_id` | ТЗ §7 «после перезагрузки»; по умолчанию | 401 гостю — ошибка в консоли на каждой странице |
| P11 | Удалённый игрок — `nickname: null`, перевод делает клиент; PGN — теги ставит сервер (SECURITY S13) | ТЗ §4.1 п.6; по умолчанию | Строка с сервера — у сервера нет языка интерфейса |
| P12 | Feedback — `multipart/form-data` с лимитами 12.6; `meta.browser` — из `User-Agent` | ТЗ §4.12; SECURITY §11; по умолчанию | base64 в JSON — +33% и лимит 16 КБ тела |
| P13 | С клиента — только событие `analysis_opened`, не чаще одного на (игрок или IP, партия) в сутки (12.4) | ARCHITECTURE §7.5; по умолчанию; ревью r1 (sec-8) | Свободное имя и без дедупликации — скрипт накручивает метрику |
| P14 | Свой контроль: `time_base` 30–3600 с, `time_increment` 0–30 с | ТЗ §4.5 («до 60+30»); нижняя граница `time_base` ≥ 30 с — человек, утверждение F4, 2026-11-04 (F4-Q1) | Без нижней границы — контроль 0+0 |
| P15 | История — `finished` и `aborted`; фильтр по результату обязателен: «все» (параметра нет) / «только победы» (`outcome=win`) / «только поражения» (`outcome=loss`) относительно владельца профиля; ничьи и отмены видны только в «все»; статистика — только `finished` | ТЗ §4.2, §4.9; человек, утверждение F4, 2026-11-04 (F4-Q2) | Скрывать `aborted` — не найти отменённую партию |
| P16 | `GET /api/health` наружу — только `{"status"}`; версия образа — метрика `app_info{version}` на внутреннем `/metrics` (SECURITY S32) | по умолчанию; ревью r1 (sec-9); smoke — F7 | Версия в публичном ответе — подсказка сканеру |

### 2.3. Realtime

| № | Решение | Источник | Альтернатива и почему не она |
|---|---|---|---|
| P17 | Конверт — плоский объект с `type = "<область>.<действие>"`; команды — повелительные, события — прошедшее время или `*.state`; `ref` связывает ошибку с командой (8.2) | ARCHITECTURE A14; по умолчанию | `{type, payload}` — лишняя вложенность; без `ref` не понять, что отклонено |
| P18 | Подписки: `lobby` и одна партия на соединение; личные события — на все соединения игрока; после `game.started` клиент сам шлёт `game.subscribe` (8.3) | ТЗ §4.3, §4.6; по умолчанию; ревью r1 (consistency-2) | Сервер подписывает сам — события партии придут во все вкладки, ломая «одна партия на соединение» |
| P19 | `ply` — число полуходов в позиции, которую видел клиент; принимается, только если равно текущему (9.2) | SECURITY S10; форма — по умолчанию | Номер ожидаемого хода (+1) — два смысла одного поля |
| P20 | Часы — остатки на момент отправки + `running`; клиент отсчитывает от получения, синхронизации нет (9.4) | ТЗ §4.6, §7; ARCHITECTURE §9.2; по умолчанию | Синхронизация часов — сложнее, а ошибка схемы ≈ задержка в одну сторону (≤ 150 мс, ТЗ §5) |
| P21 | RTT — прикладные `ping`/`pong` раз в 5 с; тот же обмен — признак мёртвого соединения (9.4) | ARCHITECTURE A11; по умолчанию | Ping-кадры протокола — JS их не видит, клиенту нужен второй механизм |
| P22 | Переподключение с нарастающей паузой, повтор подписок, неподтверждённые команды не повторяются (раздел 10) | ТЗ §4.6, §7; по умолчанию | Повтор хода — ход мог стать неуместным после хода соперника |
| P23 | Время на ход для разбора — из `Move.clock_ms` (прошлый остаток − новый + `time_increment`) = списанное сервером время с учётом компенсации, точно до мс. Отвечает на вопрос ARCHITECTURE §9.2 | ТЗ §4.9; по умолчанию | Отдельное поле — дублирует остатки |

### 2.4. Решения ревью r1

| № | Решение | Источник | Альтернатива и почему не она |
|---|---|---|---|
| P24 | Подбор — только пресеты `TIME_CONTROL_PRESETS`; свой контроль — только у Challenge | ТЗ §4.3 п.1, §4.4 п.1, §7 «≤ 20 с»; GLOSSARY G15; ревью r1 (tz-1) | Свой контроль в подборе — заявке 7+4 почти никогда нет пары (сводятся только одинаковые) |
| P25 | `rating_range` — целое 50–300 (±) или `null`, только у `type = open` | ТЗ §4.3 п.3; границы 50–300 — человек, утверждение F4, 2026-11-04 (F4-Q1); ограничение по типу — по умолчанию; ревью r1 (tz-2) | Разрешить у `link` — проще схема, но сопернику по ссылке создатель и так выбрал сам; ограничение только отклонит друга |
| P26 | Гость и П1 читают всё публичное как гость, включая разбор `/game/:id/analysis` (считается в браузере) | ТЗ §3, §4.9; SECURITY §7; по умолчанию; ревью r1 (tz-3, consistency-4) | Разбор только Игроку (ТЗ §3) — серверу он ничего не стоит, а гость с ссылкой на партию упрётся во вход |
| P27 | Сверка кода с документом — тесты и скрипт раздела 16 | ревью r1 (agentability-2) | Только ревью PR — дрейф кода и каталога неизбежен |
| P28 | Лимит соединений — upgrade принимается и закрывается кодом 4003 `too_many_connections`; клиент не переподключается сам | SECURITY §9; ревью r1 (consistency-5) | HTTP 429 на upgrade — браузер видит только 1006 и переподключается бесконечно |
| P29 | `game.resign`, `game.abort`, `game.abandonment_choice` — без `ply` | ТЗ §4.6; ревью r1 (вне линзы security) | `ply` у сдачи — в пуле сдача опаздывает на ход соперника и отклоняется |

## 3. Транспорт и адреса

| Что | Адрес | Формат |
|---|---|---|
| REST | `https://<домен>/api/...` | `application/json; charset=utf-8`; тело ≤ 16 КБ (SECURITY §9) |
| Вход Google | `GET /auth/google/start`, `GET /auth/google/callback` | переходы браузера, 302 (SECURITY §4) |
| WebSocket | `wss://<домен>/ws?protocol_version=<N>` | текстовые кадры, один JSON-объект на кадр, входящий ≤ 4 КБ |
| Страницы | раздел 14 | HTML (ARCHITECTURE §12.1) |
| Метрики | `/metrics` на отдельном порту, наружу не публикуется (SECURITY S32) | — |

- Домен — `example.com` до ARCHITECTURE F2-Q5.
- MUST: `X-Protocol-Version` на каждом запросе SPA к `/api` (раздел 7).
- MUST: POST без тела допустим (`accept`, `cancel`, `logout`); с телом — только `application/json`, кроме Feedback. `Origin` — на всех POST/PATCH (SECURITY §6).
- MUST NOT (sec-1): CORS. SPA и API — один origin; локально — прокси Vite (`server.proxy` для `/api`, `/auth`, `/ws`) на `app`. Ответ на запрос с чужим `Origin` не содержит `Access-Control-Allow-Origin` (тест, раздел 16).
- Ответы `/api` — `Cache-Control: no-store`.
- `X-Request-Id`: id генерирует только сервер (`crypto.randomUUID()`, Fastify `genReqId`, `requestIdHeader: false`); входящий заголовок игнорируется. То же значение — в теле ошибки и в логе (SECURITY §15).
- Превышение REST — 429 + `Retry-After`; WebSocket — разделы 5.2 и 10.

## 4. Формат JSON и общие объекты

### 4.1. Правила

- Ключи — `snake_case`; значения перечислений — как в глоссарии: `bullet`, `white_wins`, `threefold_repetition`, `link`.
- `id` — строка; клиент не разбирает формат. `Game.id`, `Challenge.id` — UUID v4 (SECURITY S9).
- Время — `"2026-11-04T18:03:12.517Z"`; длительности — целые мс (`white_ms`, `remaining_ms`).
- Контроль — секунды: `{"time_base": 180, "time_increment": 2}` = «3+2»; показ строит клиент (G5).
- Рейтинг — целое, округлено сервером (ТЗ §4.7); `provisional = rd > 110` считает сервер; `rd`, `volatility` наружу не отдаются.
- Обозначения ниже: `T | null` — может быть `null`; `A[]` — массив; `"a" | "b"` — перечисление; `int` — целое.
- Имена объектов — имена схем в `packages/protocol/src/common.ts` (раздел 15). Это технические проекции протокола, не сущности (17.2).

### 4.2. Игроки и партии

| Объект | Поля и типы |
|---|---|
| `PublicUser` | `id`; `nickname: string | null` (`null` — удалённый); `avatar_url: string | null`; `country: string | null` (ISO 3166-1 alpha-2, верхний регистр); `created_at` (SECURITY §12) |
| `PlayerRef` | `id`; `nickname: string | null`; `rating: int | null`; `provisional: boolean` |
| `RatingEntry` | `category`; `rating: int`; `provisional: boolean`; `games_count: int` |
| `Move` | `san: string`; `clock_ms: int` — остаток сходившей стороны после хода, с добавкой |
| `GameSummary` | `id`; `white`, `black: PlayerRef`; `category`; `time_base: int`; `time_increment: int`; `rated: boolean`; `status`; `result | null`; `termination | null`; `started_at`; `ended_at | null` |
| `RatingChange` | `rating_before: int`; `rating_after: int` |
| `Game` | `GameSummary` + `moves: Move[]` + `ratings: {white: RatingChange, black: RatingChange} | null` (`null`, если рейтинг не менялся) |
| `Challenge` | `id`; `creator: PlayerRef` (рейтинг в категории вызова); `category`; `time_base`; `time_increment`; `rated`; `color`; `type`; `rating_range: int | null`; `status`; `expires_at`; `game_id | null` |

- `white`, `black`, `creator` — объекты вместо `white_id`, `black_id`, `creator_id` глоссария: клиенту нужен ник и рейтинг (17.2 п.6).
- `PlayerRef.rating` в `Game`/`GameSummary` — до партии: `ratings.*.rating_before` у рейтинговой законченной, текущий Rating у `active`, иначе `null`.
- Пример `Move` блица 3+2 (ARCHITECTURE §9.2): `{"san": "Nf3", "clock_ms": 159180}`.
- MUST NOT: `fen` (GLOSSARY G26) и `pgn` в `Game` — PGN отдаёт 12.4.

### 4.3. Аккаунт и состояние партии

| Объект | Поля и типы |
|---|---|
| `UserSettings` | `theme: "light" | "dark"` (по умолчанию `light`); `sound: boolean` (`true`); `board_theme: string` и `piece_set: string` — значения из списков `BOARD_THEMES`, `PIECE_SETS` в `common.ts`, до F5 — по одному значению `default` (F4-Q4); `auto_queen: boolean` (`true`); `confirm_move_mobile: boolean` (`false`) |
| `Me` | `PublicUser` + `email: string | null`; `locale: "ru" | "en"`; `settings: UserSettings`; `terms_accepted_at | null`; `can_change_nickname: boolean`; `onboarding_required: boolean`; `active_game_id | null`; `open_challenge_id | null` |
| `Clock` | `white_ms: int`; `black_ms: int`; `running: "white" | "black" | null` (`null` — часы стоят: до старта, в окне выбора, после конца) |
| `Offer` | `{"by": "white" | "black"} | null` |
| `Reconnect` | `{"color": "white" | "black", "remaining_ms": int} | null` — чей таймер переподключения идёт |
| `AbandonmentChoice` | `{"remaining_ms": int} | null` — окно выбора 30 с (GLOSSARY G21) |
| `Connected` | `{"white": boolean, "black": boolean}` |

- Значения по умолчанию `UserSettings` — по умолчанию F4; F5 может поменять.
- `PATCH /api/me`: `settings` — частичный `UserSettings` (`.partial()`, но `.strict()`).

## 5. Ошибки

### 5.1. Формат

REST: `{"error": {"code": "challenge_expired", "message": "Challenge expired", "details": null, "request_id": "…"}}`.
WebSocket: `{"type": "error", "ref": "m42", "code": "not_your_turn", "game_id": "9a1c…", "details": null}` (`ref`, `game_id` — `null`, если нет).

- Интерфейс показывает перевод `error.<code>` (GLOSSARY §12), не `message`. `message` — короткий английский текст без данных пользователя.
- `details` — у `validation_failed`: `{"issues": [{"path": "time_increment", "rule": "max"}]}` без входных значений (SECURITY §15); у `rate_limited` — `{"retry_after_ms": 4000}`; у остальных — `null`.
- `internal` — без подробностей; причина — в лог и Sentry с тем же `request_id`.
- Сервис бросает `AppError(code)` из `platform`; `api.ts` / `realtime` ставит статус по 5.2. Неизвестное исключение → `internal`.
- Общие коды любого маршрута: `validation_failed`, `unauthenticated`, `onboarding_required`, `origin_forbidden`, `client_outdated`, `rate_limited`, `internal`. Особые коды маршрута — колонка «Ошибки» каталога 12.

### 5.2. Коды

| `code` | HTTP | Когда (пример) |
|---|---|---|
| `validation_failed` | 400 | лишнее поле `user_id`; `time_increment: 45`; плохой курсор |
| `invalid_time_control` | 400 | контроль вне P14 (например `time_base: 20`); не пресет в `seek.start` (P24); `rating_range` вне 50–300 или у `link` (P25) |
| `nickname_invalid` | 400 | `Конь`, `ab` (ТЗ §4.1 п.3) |
| `nickname_reserved` | 400 | `admin` (SECURITY S14) |
| `unauthenticated` | 401 | гость на маршруте игрока; гость шлёт `seek.start` |
| `onboarding_required` | 403 | ник не выбран или правила не приняты (SECURITY §5) |
| `origin_forbidden` | 403 | `Origin` чужой или нет (SECURITY §6) |
| `forbidden` | 403 | отмена чужого вызова (SECURITY §7) |
| `delete_confirmation_invalid` | 403 | нет `__Host-del` или истёк (SECURITY §4.1) |
| `not_found` | 404 | нет партии, вызова, профиля |
| `client_outdated` | 409 | версия протокола не совпала (раздел 7) |
| `onboarding_completed` | 409 | Игрок повторно шлёт `POST /api/me/onboarding` (ник — только через смену, ТЗ §4.1 п.3) |
| `nickname_taken` | 409 | `Magnus` при занятом `magnus` |
| `nickname_change_used` | 409 | вторая смена ника |
| `open_challenge_exists` | 409 | второй открытый вызов (ТЗ §4.3 п.5) |
| `player_busy` | 409 | у самого игрока `active` Game: создать или принять вызов, `seek.start` (ТЗ §4.3 п.5, ARCHITECTURE A25) |
| `opponent_busy` | 409 | создатель вызова сейчас в партии (ARCHITECTURE §9.1 п.3) |
| `own_challenge` | 409 | принять свой вызов |
| `rating_out_of_range` | 409 | рейтинг 1980 при вызове ±300 от 1600 (G19) |
| `challenge_expired` / `challenge_cancelled` / `challenge_taken` | 409 | вызов истёк (30 мин) / отменён / уже принят |
| `account_has_active_game` | 409 | удаление во время партии (SECURITY S17) |
| `game_not_active` | 409 | PGN идущей партии; и в WebSocket — команда после конца партии |
| `payload_too_large` | 413 | скриншот 6 МБ; тело > 16 КБ |
| `screenshot_unsupported` | 415 | `report.svg` (SECURITY §11) |
| `rate_limited` | 429 | 301-й запрос за минуту; 21-е сообщение подряд в WebSocket |
| `internal` | 500 | необработанная ошибка |

Только WebSocket (ответ `error`; «снимок» — сервер дополнительно шлёт `game.state`):

| `code` | Когда | Снимок |
|---|---|---|
| `too_many_connections` | 6-е соединение игрока, 51-е без Session с IP (SECURITY §9); затем закрытие 4003 | нет |
| `not_a_participant` | зритель шлёт `game.resign` | нет |
| `ply_mismatch` | повтор уже сделанного хода; ход по устаревшей позиции | да |
| `not_your_turn` | белые ходят, когда очередь чёрных | да |
| `illegal_move` | `e1g1` при битом поле | да |
| `takeback_not_allowed` | возврат хода в рейтинговой (ТЗ §4.6) | нет |
| `abort_not_allowed` | отмена после 2-го хода каждой стороны | нет |
| `offer_not_open` | принять уже снятую ничью | да |
| `own_offer` | принять своё предложение (S29) | нет |
| `abandonment_choice_not_open` | выбор вне окна 30 с (G21) | да |

- `game_not_active` в WebSocket — со снимком.
- Порядок проверок команды партии: права соединения (8.1) → участник → `game_not_active` → `ply` → очередь → допустимость.
- Пример «вызов истёк»: `POST /api/challenges/3f9c…/accept` через 31 мин → `409 {"error": {"code": "challenge_expired", …}}`, экран «Вызов истёк».

## 6. Пагинация

Только история партий (P7, ТЗ §4.9).

- Запрос: `?limit=20&cursor=<строка>`; `limit` 1–50, по умолчанию 20; первой странице `cursor` не передаётся.
- Ответ: `{"items": GameSummary[], "next_cursor": string | null}`.
- Порядок — `started_at` убыв., затем `id` убыв.; запрос — keyset `WHERE (started_at, id) < ($1, $2)`, без `OFFSET`.
- MUST (sec-7): курсор — base64url от JSON `[started_at, id]`; после декодирования он проходит схему `z.tuple([z.iso.datetime(), z.uuid()])` и попадает в SQL только параметрами. Иначе — `validation_failed`.
- Фильтры при листании — те же, что для первой страницы.
- Без пагинации: лидеры (100), лобби (≤ 1 открытый вызов на игрока), график рейтинга, 10 последних партий профиля.
- Пример: `GET /api/profiles/knight_rider-7/games?category=blitz&outcome=loss` → 20 партий и `next_cursor`; дальше — тот же запрос + `&cursor=…`.

## 7. Версии

- `PROTOCOL_VERSION` — целое в `packages/protocol/src/version.ts`. SPA шлёт его в `X-Protocol-Version` и `?protocol_version=`. Число `3` в примерах — только пример.
- Несовпадение: REST — `409 client_outdated`; WebSocket — `error client_outdated` и закрытие 4002. Клиент один раз перезагружает страницу.
- Несовместимое изменение (номер +1): удаление, переименование, смена типа или смысла поля; новое обязательное поле запроса; новое значение перечисления в ответе. Совместимое (без смены): новое поле ответа, новый маршрут, новый `type` события (клиент игнорирует незнакомое).
- MUST: смена `PROTOCOL_VERSION` — в той же задаче; в PR — строка «protocol: N → N+1, причина». Изменение снимка схем без смены номера объясняется в PR как совместимое (раздел 16).
- Без проверки версии: `/auth/*`, страницы, `/api/health`.

## 8. WebSocket: подключение, конверт, подписки

### 8.1. Подключение и права соединения

1. `wss://<домен>/ws?protocol_version=N`. На upgrade — `Origin`, лимит REST, cookie `__Host-sid` (SECURITY §5, §6, §9).
2. Версия не совпала → `error client_outdated`, закрытие 4002. Лимит соединений → `error too_many_connections`, закрытие 4003 (P28).
3. Иначе `welcome`: `{"type": "welcome", "protocol_version": int, "user": {"id", "nickname"} | null, "ping_interval_ms": 5000}`; если у игрока есть Seek — `seek.state`.
4. Клиент подписывается (8.3); активную партию берёт из `/api/me` (P10).

Права соединения (sec-3): соединение гостя или П1 (SECURITY S5) принимает только `pong`, `lobby.subscribe`, `lobby.unsubscribe`, `game.subscribe`, `game.unsubscribe`. Остальное — `error` с `unauthenticated` (гость) или `onboarding_required` (П1), без снимка; модулям такая команда не передаётся.

### 8.2. Конверт и порядок

- Один объект с полем `type`; схемы — `z.discriminatedUnion("type", …)` отдельно для «клиент → сервер» и «сервер → клиент».
- `type` — `<область>.<действие>`; области — `game`, `lobby`, `seek`, `challenge`, `session`; служебные — `welcome`, `ping`, `pong`, `error`.
- `ref` — необязательная строка ≤ 16 символов; сервер возвращает её только в `error`. Успех отдельно не подтверждается: подтверждение — само событие (`game.moved` с новым `ply`).
- Порядок: события одной партии — в порядке фиксации в `GameRoom` (ARCHITECTURE A9) и только после коммита (§9.2). Между партиями и лобби порядок не гарантирован.
- Разрыв последовательности: `game.moved.ply` ≠ локальная длина `moves` + 1 → клиент шлёт `game.subscribe` и получает `game.state`.
- Незнакомый `type` от сервера клиент игнорирует; от клиента — `validation_failed`.

### 8.3. Подписки

| Тема | Команда | Кто | Сразу | Дальше |
|---|---|---|---|---|
| лобби | `lobby.subscribe` / `lobby.unsubscribe` | все | `lobby.state` | `lobby.challenge_added`, `lobby.challenge_removed` |
| партия | `game.subscribe` / `game.unsubscribe` (`game_id`) | все (зритель, SECURITY S28) | `game.state` | 9.3 |
| личное | без подписки | И | — | `game.started`, `challenge.closed`, `seek.state`, `seek.suggest_challenge` |

- Одна партия на соединение: новый `game.subscribe` заменяет прежнюю.
- MUST (consistency-2): `game.started` не подписывает. Каждая вкладка игрока, получив его, переходит на `/game/<game_id>` и шлёт `game.subscribe`.
- MUST: вызов по ссылке не попадает в `lobby.*` (SECURITY §7).
- «все» = гость, П1 и Игрок.

## 9. WebSocket: партия

### 9.1. Команды игрока

Форма: `{"type", "ref"?, "game_id"}` + поля ниже. Кто — участник партии (сторона из Session, SECURITY §7); иначе `not_a_participant`.

| `type` | Поля | Правило (источник) |
|---|---|---|
| `game.move` | `ply: int`, `uci: string` (`e2e4`, `e7e8q`) | очередь, `ply`, допустимость — сервер (ТЗ §4.6) |
| `game.draw_offer` / `game.draw_accept` / `game.draw_decline` | `ply: int` | ответ — только другая сторона, пока позиция та же (S29) |
| `game.takeback_offer` / `game.takeback_accept` / `game.takeback_decline` | `ply: int` | только `rated = false` (ТЗ §4.6), S29 |
| `game.resign` | — | партия `active` (P29) |
| `game.abort` | — | до 2-го хода каждой стороны (ТЗ §4.6) |
| `game.abandonment_choice` | `choice: "win" | "draw" | "abort"` | только сопернику ушедшего, в окне 30 с (G16, G21) |

- Ход — в UCI; SAN считает и присылает сервер (ARCHITECTURE §10).
- MUST NOT: поля времени, цвета, результата в командах.

### 9.2. Номер полухода `ply`

- `ply` в команде — длина `moves` в позиции, которую видит клиент. Не равна текущей → `ply_mismatch` + `game.state` (SECURITY S10, §8).
- `ply` в `game.moved` — номер этого хода с 1 (= длина `moves` после него).
- Пример (блиц 3+2): сделано 11 полуходов, очередь чёрных. Чёрные шлют `{"type": "game.move", "ref": "m42", "game_id": "9a1c…", "ply": 11, "uci": "g8f6"}` → всем `game.moved` с `ply: 12`, `san: "Nf6"`. Повтор того же сообщения (`ply: 11`) → `ply_mismatch`, второго хода нет (проверка `ply` раньше очереди, 5.2).
- Пример «ход вне очереди»: позиция после 11 полуходов, белые шлют `{"type": "game.move", "ref": "m43", "game_id": "9a1c…", "ply": 11, "uci": "g1f3"}` → `ply` верный, очередь чёрных → `error not_your_turn` + `game.state`; клиент возвращает фигуру.
- Принятие ничьей — с `ply` позиции, где её предложили; после хода → `ply_mismatch` (S29).
- Ограничение (sec-5): после возврата хода длина `moves` уменьшается, и старый `ply` снова действителен — устаревшее сообщение того же клиента может пройти. Риск принят: возврат бывает только в товарищеской, повторяет только сам клиент, а клиент не повторяет команды (раздел 10).

### 9.3. События партии

Все события ниже несут `game_id`. Типы — раздел 4.3.

| `type` | Поля | Когда |
|---|---|---|
| `game.state` | `game_id`, `game: Game`, `clock: Clock`, `your_color: "white" | "black" | null` (`null` у зрителя), `draw_offer: Offer`, `takeback_offer: Offer`, `connected: Connected`, `first_move_ms: int | null`, `reconnect: Reconnect`, `abandonment_choice: AbandonmentChoice` | на подписку, после возврата хода, после отказов «со снимком» (5.2) |
| `game.moved` | `game_id`, `ply: int`, `san: string`, `clock: Clock`, `draw_offer: Offer`, `takeback_offer: Offer` | после каждого хода |
| `game.offer` | `game_id`, `ply: int`, `draw_offer: Offer`, `takeback_offer: Offer` | предложение открыто, отклонено или снято |
| `game.presence` | `game_id`, `connected: Connected`, `reconnect: Reconnect`, `abandonment_choice: AbandonmentChoice`, `clock: Clock` | разрыв, возврат, старт окна выбора (ТЗ §4.6, G21) |
| `game.ended` | `game_id`, `status`, `result | null`, `termination`, `ratings` (как в `Game`) | конец партии (ARCHITECTURE §9.1 п.7) |
| `game.started` (личное) | `game_id`, `your_color: "white" | "black"` | партия из вызова или подбора |

- `first_move_ms` — сколько осталось до отмены без первого хода (30 с, `no_first_move`), иначе `null`.
- `abandonment_choice` видят все; выбрать может только соперник ушедшего.
- Пример `game.ended`: белые не вернулись, чёрные молчали 30 с → `{"type": "game.ended", "game_id": "9a1c…", "status": "finished", "result": "black_wins", "termination": "abandonment", "ratings": {"white": {"rating_before": 1642, "rating_after": 1633}, "black": {"rating_before": 1580, "rating_after": 1592}}}`.

### 9.4. Часы и RTT

- Клиент показывает `clock.<running>_ms − (сейчас − момент получения)` по `performance.now()`; другую сторону — как пришло. На каждом событии значения заменяются серверными.
- Ноль у клиента ничего не решает: флаг фиксирует сервер (`game.ended` с `timeout` или `timeout_insufficient_material`).
- RTT (ARCHITECTURE A11): сервер раз в 5 с шлёт `{"type": "ping", "n": int}`, клиент сразу отвечает `{"type": "pong", "n": int}`; RTT — по монотонным часам сервера; медиана 5 последних; компенсация `min(RTT/2, 1 с)`. `pong` с чужим `n` игнорируется.
- MUST: клиент отвечает на `ping` прямо в обработчике сообщения.
- Мёртвое соединение: сервер закрывает после 3 `ping` без `pong` (15 с); клиент — если 15 с нет ни одного сообщения. Дальше — раздел 10 и таймер переподключения 60 с (ТЗ §4.6).

## 10. Переподключение и закрытие

| Код | Причина | Клиент |
|---|---|---|
| 1000 | обычное закрытие | — |
| 1008 | лимит сообщений: корзина пуста > 10 с (SECURITY §9) | переподключиться через 5 с |
| 1011 | внутренняя ошибка; буфер отправки > 1 МБ (медленный клиент) | переподключиться |
| 1012 | перезапуск `app` (выкатка) | переподключиться |
| 4001 | Session закрыта (SECURITY S6); перед этим `{"type": "session.closed"}` | перезапросить `/api/me`, работать как гость |
| 4002 | `client_outdated` | перезагрузить страницу один раз |
| 4003 | `too_many_connections` (P28) | не переподключаться; показать `error.too_many_connections` и кнопку «Подключиться снова» |

- Паузы (P22): 0,5 → 1 → 2 → 4 → 5 с, дальше каждые 5 с, к каждой + случайные 0–30%; после успеха — сброс. До 60 с укладывается в таймер переподключения (ТЗ §4.6).
- После подключения клиент повторяет подписки; `lobby.state` и `game.state` восстанавливают экран (ТЗ §7; ARCHITECTURE §9.1 п.5, §9.3).
- MUST NOT: автоматически повторять неподтверждённые команды. Ход перед обрывом сверяется по `game.state`: есть в `moves` — сделан, нет — фигура возвращается.
- Seek: снимается, когда у игрока не осталось соединений (P9); после переподключения клиент сам шлёт `seek.start`.
- Пример: выкатка во время пули 2+1 → 1012, через 0,5–2 с клиент подключён, `game.state`: у стороны, чей ход, время на начало хода восстановлено (ARCHITECTURE A10), идёт таймер переподключения соперника.

## 11. Межмодульное взаимодействие

Правила — ARCHITECTURE §7.1–§7.3. Здесь — форма.

- Вызов `service` — асинхронная функция с типизированным объектом аргументов; первым параметром `trx`, если сценарий в транзакции (§7.2). HTTP и WebSocket между модулями нет.
- Ошибка — `throw new AppError("<code>")` из `platform`, код из `ErrorCode`. Статусы ставит `api.ts` / `realtime`.
- События — `snake_case`, прошедшее время; нагрузка — только `id`, значения перечислений, числа. MUST NOT: ПДн (SECURITY §12). Типы — в `events.ts` издателя, не в `packages/protocol`.
- Проекции протокола (`Game`, `Challenge`, `PlayerRef`) собирает `service` модуля-владельца и возвращает уже в форме `packages/protocol`. `realtime` их не собирает и рейтинги сам не читает.

| Издатель | Событие | Нагрузка | `realtime` |
|---|---|---|---|
| `games` | `game_started` | `game_id`, `white_id`, `black_id` | `game.started` обоим |
| `games` | `move_made` | `game_id`, `ply` | `game.moved` подписчикам |
| `games` | `offer_changed`, `presence_changed`, `state_reset` | `game_id` | `game.offer` / `game.presence` / `game.state` |
| `games` | `game_ended` | `game_id`, `white_id`, `black_id` | `game.ended`; `matchmaking` снимает Seek |
| `challenges` | `challenge_created`, `challenge_closed` | `challenge_id`, `type`, `status`, `creator_id`, `game_id` | `lobby.*` (только `open`), `challenge.closed` создателю |
| `matchmaking` | `seek_changed`, `seek_timed_out` | `user_id` | `seek.state` / `seek.suggest_challenge` |
| `auth` | `sessions_closed` | `session_ids` | `session.closed`, закрытие 4001 (SECURITY S6, F3-Q3) |

Функции чтения для `realtime` (по таблице зависимостей ARCHITECTURE §7.1):
- `games.service.getState({game_id, viewer_user_id: string | null}): GameStateMessage` без `type`; `games.service.getMoved({game_id, ply})`, `getOffer`, `getPresence`, `getEnded` — так же по событию.
- `challenges.service.listOpenForLobby(): Challenge[]`; `challenges.service.getChallenge({challenge_id}): Challenge` (рейтинг создателя `challenges` берёт у `rating.service`).
- `matchmaking.service.getSeek({user_id})`.
- Пример: `challenges.service.accept` (транзакция, `games.service.createGame`, ARCHITECTURE §9.1 п.2) → `game_started` → `game.started` обоим; `challenge_closed (accepted)` → `lobby.challenge_removed` и `challenge.closed`. Ответ REST принявшему — `201 {"game_id"}`.

## 12. Каталог REST

Роли — ТЗ §3, права — SECURITY §7. «Кто»: Г — гость, П1 — Session без первого входа (SECURITY S5), И — Игрок, «все» = Г + П1 + И (P26). Столбец «Кто» — точный список (раздел 1). «Операция» — имя для схем и `REST_ROUTES` (раздел 15). «Ошибки» — особые коды; общие — 5.1.

### 12.1. Вход и аккаунт (ТЗ §4.1)

| Операция | Метод и путь | Кто | Вход | Ответ | Ошибки |
|---|---|---|---|---|---|
| — | `GET /auth/google/start` | все | `?return_to=` (через `safeLocalPath`, S30) | 302 на Google | — |
| — | `GET /auth/google/callback` | все | от Google | 302 на `return_to`, `/welcome` или `/account/delete` (SECURITY §4.1) | страница «Не удалось войти» |
| `getMe` | `GET /api/me` | все | — | `{"user": Me | null}` (P10) | — |
| `completeOnboarding` | `POST /api/me/onboarding` | П1 | `{"nickname": string, "terms_accepted": true}` | `{"user": Me}` | `nickname_invalid`, `nickname_reserved`, `nickname_taken`; И → `onboarding_completed` |
| `updateMe` | `PATCH /api/me` | И | `{"country"?: string | null, "locale"?: "ru" | "en", "settings"?: частичный UserSettings}` | `{"user": Me}` | — |
| `changeNickname` | `POST /api/me/nickname` | И | `{"nickname": string}` | `{"user": Me}` | `nickname_*`, `nickname_change_used` |
| `logout` | `POST /api/auth/logout` | П1, И | — | 204, cookie стёрта | — |
| `logoutAll` | `POST /api/auth/logout-all` | П1, И | — | 204, все Session закрыты (ТЗ §4.1 п.5) | — |
| `startAccountDeletion` | `POST /api/account/delete/start` | П1, И | — | `{"redirect_url": string}` (SECURITY §4.1 шаг 1) | — |
| `deleteAccount` | `POST /api/account/delete` | П1, И | — (нужна `__Host-del`) | 204 | `account_has_active_game`, `delete_confirmation_invalid` |

- Пример: первый вход → `getMe` даёт `onboarding_required: true`, `nickname: null` → `/welcome` → `completeOnboarding` → `onboarding_required: false`.
- `logoutAll` для П1 — уточнение SECURITY §5 (17.2 п.12).

### 12.2. Профиль (ТЗ §4.2, §4.7)

| Операция | Метод и путь | Кто | Вход | Ответ | Ошибки |
|---|---|---|---|---|---|
| `getProfile` | `GET /api/profiles/:nickname` | все | — | `{"user": PublicUser, "ratings": RatingEntry[] (ровно 3: bullet, blitz, rapid), "stats": {"games_count": int, "wins": int, "draws": int, "losses": int}, "recent_games": GameSummary[] (≤ 10)}` | `not_found` |
| `getRatingHistory` | `GET /api/profiles/:nickname/rating-history` | все | `?category=` (обязателен) | `{"category", "points": [{"game_id", "rating_after": int, "created_at"}]}` | `not_found` |

- Ник ищется без учёта регистра (S14); `:nickname` — `encodeURIComponent`. У удалённого игрока ника нет → `not_found`, страница — 404 с `noindex`, ссылок на его профиль нет (человек, утверждение F4, 2026-11-04, F4-Q3).
- Процент побед считает клиент из `stats`.

### 12.3. Вызовы (ТЗ §4.3, §4.5)

| Операция | Метод и путь | Кто | Вход | Ответ | Ошибки |
|---|---|---|---|---|---|
| `createChallenge` | `POST /api/challenges` | И | `{"time_base": int (30–3600), "time_increment": int (0–30), "rated": boolean, "color": "white" | "black" | "random", "type": "open" | "link", "rating_range": int (50–300, только `open`) | null}` (P14, P25) | `201 Challenge` | `invalid_time_control`, `open_challenge_exists`, `player_busy` |
| `getChallenge` | `GET /api/challenges/:id` | все | — | `Challenge` в любом статусе (S9) | `not_found` |
| `acceptChallenge` | `POST /api/challenges/:id/accept` | И | — | `201 {"game_id"}` | `challenge_expired`, `challenge_cancelled`, `challenge_taken`, `own_challenge`, `player_busy`, `opponent_busy`, `rating_out_of_range`, `not_found` |
| `cancelChallenge` | `POST /api/challenges/:id/cancel` | И (создатель) | — | `Challenge` с `cancelled` | `forbidden`, `challenge_expired`, `challenge_taken` |

- Категорию считает сервер (GLOSSARY §6). Пресеты — `TIME_CONTROL_PRESETS` в `common.ts`, маршрута нет. Ссылку `/challenge/<id>` строит клиент (раздел 14).
- Лобби — только WebSocket (P9).
- Пример «2 клика» (ТЗ §7): друг открывает `/challenge/3f9c…` → `getChallenge` → «Принять» → `acceptChallenge` → `game.started` обоим → `/game/<game_id>`. Гость видит «Войти» → `/auth/google/start?return_to=/challenge/3f9c…`.

### 12.4. Партии и история (ТЗ §4.6, §4.9)

| Операция | Метод и путь | Кто | Вход | Ответ | Ошибки |
|---|---|---|---|---|---|
| `getGame` | `GET /api/games/:id` | все | — | `Game` (идущая — ходы на сейчас; живое — WebSocket) | `not_found` |
| `getGamePgn` | `GET /api/games/:id/pgn` | все | — | `text/plain; charset=utf-8`, `Content-Disposition: attachment; filename="<id>.pgn"`; теги `White`/`Black` — текущие ники или `Deleted player` (S13); только `finished`, `aborted` | `not_found`, `game_not_active` |
| `listProfileGames` | `GET /api/profiles/:nickname/games` | все | `category`, `outcome` (`win` / `loss`; без параметра — все, включая ничьи и `aborted`), `opponent` (ник), `started_from`, `started_to` (ISO 8601 с временем; `from` включительно, `to` исключительно), `limit`, `cursor` | `{"items": GameSummary[], "next_cursor"}` (раздел 6, P15) | `not_found` |
| `trackEvent` | `POST /api/analytics/events` | все | `{"name": "analysis_opened", "game_id": string}` | 204 | `not_found`, `game_not_active` |

- Фильтр по дате (tz-7): клиент переводит выбранный местный день в границы `started_from`/`started_to` по часовому поясу браузера.
- `trackEvent` (P13): партия должна быть `finished` или `aborted`; повтор в те же сутки (UTC) от того же User (гость — IP) по той же партии — 204 без записи. Отметки — в памяти, как `user_active` (ARCHITECTURE §7.5); IP не сохраняется.
- FEN, нотация, время на ход (P23) и разбор считает клиент из `Game.moves` (G26, ТЗ §4.9). Серверного разбора нет.

### 12.5. Таблица лидеров (ТЗ §4.8)

| Операция | Метод и путь | Кто | Ответ | Ошибки |
|---|---|---|---|---|
| `getLeaderboard` | `GET /api/leaderboard/:category` | все | `{"category", "updated_at", "entries": [{"rank": int, "user": PlayerRef, "rating": int, "games_count": int, "rating_change_7d": int}], "me": {"rank": int | null, "rating": int, "provisional": boolean, "rating_change_7d": int} | null}` | `validation_failed` (категория) |

- `entries` ≤ 100, кэш 5 мин; `updated_at` — время построения кэша (ARCHITECTURE A13). `me` — вне кэша; `null` у гостя и П1; `rank = null`, если игрок не проходит условия ТЗ §4.8.

### 12.6. Обратная связь и служебное (ТЗ §4.12)

| Операция | Метод и путь | Кто | Вход | Ответ | Ошибки |
|---|---|---|---|---|---|
| `sendFeedback` | `POST /api/feedback` | все | `multipart/form-data`: `text` (1–4 000 символов), `url` (путь страницы → `meta.url`), `game_id` (необязательно → `meta.game_id`), `screenshot` (файл, необязательно) | `201 {"id"}` | `payload_too_large`, `screenshot_unsupported` |
| `getHealth` | `GET /api/health` | все | — | `200 {"status": "ok"}`; БД недоступна — `503 {"status": "unavailable"}` | — (не формат раздела 5, P5) |

Лимиты `sendFeedback` (sec-4), `@fastify/multipart`: `limits: {files: 1, fields: 3, parts: 4, fieldSize: 8 КБ, fileSize: 5 МБ, headerPairs: 50}`.
- Поле не из списка выше, второй файл или превышение — отказ (`validation_failed` / `payload_too_large`); обработка прекращается сразу.
- Файл читается в память (≤ 5 МБ), сигнатура проверяется (SECURITY §11), и только потом файл пишется на том. Отказ — на том ничего не пишется.
- `safeLocalPath` применяется к полю формы `url` до записи в `meta.url`. `meta.browser` — из `User-Agent` (P12). Скриншот наружу не отдаётся (S18).

## 13. Каталог WebSocket

Клиент → сервер (`ref` необязателен у всех):

| `type` | Поля | Кто |
|---|---|---|
| `pong` | `n: int` | все |
| `lobby.subscribe`, `lobby.unsubscribe` | — | все |
| `game.subscribe`, `game.unsubscribe` | `game_id` | все |
| `seek.start` | `time_base: int`, `time_increment: int` — только пресет `TIME_CONTROL_PRESETS` (P24), иначе `invalid_time_control` | И |
| `seek.cancel` | — | И |
| `game.move`, `game.draw_*`, `game.takeback_*`, `game.resign`, `game.abort`, `game.abandonment_choice` | 9.1 | участник партии |

Сервер → клиент:

| `type` | Поля | Кому |
|---|---|---|
| `welcome` | `protocol_version: int`, `user: {"id", "nickname"} | null`, `ping_interval_ms: int` | соединению |
| `ping` | `n: int` | соединению |
| `error` | `ref | null`, `code`, `game_id | null`, `details | null` | соединению |
| `lobby.state` | `challenges: Challenge[]` (`status = open`, `type = open`) | подписчикам лобби |
| `lobby.challenge_added` / `lobby.challenge_removed` | `challenge: Challenge` / `challenge_id` | подписчикам лобби |
| `challenge.closed` | `challenge_id`, `status: "accepted" | "cancelled" | "expired"`, `game_id | null` | создателю |
| `seek.state` | `seek: {"time_base": int, "time_increment": int, "waited_ms": int} | null` | игроку |
| `seek.suggest_challenge` | `time_base: int`, `time_increment: int` | игроку через 60 с без соперника (ТЗ §4.4 п.3) |
| `game.*` | 9.3 | 9.3 |
| `session.closed` | — | соединениям закрытой Session, перед 4001 |

- Подбор всегда рейтинговый (ТЗ §4.4 п.1), поля `rated` нет. Новый `seek.start` заменяет прежний Seek. Своя `active` Game — `player_busy`.
- `seek.suggest_challenge` Seek не снимает; клиент предлагает «Создать открытый вызов» с тем же контролем.
- Пример: `seek.start {"time_base": 180, "time_increment": 2}` → `seek.state` (`waited_ms: 0`) → через 7 с `game.started {"game_id", "your_color": "black"}` и `seek.state {"seek": null}` → клиент шлёт `game.subscribe`.

## 14. Маршруты SPA и публичные страницы

| Маршрут | Страница | Серверная разметка `seo` (ARCHITECTURE §12.1) |
|---|---|---|
| `/` | главная: лобби, «Найти игру», «Создать игру» | нет |
| `/welcome` | первый вход (ТЗ §4.1 п.3–4) | нет, `noindex` |
| `/player/:nickname` | профиль | да |
| `/player/:nickname/games` | история с фильтрами | нет |
| `/leaderboard/:category` | лидеры; `/leaderboard` → 302 на `/leaderboard/blitz` | да |
| `/game/:id` | идущая партия или просмотр завершённой | да, только `finished`, `aborted`; идущая — `noindex` |
| `/game/:id/analysis` | разбор Stockfish (ARCHITECTURE A6), доступен всем (P26) | нет |
| `/challenge/:id` | вызов | нет, `noindex` |
| `/settings` | настройки, смена ника, выход, удаление | нет, `noindex` |
| `/account/delete` | подтверждение удаления (SECURITY §4.1 шаг 3) | нет, `noindex` |
| `/terms`, `/privacy` | правила и политика (SECURITY F3-Q1) | да |
| `/sitemap.xml`, `/robots.txt` | — | ARCHITECTURE §12.1 |

- `canonical` профиля — с текущим ником в сохранённом регистре.
- MUST: адреса страниц строятся только функциями `PAGES` из `packages/protocol/src/pages.ts` (раздел 15) — одни для SPA, `seo`, `sitemap.xml`, `return_to`.

## 15. Как добавить маршрут или сообщение

Раскладка `packages/protocol/src/`:

| Файл | Что |
|---|---|
| `version.ts` | `PROTOCOL_VERSION` |
| `common.ts` | объекты раздела 4, `TIME_CONTROL_PRESETS`, `BOARD_THEMES`, `PIECE_SETS`, перечисления глоссария |
| `errors.ts` | `ErrorCode` — `z.enum` всех кодов 5.2 |
| `rest/<область>.ts` | схемы операций: `me`, `profiles`, `challenges`, `games`, `leaderboard`, `feedback`, `analytics`, `health` |
| `rest/routes.ts` | `REST_ROUTES`: операция → `{method, path, who, params?, query?, body?, response, status, errors}` |
| `ws/client.ts`, `ws/server.ts` | `ClientMessage`, `ServerMessage` — `discriminatedUnion` сообщений раздела 13 |
| `pages.ts` | `PAGES` — функции адресов раздела 14 (`PAGES.game(id)` → `/game/<id>`) |
| `snapshot/protocol.json` | JSON Schema всех схем (`z.toJSONSchema`), раздел 16 |

Имена: схема и тип называются одинаково (`export const Game = z.object(…)`; `export type Game = z.infer<typeof Game>`). REST — `<Операция в PascalCase><Часть>`: `CreateChallengeBody`, `CreateChallengeResponse`, `ListProfileGamesQuery`, `GetProfileParams`. WebSocket — `type` в PascalCase + `Message`: `game.move` → `GameMoveMessage`, `game.moved` → `GameMovedMessage`. `Game` в протоколе — проекция API; строка БД — `GamesTable` (тип Kysely); доменный объект — по ARCHITECTURE F2-Q12.

Добавить REST-маршрут (в одной задаче):
1. Строка в каталог раздела 12 этого документа (операция, путь, кто, вход, ответ, ошибки).
2. Схемы в `rest/<область>.ts`; общие объекты — только из `common.ts`.
3. Запись в `REST_ROUTES`; новый код — в `errors.ts` и 5.2.
4. Обработчик — в `apps/server/src/<модуль>/api.ts` через `registerRoute(app, REST_ROUTES.<операция>, handler)` из `platform`: он проверяет «Кто», `Origin`, схемы, переводит `AppError` в статус. Клиент — `api.call("<операция>", …)` из `apps/web/src/shared/api`.
5. Тесты: обработчик (права из «Кто», особые ошибки); проверки раздела 16 зелёные; `snapshot/protocol.json` обновлён, при несовместимом изменении — `PROTOCOL_VERSION` + 1 (раздел 7).

Добавить сообщение WebSocket: строка в раздел 13 (и 9.1/9.3 для партии) → схема в `ws/client.ts` или `ws/server.ts` → обработчик команды в `api.ts` модуля в объекте `wsHandlers` (регистрирует `realtime`) → шаг 5.

## 16. Проверки

Подключение к CI — F6, F7. Все проверки — в той же задаче, что и изменение.

| Правило | Проверка |
|---|---|
| Маршруты Fastify = `REST_ROUTES`; нет `DELETE`, нет `/api/v1` | contract-тест `apps/server`: список маршрутов из хука `onRoute` равен записям `REST_ROUTES` (кроме `/auth/*`, страниц, статики) |
| Каталог 12, коды 5.2, типы 13 = код | `scripts/check-api-doc.sh`: выписывает из разделов 5.2, 12, 13 этого файла коды, операции и `type` и сравнивает с `npm run -w packages/protocol dump` (`ErrorCode`, `REST_ROUTES`, `ClientMessage`, `ServerMessage`) |
| Входящие схемы строгие; ключи `snake_case`; нет `user_id`, `creator_id`, `white_id`, `black_id` во входящих | тест `packages/protocol`: обход всех входящих схем — объект с лишним полем отклоняется, ключи по `^[a-z][a-z0-9_]*$`, запрещённых ключей нет |
| Нет `fen`, `pgn` в `Game` | тот же тест по `Game` |
| Смена протокола заметна | тест сравнивает `z.toJSONSchema` с `snapshot/protocol.json`; изменение снимка — в diff PR, ревью сверяет с разделом 7 |
| Нет CORS | тест: ответ на запрос с `Origin: https://evil.example` без `Access-Control-Allow-Origin`; `@fastify/cors` нет в зависимостях |
| Адреса страниц — из `PAGES` | тест `pages.ts` на каждую строку раздела 14; в `apps/web` и `seo` нет строковых литералов `"/game/`, `"/player/`, `"/challenge/` вне `pages.ts` (`scripts/check-architecture.sh`) |
| ПДн не в событиях | ревью PR по 11; поля нагрузки событий — только `*_id`, перечисления, числа |

## 17. Открытые вопросы

### 17.1. Вопросы

| № | Вопрос | Владелец |
|---|---|---|
| F4-Q4 | Значения `board_theme`, `piece_set` (`BOARD_THEMES`, `PIECE_SETS`); до F5 — только `default` | F5 |
| F4-Q5 | Ревью r2, agentability-10: инструменты §15–§16 (`registerRoute`, `api.call`, `wsHandlers`, `scripts/check-api-doc.sh`, `npm run -w packages/protocol dump`, тест `onRoute`, `snapshot/protocol.json`) пока не существуют. Создать их задачей скелета и указать сигнатуры; до этого шаги 4–5 §15 выполняются вручную по описанию | разработчик (первая фича области: скелет репозитория, вместе с ARCHITECTURE F2-Q12) |
| F4-Q6 | Ревью r2, consistency-10: `registerRoute` в `platform` проверяет «Кто», а Session знает только `auth` (ARCHITECTURE §7.1, F2-Q9). `realtime`, регистрируя `wsHandlers` из чужих `api.ts`, нарушает правило импортов (F2-Q10). Решить подключение: например, резолвер Session передаётся параметром из `main.ts`, обработчики регистрируются через `realtime.registerHandlers(…)` из `main.ts`. Итог — правка ARCHITECTURE при reopen | разработчик (первая фича области: скелет репозитория / `auth`, вместе с F2-Q9, F2-Q10, F2-Q12) |
| F4-Q7 | Ревью r2, consistency-11: повторная отмена вызова в `cancelChallenge` — ошибка `challenge_cancelled` или идемпотентный `200 Challenge`. Решение записать в 12.3 | разработчик (первая фича области `challenges`) |

Закрыты решением человека (Ivan, утверждение F4, 2026-11-04): F4-Q1 → P14, P25 (`time_base` ≥ 30 с, `rating_range` 50–300); F4-Q2 → P15, 12.4 (отменённые показываются; фильтр «все / победы / поражения»); F4-Q3 → 12.2 (404 с `noindex`, ссылок нет).

### 17.2. Правки утверждённых документов (для reopen)

Не правлены здесь; до reopen агенты следуют F4. Выполнять вместе с SECURITY F3-Q3 (reopen F1 + F2 одним заходом).

F1 `docs/GLOSSARY.md`:
1. §8 Move: `san`, `clock_ms`; номер полухода `ply` (SECURITY S10, 9.2).
2. §8: `draw_offer` / `takeback_offer` с полем `by` (S29); выбор после разрыва — `choice`: `win` / `draw` / `abort` (G21).
3. §5: поле User для «ник уже менялся» (например `nickname_changed_at`) — основа `can_change_nickname` (ТЗ §4.1 п.3).
4. §5 Статистика: `games_count`, `wins`, `draws`, `losses`; фильтр `outcome`: `win` / `loss`, без параметра — все (P15).
5. §9: `provisional`, `rank`, `rating_change_7d`.
6. Примечание: имена раздела 4 (`PublicUser`, `PlayerRef`, `Me`, `Clock`, `Offer`, `Reconnect`, `AbandonmentChoice`, `Connected`, `RatingChange`) и поля проекций и сообщений разделов 4, 9, 12, 13 (`white`/`black`/`creator` вместо `*_id`, `your_color`, `first_move_ms`, `waited_ms`, `entries`, `points`, `redirect_url`, `active_game_id`, `open_challenge_id`, `terms_accepted`, `ping_interval_ms`, `started_from`/`started_to`) — технические имена протокола, не термины домена.
7. §7: подбор — только пресеты (P24), уточнение G15.

F2 `docs/ARCHITECTURE.md`:
8. §7.3: имена событий — таблица раздела 11 (с `auth.sessions_closed` из F3-Q3 и `games.offer_changed`, `presence_changed`, `state_reset`); пример «`realtime` подписывает их на партию» → «шлёт `game.started`, клиент подписывается сам» (P18).
9. A11: ping/pong — прикладные сообщения (P21).
10. §9.1 п.3: «игрок занят» — два кода `player_busy` / `opponent_busy`; §9.1 п.5, §12, §12.1 — снимок 9.3, маршруты 14.
11. §9.2: «точность до 1 с; хватает ли — F4, F5» → P23 (точно до мс списанного времени). A22 / §14: метрика `app_info{version}`; `GET /api/health` без версии (P16).

F3 `docs/SECURITY.md` (уточнения):
12. §5: код «нужен первый вход» — `onboarding_required`; П1 читает публичное как гость (P26) и может `logout-all`.
13. §6: POST без тела допустим; CORS запрещён (раздел 3). §9: «слишком часто» — `rate_limited`; 6-е соединение — `too_many_connections` + 4003 (P28). §11: `screenshot_unsupported` (415), лимиты `multipart` — 12.6.
14. §13 «Профиль — заглушка» → профиль удалённого игрока — 404 с `noindex`, ссылок нет (человек, утверждение F4, F4-Q3).
15. §15 (и F7): путь страницы `/challenge/<id>` — секрет вызова по ссылке (S9), а в Sentry и логах путь пишется. Решить: заменять `id` в путях `/challenge/…` и `/api/challenges/…` на `:id` в Sentry и логах (ревью r1, security вне линзы).
