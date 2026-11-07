// Сид (TESTING §7.6): node apps/server/scripts/seed.ts --demo — в базу из DATABASE_URL.
// При APP_ENV=prod — ошибка до подключения к БД, ничего не записано (MUST).
// В E01 таблиц нет: --demo на пустой схеме ничего не пишет; состав сида дописывают эпики с таблицами (E04…).
// --load N --tokens <файл> — E21.
import { createDb } from "../src/platform/db.ts";
import type { Database } from "../src/database.ts";

const USAGE = "usage: node apps/server/scripts/seed.ts --demo";

function fail(message: string, code: number): never {
  process.stderr.write(`seed: ${message}\n`);
  process.exit(code);
}

async function main(): Promise<void> {
  if (process.env.APP_ENV === "prod") fail("refused: APP_ENV=prod (seed never writes to prod)", 1);

  const args = process.argv.slice(2);
  if (args.includes("--load")) fail("--load is not available yet (E21)", 2);
  if (args.length !== 1 || args[0] !== "--demo") fail(USAGE, 2);

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) fail("DATABASE_URL is not set", 2);

  const db = createDb<Database>(databaseUrl, { max: 1 });
  try {
    // Проверка подключения; данные --demo появятся вместе с таблицами (E04 и далее).
    await db.connection().execute(async () => undefined);
  } finally {
    await db.destroy();
  }
  process.stdout.write("seed: --demo done (no tables yet)\n");
}

main().catch((err: unknown) => {
  const e = err instanceof Error ? err : new Error(String(err));
  fail(`${e.name}: ${e.message}`, 1);
});
