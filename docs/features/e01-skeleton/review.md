# Ревью e01-skeleton

## T-1 — итерация 1
Вердикт: APPROVE

Проверено: `deploy/compose.test.yml` (новый, единственное изменение задачи; `log.md` — оркестратор). Состав сервиса `db-test` построчно совпадает с OPERATIONS §6.4 и TESTING §7.1: `postgres:18`, `127.0.0.1:54329:5432`, `chezz`/`chezz`, `tmpfs: /var/lib/postgresql` (для образа 18 `PGDATA` = `/var/lib/postgresql/18/docker` лежит внутри tmpfs), `fsync=off`, `synchronous_commit=off`, `full_page_writes=off`, healthcheck `pg_isready`. AC-1, AC-2, EC-1 подтверждены прогоном оркестратора (`config -q`, двойной `up -d --wait` → один контейнер, healthy; `server_version` 18.6, `fsync` off).
Правила зоны devops (OPERATIONS §1, SECURITY §1, §17, §18): порт только на `127.0.0.1`; нет `privileged`, `docker.sock`, bind-mount хоста; нет `example.com`, логина владельца, IP, секретов (пароль `chezz` — не секрет по OPERATIONS §6.4, отмечен в комментарии); новых зависимостей нет; новый контейнер уже описан в документах (§6.4), правки ARCHITECTURE §14 не требуются. Отдельное имя проекта `chezz-test` не пересекается с prod-проектом `chezz` (OPERATIONS §6.1).
Тестовые пути tester не тронуты.

### Блокеры
- нет

### Желательно
- [deploy/compose.test.yml] Изменён путь `deploy/` — diff показать Ivan до push (O36; OPERATIONS §1).
- [deploy/compose.test.yml:2] Комментарий ссылается на `npm run db:test:up`, которого пока нет (корневого `package.json` нет); EC-1 в формулировке requirements («`npm run db:test:up` дважды») закрывается окончательно только после задачи, добавляющей скрипт, — проверить её там.
