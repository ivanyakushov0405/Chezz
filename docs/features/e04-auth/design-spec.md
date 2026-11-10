# Design spec: E04 «Вход через Google, первый вход, выход»

Версия 0.1 · 2026-11-10 · designer. Процесс `/epic`, requirements.md нет. Вход — сценарии 1–5 из брифа оркестратора, ТЗ §3, §4.1 п.1–5, §5 «Персональные данные», ROADMAP (строка E04, «Открытые вопросы» п.3), DESIGN_SYSTEM §1, §7–§11, §14–§16, GLOSSARY §4, §5, §12, API §12 (маршруты `/auth/*`, `completeOnboarding`, `logout`, `logoutAll`), SECURITY §4–§5.

## Макеты
Файл: https://www.figma.com/design/z6VyHSdwqFzCQIdP7ScisI. Страница `02 Screens`: https://www.figma.com/design/z6VyHSdwqFzCQIdP7ScisI?node-id=1-3.

Секция «E04 · вход, первый вход, выход (ТЗ §4.1)» — https://www.figma.com/design/z6VyHSdwqFzCQIdP7ScisI?node-id=46-681.

Ссылка на фрейм: `https://www.figma.com/design/z6VyHSdwqFzCQIdP7ScisI?node-id=<id, «:» заменено на «-»>`. Над каждым фреймом есть подпись: пункт ТЗ и маршрут (DESIGN §16.2). Язык макетов — RU, тексты слоёв названы ключами перевода.

Концепт `welcome` из E01 (`7:549`, `7:573`, секция «Концепты — вне E01») устарел. Источник для E04 — фреймы этой секции.

Сборка: только экземпляры `01 Components` (`Logo`, `Badge`, `Button`, `TextField`, `Avatar`, `Toast` и новый `Checkbox`) и переменные `00 Tokens`. Исключение — меню аккаунта: его нарисовал набросок, потому что компонента меню в §7 нет («Открытые вопросы», п.1).

## Экраны

| Экран | Фрейм | node id |
|---|---|---|
| `shell` | `shell / 360 / light / default` | `46:703` |
| | `shell / 1280 / light / default` | `46:796` |
| | `shell / 360 / light / guest` | `46:683` |
| | `shell / 1280 / light / guest` | `46:775` |
| | `shell / 360 / light / session-closed` | `46:752` |
| | деталь: меню аккаунта открыто, 360 | `46:724` |
| | деталь: меню аккаунта открыто, 1280 | `46:819` |
| `welcome` | `welcome / 360 / light / default` (галочки нет) | `47:718` |
| | `welcome / 1280 / light / default` (галочка стоит) | `47:887` |
| | `welcome / 360 / light / field-error`, `error.nickname_invalid` | `47:750` |
| | `welcome / 360 / light / field-error`, `error.nickname_taken` | `47:784` |
| | `welcome / 360 / light / submitting` | `47:818` |
| | `welcome / 360 / dark / default` | `47:853` |
| `legal` | `legal / 360 / light / default` | `48:820` |
| | `legal / 1280 / light / default` | `48:865` |
| `login-failed` | `login-failed / 360 / light / default` | `48:842` |
| | `login-failed / 1280 / light / default` | `48:796` |

Матрица §10.4 закрыта так:
- `shell`: `default`, `guest` — по фрейму; `error*` — без фрейма. Из 10.2 нарисован только `session-closed`: он прямо следует из «Выйти со всех устройств». `reconnecting`, `offline`, `outdated` и `too-many-tabs` — это WebSocket, их фреймы делает E22 («Открытые вопросы», п.13).
- `welcome`: `default` и `field-error` — по фрейму. `submitting*` нарисован, потому что этого состояния просит сценарий 2. `error*` — без фрейма.
- `legal`, `login-failed`: `default`.

Фрейм `768` не нужен: это не `game-live`, а размеров вне §16.2 сценарии не требуют.

### `shell` — шапка и подвал (сценарии 1, 3)
- Макеты:
  - игрок: 360 https://www.figma.com/design/z6VyHSdwqFzCQIdP7ScisI?node-id=46-703, 1280 https://www.figma.com/design/z6VyHSdwqFzCQIdP7ScisI?node-id=46-796;
  - гость: 360 https://www.figma.com/design/z6VyHSdwqFzCQIdP7ScisI?node-id=46-683, 1280 https://www.figma.com/design/z6VyHSdwqFzCQIdP7ScisI?node-id=46-775.
- Темы проверены: light. Шапка и подвал используют только `color/surface`, `color/border`, `color/text`, `color/accent` — те же пары, что в `lobby` E01 (light и dark). Тёмная `welcome` (`47:853`) показывает шапку и подвал в `dark`.
- Компоненты:
  - шапка: высота `--layout-header-height`, фон `--color-surface`, нижняя граница `--border-width` `--color-border`. Внутренний контейнер на `l` — `--layout-container-max` по центру; на `s`/`m` поля `--space-4`; зазор `--space-2`;
  - слева `Logo` (`withName=false` на `s`, `true` на `m`/`l`, §8) и `Badge` «Бета»; справа:
    - гость — `Button variant=primary size=m` «Войти через Google»;
    - игрок — кнопка аккаунта: `Avatar size=s`, на `m`/`l` рядом ник `text/m`; область касания ≥ `--layout-touch-target`, радиус `--radius-m`;
  - меню аккаунта (набросок, п.1): `--color-surface`, граница `--border-width` `--color-border`, `--radius-m`, тень `--shadow-m`, поля `--space-2`, зазор `--space-1`. В шапке меню — ник `text/m-strong`. Пункты — `Button variant=ghost size=m` на всю ширину, текст по левому краю: «Выйти», «Выйти со всех устройств». Меню выровнено по правому краю контейнера, отступ от шапки `--space-1`;
  - подвал: ссылки «Правила» (`/terms`) и «Конфиденциальность» (`/privacy`) — `text/s`, `--color-accent`, подчёркнуты; переключатель языка RU / EN — набросок (п.2). Ряд по центру, зазор `--space-4`, поля `--space-4`, перенос на узких.
- Чего нет в шапке E04: навигации «Играть · Лидеры · Профиль» и кнопки «Сообщить об ошибке / идея» (§9.1). Их маршрутов ещё нет, и их ставят эпики своих экранов (E09/E11/E14, E18) — п.3. Контент страницы в макетах — заглушка `lobby.coming_soon` из E01.
- Новые компоненты: нет. Меню — набросок, ждёт строки в §7 (п.1).
- Состояния:
  - `default` (игрок, `Me` получен, `onboarding_required: false`) — `46:703`, `46:796`;
  - `guest` (нет Session) — `46:683`, `46:775`;
  - `session-closed` — https://www.figma.com/design/z6VyHSdwqFzCQIdP7ScisI?node-id=46-752: шапка гостя и `Toast tone=info` «Вы вышли из аккаунта» внизу по центру, 5 с (§7, §10.2);
  - `error*` (`/api/me` не ответил): шапка гостя и `Toast tone=danger` `error.network` / `error.<code>` (§10.4, §11), фрейма нет.
- Поведение:
  - «Войти через Google» — это ссылка `<a>` в виде `Button`, а не POST. Адрес — `/auth/google/start?return_to=<текущий путь>`, строится функцией `PAGES` (§9.1, API §15). Других способов входа нет (ТЗ §4.1 п.1). На `login-failed` кнопка в шапке остаётся. Каким там будет `return_to` (сам `login-failed` им быть не должен) — п.10;
  - кнопка аккаунта: `<button aria-haspopup="menu" aria-expanded>`. Клик, Enter, Space или ↓ открывают меню, фокус уходит на первый пункт. ↑/↓ — между пунктами, Home/End — первый и последний. Esc, клик вне меню, Tab и выбор пункта закрывают меню; после Esc и выбора фокус возвращается на кнопку (§14);
  - «Выйти» → `logout` (`POST /api/auth/logout`). На время запроса пункт `Button state=loading`, меню открыто. Ответ 204 → `Me` сброшен, `data-state="guest"`, меню закрыто, игрок остаётся на текущей странице (п.11). Ошибка → `Toast tone=danger` `error.<code>`, игрок остаётся вошедшим;
  - «Выйти со всех устройств» → `logoutAll` (`POST /api/auth/logout-all`). Состояния те же, что у «Выйти». Подтверждения нет (п.11). Другие вкладки и устройства получают WebSocket 4001 → `session-closed` (E22);
  - ховер, фокус и нажатие — состояния `Button` из библиотеки. У кнопки аккаунта ховер — фон `--color-bg`, как у `secondary` (E01, «Открытые вопросы», п.4). Фокус — `outline: var(--focus-width) solid var(--color-focus)`;
  - ссылки подвала — обычные `<a>` SPA-навигации.
- Доступные имена:
  - кнопка аккаунта — `aria-label` = `t("shell.account_menu", {nickname})` («Меню аккаунта knight_rider»). У П1 ника нет — `t("shell.account_menu_anonymous")` («Меню аккаунта»);
  - `Avatar` внутри кнопки — `alt=""`, декоративный;
  - меню — `role="menu"`, пункты — `role="menuitem"`, имя — видимый текст;
  - переключатель языка — группа с `aria-label` = `t("shell.language")`, у текущего языка `aria-current="true"` (п.2);
  - область `Toast` — `role="status"` (§7).

### `welcome` — первый вход (сценарий 2)
- Макеты: 360 https://www.figma.com/design/z6VyHSdwqFzCQIdP7ScisI?node-id=47-718, 1280 https://www.figma.com/design/z6VyHSdwqFzCQIdP7ScisI?node-id=47-887.
- Темы проверены: light, dark — https://www.figma.com/design/z6VyHSdwqFzCQIdP7ScisI?node-id=47-853 (режим `dark` коллекции `color`). На тёмном фоне различимы: `Checkbox` (`--color-accent` и `--color-accent-on`, рамка `--color-border-strong` на `--color-surface`), ссылки `--color-accent` на `--color-surface`, подсказка `--color-text-muted`.
- Компоненты:
  - шапка `shell` в режиме П1: `Logo`, `Badge`, кнопка аккаунта с `Avatar` без ника; меню — «Выйти», «Выйти со всех устройств» (SECURITY §5: П1 может выйти) — п.4;
  - карточка-форма `<form>`: `--color-surface`, граница `--border-width` `--color-border`, `--radius-m`, поля `--space-5`, зазор `--space-4`. На `s` — на всю ширину (поля экрана `--space-4`), на `m`/`l` — 400 px по центру (п.9). Сверху отступ `--space-6` (`s`) / `--space-8` (`m`/`l`);
  - заголовок `<h1>` «Выберите ник» — `text/xl-strong`;
  - `TextField` «Ник» с подсказкой «3–20 символов: латиница, цифры, _ и -» (`--color-text-muted`) — `aria-describedby` на подсказку;
  - `Checkbox` «Принимаю правила и политику конфиденциальности». «правила» — ссылка на `/terms`, «политику конфиденциальности» — на `/privacy` (`--color-accent`, подчёркнуты) — п.6;
  - `Button variant=primary size=m` «Продолжить» на всю ширину карточки (E01, «Открытые вопросы», п.14 — `size=l` не нужен).
- Новые компоненты: `Checkbox` — он есть в §7, но в библиотеке его не было. Описание — раздел «Новые компоненты».
- Состояния:
  - `default`: галочки нет → «Продолжить» `state=disabled` (`47:718`); галочка стоит → `state=default` (`47:887`);
  - `field-error` — https://www.figma.com/design/z6VyHSdwqFzCQIdP7ScisI?node-id=47-750 (`error.nickname_invalid`, неверный формат, проверка на клиенте до отправки) и https://www.figma.com/design/z6VyHSdwqFzCQIdP7ScisI?node-id=47-784 (`error.nickname_taken`, ответ сервера). `TextField state=error`: рамка 2 px `--color-danger`, текст ошибки `--color-danger` под полем вместо подсказки (п.7). Так же выглядит и `error.nickname_reserved`. Галочка и данные формы сохраняются;
  - `submitting` — https://www.figma.com/design/z6VyHSdwqFzCQIdP7ScisI?node-id=47-818: `TextField state=disabled`, `Checkbox value=true state=disabled`, «Продолжить» `state=loading` (§10.1);
  - `error*`: `internal`, `rate_limited` или сеть → `Toast tone=danger` `error.<code>`, форма возвращается в `default` с теми же данными (§10.1, §11). Фрейма нет.
- Поведение:
  - при открытии фокус на поле «Ник»; порядок Tab: поле → галочка → «правила» → «политику конфиденциальности» → «Продолжить» → подвал;
  - проверка формата на клиенте — при отправке (regex `^[A-Za-z0-9_-]{3,20}$`, тот же, что в `packages/protocol`). Ошибка → `field-error` без запроса. Ошибка поля сбрасывается при первом изменении ника (п.8);
  - Enter в поле отправляет форму, только если галочка стоит (кнопка активна). Без галочки Enter ничего не делает;
  - «Продолжить» → `completeOnboarding` `{"nickname", "terms_accepted": true}` → `submitting`:
    - `nickname_invalid` / `nickname_reserved` / `nickname_taken` → `field-error`, фокус на поле;
    - `onboarding_completed` → переход на `/`;
    - успех → U29 (язык гостя из `localStorage` → `PATCH /api/me {"locale"}`), затем переход (куда — п.10);
  - клик по подписи `Checkbox` переключает галочку. Клик по ссылке в подписи галочку не переключает и открывает `/terms` / `/privacy` (как — п.6);
  - `disabled` у «Продолжить» не убирает подсказку причины: у кнопки `aria-describedby` на подпись галочки (§14).
- Доступные имена:
  - поле — `<label>` `welcome.nickname_label` («Ник»); `aria-describedby` — подсказка, а при ошибке — текст ошибки; `aria-invalid="true"` в `field-error`;
  - галочка — `<input type="checkbox">` внутри `<label>`; имя — вся подпись `welcome.terms`;
  - кнопка — видимый текст; в `submitting` — `aria-busy="true"` на форме.

### `legal` — `/terms`, `/privacy` (сценарий 4)
- Макеты: 360 https://www.figma.com/design/z6VyHSdwqFzCQIdP7ScisI?node-id=48-820, 1280 https://www.figma.com/design/z6VyHSdwqFzCQIdP7ScisI?node-id=48-865.
- Темы проверены: light. Своих цветов у экрана нет — только `--color-text` и `--color-text-muted` на `--color-bg`.
- Компоненты: `shell` (в макете — гость, у игрока шапка из `default`); колонка `<article>`: на `s` — на всю ширину, на `m`/`l` — 720 px по центру (п.9), зазор `--space-4`. В колонке `<h1>` `text/xl-strong` и абзац-заглушка `text/m` `--color-text-muted`.
- Один экран на оба маршрута: `/terms` — заголовок «Правила платформы», `/privacy` — «Политика конфиденциальности». Отдельный фрейм для `/privacy` не рисовался: раскладка та же. `data-screen="legal"`, `data-state="default"`.
- Текст — заглушка «Текст правил готовится и будет опубликован до открытой беты.» (ROADMAP «Открытые вопросы» п.3, SECURITY F3-Q1). Когда появится настоящий текст: заголовки разделов `text/l-strong`, абзацы `text/m` `--color-text`, зазор `--space-4`. Даты и версии в макете нет (п.17).
- Новые компоненты: нет. Состояния: `default`; запроса у экрана нет, текст в бандле.
- Поведение: статичная страница; Tab ходит по шапке и подвалу. Открыта в новой вкладке из `/welcome` — п.6.
- Доступные имена: `<h1>` — заголовок страницы; `document.title` = `legal.terms.title` / `legal.privacy.title` + « — Chezz».

### `login-failed` — ошибка входа (сценарий 5)
- Макеты: 360 https://www.figma.com/design/z6VyHSdwqFzCQIdP7ScisI?node-id=48-842, 1280 https://www.figma.com/design/z6VyHSdwqFzCQIdP7ScisI?node-id=48-796.
- Темы проверены: light (цветов сверх `shell` нет).
- Компоненты: `shell` гостя; по центру контента колонка с зазором `--space-5`: `<h1>` «Не удалось войти» (`text/xl-strong`) и `Button variant=primary size=m` «Попробовать снова».
- Когда показывается: ответ `/auth/google/callback` при любой ошибке — отказ в Google, неверный `state`, ошибка сервера или Google. Причину гостю не показываем (SECURITY §4: «без подробностей», DESIGN §11: без `message` и `request_id`). Поэтому экран один, без кода ошибки.
- Новые компоненты: нет. Состояния: `default`.
- Поведение: «Попробовать снова» — ссылка на `/auth/google/start?return_to=…` (п.10). «Войти через Google» в шапке ведёт туда же. Фокус при открытии — на `<h1>` (`tabindex="-1"`), чтобы скринридер прочитал причину.
- Доступные имена: кнопка — видимый текст; `document.title` = `login_failed.title` + « — Chezz».

## Новые компоненты

### `Checkbox` (общий, есть в §7, создан в библиотеке)
- Узел: `01 Components`, набор `Checkbox` — https://www.figma.com/design/z6VyHSdwqFzCQIdP7ScisI?node-id=42-44.
- Варианты: `value=false|true` × `state=default|hover|focus|disabled` (8). Свойство TEXT `label`. `state=error` не делался: в E04 он не нужен («Продолжить» без галочки неактивна), а значение есть в списке §7 — добавлю, когда понадобится.
- Строение: строка с зазором `--space-2`, `min-height: --layout-touch-target` (вся подпись — цель касания). Квадрат 20×20 (п.5), `--radius-s`, граница `--border-width`.
  - `value=false`: фон `--color-surface`, граница `--color-border-strong`; `hover` — граница `--color-text`.
  - `value=true`: фон и граница `--color-accent`, галочка — штрих 2 px `--color-accent-on`; `hover` — `--color-accent-hover`.
  - `focus`: граница `--focus-width` `--color-focus` (в коде — `outline` вокруг квадрата, §14).
  - `disabled`: `opacity: 0.4` (как у остальных, E01, «Открытые вопросы», п.4).
  - Подпись — `text/m`, `--color-text`.
- Код: `apps/web/src/shared/ui/Checkbox/`, props по §7 (`label`, `value`, `onChange`, `error?`). Нативный `<input type="checkbox">` визуально скрыт, квадрат рисует CSS. Подпись — `<label>`. `label` — `ReactNode`, а не только строка, иначе нельзя вставить ссылки (п.6).
- Новых токенов нет.

## Тексты (ключи — предложение designer, окончательные — в `packages/i18n`)

| Ключ | RU | EN |
|---|---|---|
| `shell.login_google` | Войти через Google | Sign in with Google |
| `shell.account_menu` | Меню аккаунта {nickname} | Account menu {nickname} |
| `shell.account_menu_anonymous` | Меню аккаунта | Account menu |
| `shell.logout` | Выйти | Sign out |
| `shell.logout_all` | Выйти со всех устройств | Sign out of all devices |
| `shell.session_closed` | Вы вышли из аккаунта | You have been signed out |
| `shell.footer.terms` | Правила | Terms |
| `shell.footer.privacy` | Конфиденциальность | Privacy |
| `shell.language` | Язык | Language |
| `welcome.title` | Выберите ник | Choose a nickname |
| `welcome.nickname_label` | Ник | Nickname |
| `welcome.nickname_hint` | 3–20 символов: латиница, цифры, _ и - | 3–20 characters: Latin letters, digits, _ and - |
| `welcome.terms` | Принимаю {terms} и {privacy} | I accept the {terms} and the {privacy} |
| `welcome.terms_link` | правила | Terms of Service |
| `welcome.privacy_link` | политику конфиденциальности | Privacy Policy |
| `welcome.submit` | Продолжить | Continue |
| `legal.terms.title` | Правила платформы | Terms of Service |
| `legal.privacy.title` | Политика конфиденциальности | Privacy Policy |
| `legal.placeholder` | Текст готовится и будет опубликован до открытой беты. | This text is being prepared and will be published before the open beta. |
| `login_failed.title` | Не удалось войти | Couldn't sign in |
| `login_failed.retry` | Попробовать снова | Try again |

Ошибки берутся из существующих ключей: `error.nickname_invalid`, `error.nickname_reserved`, `error.nickname_taken`, `error.onboarding_completed`, `error.network`, `error.internal`, `error.rate_limited`. Термины — GLOSSARY §5: «Ник / Nickname», «Принятие правил / Terms acceptance», «Сессия / Session».

## Токены
Новых токенов нет. Все значения макетов — токены DESIGN §4–§6, §7.1 и стили `text/*`, `shadow/m`. Три литерала без токена вынесены в вопросы: квадрат `Checkbox` 20 px (п.5), ширина формы 400 px и колонки текста 720 px (п.9).

## Открытые вопросы
1. **architect — компонент меню.** «`Avatar` с меню» (§9.1) и «меню» шапки на `s` (§8) есть, а компонента в §7 нет. Предлагаю общий `Menu` в таблицу §7:
   - props: `label` (идёт в `aria-label` кнопки), `trigger`, `items: {id, label, onSelect, loading?}[]`;
   - правила: `role="menu"`, клавиши ↑ ↓ Home End Esc, фокус возвращается на кнопку;
   - вид: `--color-surface`, `--color-border`, `--radius-m`, `--shadow-m`, пункты — `Button variant=ghost`; `z-index` — `--z-header` (меню внутри шапки).
   
   Новых токенов не нужно. До правки §7 в Figma — набросок (`46:724`, `46:819`), в библиотеку не добавлялся (§16.4).
2. **Ivan / architect — переключатель языка в подвале (U21).** Компонент в §7 не назван, и неясно, входит ли он в E04. Предлагаю две ссылки-кнопки `RU` / `EN` (`Button variant=ghost`, текущая — `text/s` жирный, `aria-current`) или `SegmentedControl` с 2 вариантами. Если язык делает другой эпик — в подвале E04 только ссылки «Правила» и «Конфиденциальность».
3. **Ivan — состав шапки в E04.** Навигация «Играть · Лидеры · Профиль» и «Сообщить об ошибке / идея» в фреймах E04 не нарисованы: их экранов ещё нет. Их ставят E09/E11/E14 и E18. Подтвердите.
4. **Ivan / architect — шапка П1 на `/welcome`.** В макете у П1 `Avatar` с меню «Выйти» / «Выйти со всех устройств»: SECURITY §5 разрешает П1 выходить, а иначе с `/welcome` не уйти. Заглушка `Avatar` без ника — буква из `nickname` недоступна, `google_name` в интерфейсе не показывается (GLOSSARY §5). Нужна иконка-заглушка (E01, «Открытые вопросы», п.6, п.17). Отдельно — architect: куда SPA ведёт П1, который открыл другой маршрут (на `/welcome` или страница как у гостя).
5. **architect — размер квадрата `Checkbox`.** 20 px — токена нет (как и у иконки 20 px в `IconButton`). Предлагаю `--layout-control-icon: 1.25rem` в §4 или считать это частью набора иконок (E01, «Открытые вопросы», п.17). Ещё: при подписи в 2 строки квадрат стоит по центру строки. Лучше выровнять его по первой строке (`align-items: flex-start` + отступ) — поправлю компонент после ответа.
6. **architect / frontend — ссылки внутри подписи галочки.** §15 запрещает склеивать фразы и HTML в переводах. Предлагаю `welcome.terms` с подстановками `{terms}` / `{privacy}`, куда `t()` вставляет React-узлы-ссылки (`welcome.terms_link`, `welcome.privacy_link`). Это требует, чтобы `t` умел ReactNode, — правка §15. Куда открывать: в новой вкладке (`target="_blank" rel="noopener"`), чтобы не потерять введённый ник. Либо в той же вкладке, сохранив черновик формы. Предлагаю новую вкладку.
7. **Ivan / architect — подсказка и ошибка поля.** У `TextField state=error` текст ошибки стоит вместо подсказки. Для `nickname_invalid` игрок тогда теряет правила ника. Варианты:
   - а) в `error` показывать и ошибку, и подсказку (правка компонента, токенов не нужно);
   - б) `error.nickname_invalid` = «Ник: 3–20 символов — латиница, цифры, _ и -».
   
   Предлагаю а.
8. **frontend — когда проверять формат.** Предлагаю: при отправке, и при уходе с поля после первого изменения (без ошибки на пустом поле до первой отправки). Сброс ошибки — при изменении значения.
9. **architect — ширина формы и текстовой колонки.** 400 px (`welcome`) и 720 px (`legal`) без токена (E01, «Открытые вопросы», п.5). Предлагаю `--layout-form-max: 25rem` и `--layout-text-max: 45rem` в §4. Иначе — без ограничения, на всю ширину контейнера.
10. **architect — куда ведут после входа.**
    - а) После `completeOnboarding` — на `/` или на исходный `return_to`. Нужно, чтобы callback сохранил его до конца `/welcome` (например, `/welcome?return_to=`). Сценарий «2 клика» (ТЗ §7) по ссылке вызова ломается, если вести на `/`.
    - б) Кто рисует `login-failed`: SPA-маршрут (например `/login-failed`, `noindex`) или страница сервера. Сохраняет ли «Попробовать снова» `return_to`.
    - в) Различать ли отказ пользователя в Google и ошибку сервера: сейчас текст один, по SECURITY §4.
11. **Ivan — выход.** Предложение:
    - «Выйти» — игрок остаётся на текущей странице как гость (на приватной странице, например `/settings`, — переход на `/`), `Toast` нет;
    - «Выйти со всех устройств» — без `Dialog` подтверждения: действие обратимо входом;
    - в этой вкладке после `logoutAll` — тот же `Toast` «Вы вышли из аккаунта», что у `session-closed`.
    
    Нужно ли подтверждение?
12. **Ivan — бренд Google на кнопке.** Правила Google для кнопки входа рекомендуют знак «G» слева. Иконок в DESIGN нет (E01, «Открытые вопросы», п.17), а CSP разрешает только `self` — нужен локальный SVG. Сейчас кнопка — `Button primary` только с текстом. Решите: добавлять знак (свойство `icon` у `Button`, правка §7) или оставить текст.
13. **оркестратор — фреймы 10.2 у `shell`.** `reconnecting`, `offline`, `outdated`, `too-many-tabs` зависят от WebSocket-клиента (E22) — нарисую в E22. В E04 есть только `session-closed`. Если WebSocket в E04 не появляется, `session-closed` в этой вкладке срабатывает только после своего `logoutAll` (п.11).
14. **frontend — `shell error*`.** `/api/me` не ответил → шапка гостя + `Toast tone=danger` `error.network`. Повторный запрос — при следующей навигации, не таймером. Подтвердите, что авто-повтора нет.
15. **Ivan — EN-строки** таблицы «Тексты» — черновик designer. Отдельные EN-фреймы не рисовались: самая длинная строка («Sign out of all devices») короче RU.
16. **Ivan — версия правил** (ROADMAP «Открытые вопросы» п.3). Если нужна повторная галочка при смене текста — понадобятся экран или `Dialog` «Правила обновились» и строка в §9/§10.4. Сейчас его нет.
17. **Ivan — дата редакции на `/terms` и `/privacy`.** Нужна ли строка «Редакция от …» (`Intl.DateTimeFormat`, §15) — зависит от п.16.
