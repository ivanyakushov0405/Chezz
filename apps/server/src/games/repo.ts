// SQL модуля games (ARCHITECTURE §7.4, §8): единственное место, где читается и пишется games.
import { sql, type Insertable, type Selectable } from "kysely";
import { forTables, type Db, type Trx } from "../platform/db.ts";
import type { GameResultValue, GamesTable, GamesTables, MoveRecord, TerminationValue } from "./tables.ts";

export type GameRow = Selectable<GamesTable>;

export async function insertGame(trx: Trx, row: Insertable<GamesTable>): Promise<GameRow> {
  return forTables<GamesTables>(trx).insertInto("games").values(row).returningAll().executeTakeFirstOrThrow();
}

export async function findGame(db: Db | Trx, id: string): Promise<GameRow | null> {
  return (await forTables<GamesTables>(db).selectFrom("games").selectAll().where("id", "=", id).executeTakeFirst()) ?? null;
}

/** Все `active` Game — комнаты при старте app (ARCHITECTURE §9.3). */
export async function findActiveGames(db: Db): Promise<GameRow[]> {
  return forTables<GamesTables>(db).selectFrom("games").selectAll().where("status", "=", "active").orderBy("started_at").execute();
}

/** Игроки из `userIds`, у которых есть `active` Game (A25). */
export async function playersWithActiveGame(db: Db | Trx, userIds: readonly string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await forTables<GamesTables>(db)
    .selectFrom("games")
    .select(["white_id", "black_id"])
    .where("status", "=", "active")
    .where((eb) => eb.or([eb("white_id", "in", userIds), eb("black_id", "in", userIds)]))
    .execute();
  const busy = new Set<string>();
  for (const r of rows) {
    if (userIds.includes(r.white_id)) busy.add(r.white_id);
    if (userIds.includes(r.black_id)) busy.add(r.black_id);
  }
  return [...busy];
}

/** id `active` Game игрока или null (`Me.active_game_id`). */
export async function activeGameIdOf(db: Db | Trx, userId: string): Promise<string | null> {
  const row = await forTables<GamesTables>(db)
    .selectFrom("games")
    .select("id")
    .where("status", "=", "active")
    .where((eb) => eb.or([eb("white_id", "=", userId), eb("black_id", "=", userId)]))
    .executeTakeFirst();
  return row?.id ?? null;
}

export async function countActiveGames(db: Db): Promise<number> {
  const row = await forTables<GamesTables>(db)
    .selectFrom("games")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("status", "=", "active")
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

/** Ход (ARCHITECTURE §9.2 п.4): `moves = moves || <Move>` только у `active` с ожидаемой длиной; false — не записан. */
export async function appendMove(db: Db | Trx, id: string, expectedPly: number, move: MoveRecord): Promise<boolean> {
  const res = await forTables<GamesTables>(db)
    .updateTable("games")
    .set({ moves: sql`moves || ${JSON.stringify([move])}::jsonb` })
    .where("id", "=", id)
    .where("status", "=", "active")
    .where(sql<boolean>`jsonb_array_length(moves) = ${expectedPly}`)
    .executeTakeFirst();
  return res.numUpdatedRows === 1n;
}

export interface FinishValues {
  status: "finished" | "aborted";
  result: GameResultValue | null;
  termination: TerminationValue;
  pgn: string;
  ended_at: Date;
  /** Все ходы партии (последний ход и итог — одной записью). */
  moves: readonly MoveRecord[];
}

/** Итог (ARCHITECTURE §9.1 п.7) — только у `active`; false — партия уже закончена. */
export async function finishGame(trx: Trx, id: string, values: FinishValues): Promise<boolean> {
  const { moves, ...rest } = values;
  const res = await forTables<GamesTables>(trx)
    .updateTable("games")
    .set({ ...rest, moves: JSON.stringify(moves) })
    .where("id", "=", id)
    .where("status", "=", "active")
    .executeTakeFirst();
  return res.numUpdatedRows === 1n;
}
