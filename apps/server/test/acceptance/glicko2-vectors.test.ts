// Acceptance: эталонные векторы Glicko-2 (TESTING §7.5; ARCHITECTURE §11, A29; бриф E05 К-1, К-2).
// Прогон всех fixtures/glicko2/*.json через единственную функцию пересчёта rateMany.
// Вид вектора задаёт только `kind`; поля `games` и `elapsed_days` обязаны ему соответствовать —
// несоответствие роняет тест вектора. Пропуск — только вид C с `expect = null` (F6-Q3).
// К-1: виды A (single) и B (multi). К-2: вид C (decay) и контроль «elapsedDays = 0 — роста нет».
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rateMany } from "../../src/rating/domain/glicko2.ts";

const FIXTURES = new URL("../../../../fixtures/glicko2/", import.meta.url);
const TAU = 0.5;
const KINDS = ["single", "multi", "decay"] as const;
type Kind = (typeof KINDS)[number];

interface State {
  rating: number;
  rd: number;
  volatility: number;
}
interface Game {
  opponent: { rating: number; rd: number };
  score: 0 | 0.5 | 1;
}
interface Vector {
  id: string;
  kind: Kind;
  source: string;
  tau: number;
  player: State;
  elapsed_days: number;
  games: Game[];
  expect: State | null;
  tolerance: State;
}

const files = readdirSync(FIXTURES)
  .filter((f) => f.endsWith(".json"))
  .sort();

function load(file: string): Vector[] {
  const data: unknown = JSON.parse(readFileSync(new URL(file, FIXTURES), "utf8"));
  if (!Array.isArray(data)) throw new Error(`${file}: ожидался массив векторов`);
  return data as Vector[];
}

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isState = (s: unknown): s is State =>
  typeof s === "object" && s !== null && isNum((s as State).rating) && isNum((s as State).rd) && isNum((s as State).volatility);

// Сверка вида с полями (TESTING §7.5): при несоответствии вектор падает, а не проверяется «как получится».
function assertShape(v: Vector): void {
  expect(KINDS, `${v.id}: неизвестный kind ${String(v.kind)}`).toContain(v.kind);
  expect(v.tau, `${v.id}: tau вектора не совпадает с константой модуля`).toBe(TAU);
  expect(isState(v.player), `${v.id}: player`).toBe(true);
  expect(isState(v.tolerance), `${v.id}: tolerance`).toBe(true);
  expect(isNum(v.elapsed_days) && v.elapsed_days >= 0, `${v.id}: elapsed_days`).toBe(true);
  expect(Array.isArray(v.games), `${v.id}: games`).toBe(true);
  for (const g of v.games) {
    expect(isNum(g.opponent.rating) && isNum(g.opponent.rd), `${v.id}: opponent`).toBe(true);
    expect([0, 0.5, 1], `${v.id}: score`).toContain(g.score);
  }
  switch (v.kind) {
    case "single":
      expect(v.games.length, `${v.id}: single — ровно одна партия`).toBe(1);
      expect(v.elapsed_days, `${v.id}: single — elapsed_days = 0`).toBe(0);
      break;
    case "multi":
      expect(v.games.length, `${v.id}: multi — больше одной партии`).toBeGreaterThan(1);
      break;
    case "decay":
      expect(v.games.length, `${v.id}: decay — ровно одна партия`).toBe(1);
      expect(v.elapsed_days, `${v.id}: decay — elapsed_days > 0`).toBeGreaterThan(0);
      break;
  }
  if (v.kind !== "decay") expect(isState(v.expect), `${v.id}: expect обязателен для ${v.kind}`).toBe(true);
}

function criteria(file: string, v: Vector): string {
  if (v.kind === "decay") return "К-2";
  if (file === "decay.json") return "К-1, К-2";
  return "К-1";
}

describe("Glicko-2: эталонные векторы fixtures/glicko2", () => {
  it("К-1, К-2: наборы на месте — пример Glickman, ≥ 30 партий 4 игроков, вид C", () => {
    expect(files).toEqual(expect.arrayContaining(["glickman.json", "sequence.json", "decay.json"]));
    const glickman = load("glickman.json");
    expect(glickman.some((v) => v.id === "glickman-example" && v.kind === "multi")).toBe(true);
    const seq = load("sequence.json");
    // Партия — два вектора (белые и чёрные): ≥ 30 партий → ≥ 60 векторов single.
    expect(seq.filter((v) => v.kind === "single").length).toBeGreaterThanOrEqual(60);
    const players = new Set(seq.map((v) => JSON.stringify(v.player)));
    expect(players.size).toBeGreaterThanOrEqual(4);
    expect(new Set(seq.map((v) => v.games[0]?.score))).toEqual(new Set([0, 0.5, 1]));
    const decay = load("decay.json").filter((v) => v.kind === "decay");
    expect(decay.length).toBeGreaterThanOrEqual(3);
    expect(decay.every((v) => v.expect !== null)).toBe(true);
  });

  for (const file of files) {
    describe(file, () => {
      for (const v of load(file)) {
        const skip = v.kind === "decay" && v.expect === null;
        const name = skip ? `[skip: F6-Q3] ${v.id}` : `${criteria(file, v)}: ${v.id}`;
        it.skipIf(skip)(name, () => {
          assertShape(v);
          const want = v.expect as State;
          const got = rateMany(
            { ...v.player },
            v.games.map((g) => ({ opponent: { ...g.opponent }, score: g.score })),
            v.elapsed_days,
          );
          expect(Math.abs(got.rating - want.rating), `${v.id}: rating ${got.rating} ≠ ${want.rating}`).toBeLessThanOrEqual(
            v.tolerance.rating,
          );
          expect(Math.abs(got.rd - want.rd), `${v.id}: rd ${got.rd} ≠ ${want.rd}`).toBeLessThanOrEqual(v.tolerance.rd);
          expect(
            Math.abs(got.volatility - want.volatility),
            `${v.id}: volatility ${got.volatility} ≠ ${want.volatility}`,
          ).toBeLessThanOrEqual(v.tolerance.volatility);
        });
      }
    });
  }
});
