# E04: лог

- 2026-11-10 23:43 — старт (/epic E04). Зависимости: E01–E03 смержены; первая выкатка prod ещё не сделана — по решению Ivan эпик ведём, закрытие (ручной вход на staging) после неё. Figma — Ivan авторизует, designer до брифа.
- 2026-11-10 23:54 — designer: design-spec.md, 17 фреймов Figma; бриф готов к ⛔.
- 2026-11-11 16:00 — шаг 1 protocol: tester 59 слепых тестов, схемы и 5 операций в REST_ROUTES; routes.int.test (AC-28) красный до шагов 3–4 (маршрутов ещё нет).
- 2026-11-11 16:00 — шаг 2 platform: GOOGLE_*, COOKIE_SECRET, @fastify/cookie, schedule.every.
- 2026-11-11 16:03 — шаг 3 users: миграция users (lower(nickname) unique), signInWithGoogle (upsert), completeOnboarding, updateMe, getMe; 10 int-тестов.
- 2026-11-11 16:10 — шаг 4 auth: sessions, resolveCaller (П1/Игрок), logout/logoutAll + sessions_closed, суточная чистка, user_active; createPlayer, rest(), seedSessionToken, сид --demo (12 игроков); routes.int снова зелёный; affected 811 зелёных.
- 2026-11-11 16:11 — шаг 4: коммит e222835 прошёл с красным check-architecture (SQL в *.int.test.ts под src/; ошибка скрыта pipe в tail) — исправлено отдельным коммитом, запросы в test/support/sessions.ts.
- 2026-11-11 16:18 — шаг 5 auth OIDC: openid-client (статические метаданные Google), /auth/google/start|callback, __Host-oidc (подписанная), verifyIdTokenClaims (unit), login-failed = index.html 400; подмена обмена — AppDeps.oidc (не конфиг); affected зелёные.
- 2026-11-11 16:30 — шаг 6 web: callApi, роутер, MeContext, AppLocale (U21/U29), Button/Avatar/Menu/Toast/SegmentedControl, shell, not-found, ключи RU/EN; jsdom-тесты К-9 (34 web); шаг больше 8 файлов — пометка в brief.md; tests/e2e/lobby.spec.ts пока ждёт шага 9.
