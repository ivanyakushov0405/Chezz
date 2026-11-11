// Сид (TESTING §7.6): node apps/server/scripts/seed.ts --demo — в базу из DATABASE_URL (с применёнными миграциями).
// При APP_ENV=prod — ошибка до подключения к БД, ничего не записано (MUST).
// --demo с E04: Игроки seed_player_01…12 с Session. Rating, партии, вызовы и удалённый игрок — эпики своих таблиц (E05, E06, E08, E19).
// Токен Session — seedSessionToken(секрет, ник) (V20, V23): секрет — SEED_TOKEN_SECRET (staging), иначе фиксированный локальный.
// Повтор на той же базе ничего не пишет (seed_player_01 уже есть).
// --load N --tokens <файл> — E21.
import { createDb } from "../src/platform/db.ts";
import type { Database } from "../src/database.ts";
import { createPlayer } from "../test/support/factories.ts";
import { LOCAL_SEED_SECRET, SEED_PLAYERS, seedSessionToken } from "../test/support/seed-token.ts";

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
  const secret = process.env.SEED_TOKEN_SECRET || LOCAL_SEED_SECRET;

  const db = createDb<Database>(databaseUrl, { max: 1 });
  try {
    const existing = await db.selectFrom("users").select("id").where("google_sub", "=", `seed-${SEED_PLAYERS[0]}`).executeTakeFirst();
    if (existing !== undefined) {
      process.stdout.write("seed: --demo already applied\n");
      return;
    }
    // Срок Session — от реального «сейчас»: иначе cookie сида в e2e истекла бы (данные игроков от времени не зависят).
    const now = new Date();
    for (const [i, nickname] of SEED_PLAYERS.entries()) {
      await createPlayer(db, {
        nickname,
        google_sub: `seed-${nickname}`,
        locale: i % 2 === 0 ? "ru" : "en",
        token: seedSessionToken(secret, nickname),
        now,
      });
    }
  } finally {
    await db.destroy();
  }
  process.stdout.write(`seed: --demo done (${SEED_PLAYERS.length} players)\n`);
}

main().catch((err: unknown) => {
  const e = err instanceof Error ? err : new Error(String(err));
  fail(`${e.name}: ${e.message}`, 1);
});
