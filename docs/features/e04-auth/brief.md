# E04: Вход через Google, Session, первый вход, выход

Slug: `e04-auth` · ROADMAP: E04 · Трекер: KAN-7 · Риск: high (вход, Session — SECURITY §4, §5; `deploy/env.allowlist`)

## Цель
Гость входит через Google, при первом входе выбирает ник и принимает правила, потом остаётся вошедшим 30 дней и может выйти с одного или со всех устройств. Это основа «Игрока» для всех следующих эпиков. ТЗ §4.1 п.1–5, §3; SECURITY §4, §5, S4, S5, S14, S19, S30; API §12.1; DESIGN §9 (`shell`, `welcome`, `login-failed`, `legal`, `not-found`), U21, U29.

## Входит / не входит
- Входит: таблицы `users`, `sessions`; `/auth/google/start`, `/auth/google/callback`; `getMe`, `completeOnboarding`, `updateMe`, `logout`, `logoutAll`; `resolveCaller` (П1/Игрок, ADR-0005 п.7); `user_registered`, `user_active`; суточная чистка Session (ADR-0007 п.4, `platform/schedule.ts`); событие `sessions_closed` (издатель, подписчика ещё нет); фабрика `createPlayer`, `seedSessionToken`, сид `--demo` (12 игроков с Session, без Rating и партий); SPA: роутер по `PAGES`, клиент REST, шапка (вход / `Avatar` с меню «Выйти», «Выйти со всех устройств»), подвал (`/terms`, `/privacy`, язык U21), `/welcome`, `login-failed`, `/terms` и `/privacy` с текстом-заглушкой, `not-found`; `GOOGLE_*`, `COOKIE_SECRET` → `required` в `env.allowlist`.
- Не входит: `changeNickname`, настройки — E16; удаление аккаунта (`startAccountDeletion`, `deleteAccount`, `/account/delete`) — E19; закрытие WebSocket по `sessions_closed` и перепроверка 60 с — E22; серверная разметка `seo` для `/terms`, `/privacy` — эпик модуля `seo`; навигация «Играть / Лидеры / Профиль» — эпики этих страниц; кнопка Feedback — E18; `ConnectionBanner` — E22; Rating новичка не создаётся (ROADMAP, «Rating по умолчанию»).

## Критерии готовности
- К-1: `GET /auth/google/start?return_to=…` → 302 на Google с `state`, `nonce`, PKCE S256, `scope=openid email profile`; подписанная `__Host-oidc` (`HttpOnly`, `Secure`, `SameSite=Lax`, 10 мин); `return_to` — через `safeLocalPath` (все строки SECURITY §4 — в unit-тесте).
- К-2: callback: `state` ≠ cookie, ошибка обмена или любой провал проверки ID-токена (`iss`, `aud`, `exp`, `iat` ±60 с, `nonce`) → `login-failed` без подробностей, причина — в лог без `code`/`state`/токенов; `__Host-oidc` стёрта в любом исходе.
- К-3: успешный callback: новый `sub` → User (`email` только при `email_verified`), `user_registered`, Session, cookie `__Host-sid` (S4, 30 дней), 302 на `/welcome`; известный `sub` → обновлены `email`, `google_name`, `avatar_url`, 302 на `return_to`.
- К-4: `getMe`: гость → `{"user": null}`; П1 → `onboarding_required: true`, `nickname: null`; Игрок → полный `Me` (`can_change_nickname: true`, `active_game_id`/`open_challenge_id` = `null`). Истёкшая Session = гость.
- К-5: `completeOnboarding`: ник 3–20 `[A-Za-z0-9_-]`, уникален без учёта регистра, не из списка S14, `terms_accepted: true` → `nickname`, `terms_accepted_at`; ошибки `nickname_invalid`, `nickname_reserved`, `nickname_taken`; Игроку — `onboarding_completed`. П1 на прочих защищённых маршрутах — 403 `onboarding_required`.
- К-6: `logout` удаляет текущую Session и cookie; `logoutAll` — все Session User; оба публикуют `sessions_closed` с их `id`; оба доступны П1.
- К-7: `updateMe` (`locale`, `country`, частичные `settings`, `.strict()`); после `completeOnboarding` клиент шлёт `locale` из `localStorage`, если он ≠ `Me.locale`, и чистит ключ (U29).
- К-8: `user_active` — не больше одного на User в сутки (UTC) при запросе с действующей Session; истёкшие Session удаляются при старте и раз в сутки (`time.advance`).
- К-9: SPA: гость видит «Войти через Google» (ведёт на `/auth/google/start?return_to=<текущий путь>`); П1 с любой страницы, кроме `/welcome`, `/terms`, `/privacy`, уводится на `/welcome`; на `/welcome` «Продолжить» неактивна без галочки, ошибки ника — у поля; после успеха — на `return_to` или `/`. Игрок видит `Avatar` с меню выхода. Строки RU/EN, вёрстка от 360 px, состояния по DESIGN §10.4.
- К-10: сид `--demo` создаёт `seed_player_01…12` с Session (токен — `seedSessionToken`); e2e входит cookie сида; e2e первого входа — П1 из фабрики.
- E-1: ник `Magnus` при существующем `magnus` → `nickname_taken`; гонка двух одинаковых ников — один успех, второй `nickname_taken` (уникальный индекс по `lower(nickname)`).
- E-2: повторный callback с тем же `state` (cookie уже стёрта) → `login-failed`.

## Шаги
1. `[contracts]` protocol: `PublicUser`, `Me`, `UserSettings`, `Nickname`, `COUNTRIES`; операции `getMe`, `completeOnboarding`, `updateMe`, `logout`, `logoutAll` из `PENDING_CATALOG` в `REST_ROUTES`; снимок. Слепые тесты — `tester` до кода. К-4, К-5, К-7.
2. `[backend:platform]` конфиг `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `COOKIE_SECRET` (обязательны вне `dev`), `@fastify/cookie`, `safeLocalPath`, `schedule.ts` (`every`); `.env.example`. К-1, К-8.
3. `[backend:users]` миграция `users`, `repo`, `service` (создание/обновление из Google, первый вход, проекции `PublicUser`/`Me`, `updateMe`); маршруты `completeOnboarding`, `updateMe`. К-3 (часть), К-5, К-7, E-1.
4. `[backend:auth]` миграция `sessions`, `repo`, `service`: Session, `resolveCaller`, `logout`, `logoutAll`, `sessions_closed`, чистка, `user_active`; `getMe`; фабрика `createPlayer`, `seedSessionToken`, сид `--demo`. К-4, К-6, К-8, К-10.
5. `[backend:auth]` OIDC: `openid-client`, `/auth/google/start`, `/auth/google/callback`, проверка утверждений ID-токена (unit), `user_registered`, отдача `login-failed`. К-1, К-2, К-3, E-2.
6. `[frontend]` основа: клиент REST поверх `REST_ROUTES`, роутер по `PAGES`, контекст `Me`, `Button`, `Avatar`, `Menu`, `Toast`, `SegmentedControl`, шапка (`guest`, `default`, П1) и подвал (язык U21), `not-found`; RU/EN. К-9.
7. `[frontend]` `/welcome` (`TextField` с `hint`, `Checkbox`, `<T>`, U29), `login-failed`, `legal` (`/terms`, `/privacy`); `screens.spec.ts` для новых экранов. К-7, К-9.
Макеты — `design-spec.md` (Figma, раздел «E04», 17 фреймов).
8. `[infra]` `deploy/env.allowlist`: `GOOGLE_*`, `COOKIE_SECRET` → `required` (OPERATIONS §6, строка 281). —
9. `[e2e]` `tests/e2e/auth.spec.ts`: вход cookie сида, меню выхода, первый вход П1 из фабрики → `/welcome` → лобби; `@smoke` не меняется. К-9, К-10.

## Решения
- `login-failed` — callback отвечает `index.html` со статусом 400 на своём же адресе, SPA показывает экран по пути `/auth/google/callback` и убирает query (`history.replaceState`). Отвергнуто: редирект на новую страницу `/login-failed` — её нет в API §14 и `PAGES`.
- `return_to` нового игрока: callback ведёт на `/welcome?return_to=<проверенный путь>`, SPA после первого входа идёт туда (проверка клиента — тот же разбор, что `safeLocalPath`, общей функцией из `packages/protocol`). Так работает «2 клика» по ссылке вызова (ТЗ §7). Отвергнуто: всегда на `/` — новичок по ссылке друга теряет вызов.
- Роутер — свой, ~60 строк поверх `history` и `PAGES`. Отвергнуто: `react-router` — лишняя зависимость ради 8 маршрутов.
- П1 для e2e первого входа — фабрика `createPlayer({ nickname: null })` из хелпера e2e (локально и в CI), не сид: сид детерминирован, а первый вход меняет запись, и проекты Playwright мешали бы друг другу.

- По `design-spec.md` (вопросы designer → решения): подсказка правил ника остаётся под полем и при ошибке (п.7); формат ника проверяется при отправке и при уходе с поля после первого изменения, ошибка сбрасывается при вводе (п.8); ссылки в подписи галочки — компонент `<T>` подставляет React-узлы в `{terms}`/`{privacy}` перевода (фраза не склеивается, HTML в переводе нет — §15 не меняется), открываются в новой вкладке (п.6); `Checkbox` — квадрат по первой строке подписи (п.5); П1 на любом маршруте, кроме `/welcome`, `/terms`, `/privacy`, уводится на `/welcome`, в шапке П1 — `Avatar`-заглушка с меню выхода (п.4); «Выйти» — остаёмся на странице гостем, «Выйти со всех устройств» — без подтверждения, обе показывают `Toast` «Вы вышли из аккаунта» (п.11); `/api/me` не ответил — гость + `Toast`, без авто-повтора (п.14); «Попробовать снова» на `login-failed` ведёт на `/auth/google/start` без `return_to` (п.10б), отказ в Google и ошибка сервера — один текст (п.10в, SECURITY §4); кнопка входа — только текст, без знака «G» (п.12); язык в подвале — `SegmentedControl` RU/EN (п.2); фреймы 10.2 `shell` — в E22 (п.13).

## Правки документов основ
DESIGN_SYSTEM (п.1, 5, 7, 9 `design-spec.md`; правило §1 «сначала строка в разделах 4–7»):
1. §4, строка «Размеры раскладки» — было: `… --layout-logo-mark 28px` (размер знака `Logo`, U31) |` → стало: `… --layout-logo-mark 28px` (размер знака `Logo`, U31), `--layout-control-icon 1.25rem` (квадрат `Checkbox`, иконка `IconButton`), `--layout-form-max 25rem` (ширина формы, `welcome`), `--layout-text-max 45rem` (колонка текста, `legal`) |`
2. §7, строка `TextField`, `Checkbox`, `Switch`, `Select` — было: `` `label`, `value`, `onChange`, `error?: string` (ключ перевода); `Select` — `options: {value, label}[]` | подпись — `<label>`; ошибка — текст под полем, `aria-describedby` `` → стало: `` `label`, `value`, `onChange`, `hint?: string`, `error?: string` (ключи перевода); `Select` — `options: {value, label}[]` | подпись — `<label>`; подсказка и ошибка — текст под полем (ошибка над подсказкой, подсказка не пропадает), оба в `aria-describedby` ``
3. §7, новая строка после `Avatar`: `` | `Menu` | `label` (в `aria-label` кнопки), `trigger: ReactNode`, `items: {id, label, onSelect, loading?}[]` | кнопка `aria-haspopup="menu"`, список `role="menu"`; ↑ ↓ Home End, Esc и клик вне закрывают, фокус возвращается на кнопку; фон `--color-surface`, рамка `--color-border`, `--radius-m`, `--shadow-m`, пункты — вид `Button ghost` | ``

## Вопросы к Ivan
1. Тексты правил и политики (ROADMAP «Открытые вопросы» п.3, F3-Q1; designer п.16, 17) — в E04 заглушка «Текст готовится» на RU/EN, без версии правил и без даты редакции. Так?
2. Шапка E04 — без навигации «Играть / Лидеры / Профиль» и без кнопки Feedback: их ставят эпики этих страниц и E18 (designer п.3). Так?
3. EN-строки — черновик designer (`design-spec.md`, «Тексты»); правки — по ходу, в PR.
4. Локальный вход через настоящий Google (S25) требует вашего dev-клиента OAuth (`GOOGLE_CLIENT_ID`/`SECRET` в `.env`). Для приёмки кода он не нужен (тесты — без Google, TESTING §7.3); настоящий вход — на staging после первой выкатки prod.
