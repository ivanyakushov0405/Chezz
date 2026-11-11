# E04 e04-auth — ревью

## Эпик E04 — итерация 1
Вердикт: CHANGES_REQUESTED

Что смотрел: `git diff main...HEAD` (шаги 1–9), бриф К-1…К-10, E-1, E-2, MUST/MUST NOT SECURITY §4, §5, §9, §10, §15, §18, ARCHITECTURE §8 (SQL только в `repo` владельца), TESTING §1 (слепые тесты protocol не тронуты после коммита tester 556216c), DESIGN_SYSTEM §7. `git status` пуст.

### Блокеры
- [apps/server/src/auth/oidc.ts:31, :48–54; комментарий :2] Подпись ID-токена не проверяется. В openid-client 6.x `authorizationCodeGrant` проверяет только утверждения. Подпись JWS по JWKS проверяется, только если вызвать `client.enableNonRepudiationChecks(config)` (node_modules/openid-client/build/index.js:748, :692; в `oauth4webapi` `validateJwt` подпись не сверяет; в документации библиотеки: «not mandatory since TLS… only for non-repudiation»). В коде этого вызова нет (`grep enableNonRepudiationChecks` по apps/ ничего не находит), а комментарий в строке 2 утверждает обратное. SECURITY §4 п.4 требует (MUST, все пункты): «подпись по ключам Google (JWKS, кэш `openid-client`)». Сценарий: если подменить ответ token endpoint (TLS-прокси с доверенным корнем на машине сервера, ошибка в `customFetch` или будущая смена метаданных), `app` примет неподписанный ID-токен с любым `sub`, то есть вход под чужим аккаунтом. Тесты этого не ловят, потому что `AppDeps.oidc` подменяет весь `exchange`. Что сделать: в `createGoogleProvider` после `new client.Configuration(…)` вызвать `client.enableNonRepudiationChecks(config)` (`jwks_uri` в `GOOGLE_METADATA` уже есть). Исправить комментарий в строке 2. Добавить unit-тест: `createGoogleProvider` с `customFetch`, где token endpoint отдаёт ID-токен с неверной подписью, приводит к ошибке `exchange`. Такой тест не ходит в сеть (TESTING §7.3). Пункты чек-листа 2а и 4, SECURITY §4 п.4.

### Желательно
- [apps/server/scripts/seed.ts:27] `SEED_TOKEN_SECRET || LOCAL_SEED_SECRET` молча берёт публичный ключ при `APP_ENV=staging`. Сейчас staging защищён тем, что `SEED_TOKEN_SECRET` стоит как `required` в `deploy/env.allowlist`. Но если сид запустить руками на staging без переменной, любой войдёт сид-игроком (TESTING V20). Стоит падать с кодом 2, если `APP_ENV` не `dev`/`test` и секрет пуст.
- [apps/server/src/auth/oidc.ts:31] openid-client сам сверяет `iss` ID-токена строго с `GOOGLE_METADATA.issuer` (`https://accounts.google.com`). Поэтому второй допустимый вариант из SECURITY §4 (`accounts.google.com`) на практике отклонится внутри `exchange` ещё до `verifyIdTokenClaims`. Google в code flow отдаёт форму с `https://`, так что риск низкий. Стоит записать это в комментарий или в лог (`reason: "exchange"` скрывает причину).
- [apps/server/src/auth/oidc-api.ts:116] При успешном входе в браузере с уже действующим `__Host-sid` (другой User или тот же) старая строка `sessions` остаётся до истечения срока. Стоит удалять Session из входящей cookie, если она есть: меньше висящих Session, и после входа под другим аккаунтом нет «осиротевшей» Session.
- [apps/server/src/auth/oidc-api.ts:24–30] В `__Host-oidc` нет времени выдачи, поэтому 10 минут ограничивает только `Max-Age` браузера. Стоит добавить `issued_at` и проверять его по `TimeSource` (тот же шаблон, что `started_at` в §4.1).
- [apps/server/src/platform/http.ts:107] `resolveCaller` выполняется в `onRequest` на каждый запрос, включая статику и `index.html`. С cookie это 2 SQL-запроса на каждый JS/CSS/шрифт. SECURITY §5 требует проверку «на каждый REST-запрос и WebSocket». Стоит не ходить в БД для путей вне `/api`, `/auth`, `/ws` (гость для лимитов не нужен: статика вне лимита, SECURITY §9).
- [apps/web/src/features/auth/MeContext.tsx:41–49] `logout`/`logoutAll` при 401 `unauthenticated` (Session уже закрыта «выйти со всех устройств» с другого устройства) показывают Toast с ошибкой, а шапка остаётся в состоянии «вошёл» до перезагрузки. Стоит считать 401 успешным выходом: `setState({status:"guest"})` и Toast «Вы вышли».
- [apps/web/src/shared/ui/Menu/Menu.tsx:18] Проп `heading` не описан в новой строке `Menu` в DESIGN_SYSTEM §7 (правило DESIGN §1: сначала строка в §4–7). → architect-apply: дописать `heading?: ReactNode`.
- [tests/e2e/playwright.config.ts:13–14] `@https-cookie` исключён из webkit при любом http-адресе, то есть и в CI (там тоже `http://127.0.0.1`). Вход, выход и первый вход в WebKit не проверяются нигде, кроме staging `@smoke`. Firefox локально не запускался, а Secure-cookie по http у него ведут себя иначе, чем у Chromium. Первый прогон CI по firefox нужно посмотреть отдельно. В лог эпика стоит записать, что покрытие WebKit для К-9/К-10 отсутствует.
- `deploy/env.allowlist`, `tests/deploy/**`: diff показать Ivan до push (O36).

### Позже
- E19: `signInWithGoogle` обновляет `email`/`google_name`/`avatar_url` у User с `deleted_at` (до обезличивания) и только потом получает отказ `deleted` (oidc-api.ts:113–114). Когда появится удаление, ПДн удалённого не должны перезаписываться: проверять `deleted_at` до апсерта или в `WHERE` апсерта.
- E22: подписчик `sessions_closed` (закрытие WebSocket) и перепроверка раз в 60 с. Издатель готов (service.ts:63–74).

### Проверено, замечаний нет
- К-1, S30: `safeLocalPath` (packages/protocol/src/safe-path.ts). Все строки SECURITY §4 есть в unit-тесте, вызывается на сервере (start) и на клиенте (WelcomePage), `navigate` уходит со своего origin только через `assign`, но на вход ему приходит уже проверенный href. `return_to` при callback берётся только из подписанной cookie.
- К-2, E-2: `__Host-oidc` стирается до всех проверок. Сверяются state, error, code, iss, aud, exp, iat ±60, nonce, sub. В лог пишется только `reason` и `err.name`. Логгер и Sentry отрезают query (`pathOnly`). Есть тест «в логе нет code и state».
- Session: SHA-256 токена, уникальный индекс, `randomBytes(32)`, `__Host-sid` HttpOnly/Secure/Lax/Path=/, Max-Age 30 дней. Истёкшая Session считается гостем. Чистка при старте и раз в сутки. `logoutAll` удаляет все Session и публикует одно событие. POST-маршруты проверяют `Origin`.
- П1: на сервере через `who` и `refusals` (Игроку `onboarding_completed`, П1 на маршрутах Игрока получает 403 `onboarding_required`), в SPA через guard с `ONBOARDING_PATHS`.
- ПДн: `email` пишется только при `email_verified`, проекция аватара оставляет только `lh3` (сервер и `Avatar`), `PublicUser` без email, CSP `img-src` содержит lh3.
- E-1: уникальный индекс `lower(nickname)`, `23505` превращается в `nickname_taken`, тест гонки есть.
- SQL только в `repo` владельца. Миграции 0002 и 0003 добавляющие. RU и EN ключи совпадают, `error.<code>` есть для всех новых кодов.
- Слепые тесты protocol (`user.test.ts`, `safe-path.test.ts`, `auth-routes.test.ts`) менялись только коммитом tester 556216c.
- Новые зависимости (`openid-client` по SECURITY §4, `@fastify/cookie` в шаге 2 брифа) добавлены в задаче, где они нужны.
