// Фикстуры шахмат (TESTING §7.4; ARCHITECTURE §10; бриф E06 К-1, E-1).
// Каждый случай fixtures/chess/<тема>.json проходит через публичный API @chezz/chess:
// SAN каждого хода, полный список допустимых UCI, отказ недопустимых, окончание и исход флага.
// Данные случаев сверены с chess.js 1.4 вне репозитория; правила — FIDE (ТЗ §7).
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ChessPosition, type Color, type Outcome } from "@chezz/chess";

const FIXTURES = new URL("../../../fixtures/chess/", import.meta.url);
const TOPICS = [
  "castling",
  "en-passant",
  "promotion",
  "checkmate",
  "stalemate",
  "threefold",
  "fifty-moves",
  "insufficient-material",
  "flag",
] as const;
const RESULTS = ["white_wins", "black_wins", "draw"];
const TERMINATIONS = [
  "checkmate",
  "stalemate",
  "threefold_repetition",
  "fifty_moves",
  "insufficient_material",
  "timeout",
  "timeout_insufficient_material",
];
const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

interface FixtureMove {
  uci: string;
  san: string;
}
interface Case {
  id: string;
  tz: string;
  fen: string | null;
  moves: FixtureMove[];
  legal: string[] | null;
  illegal: string[];
  flag: Color | null;
  expect: Outcome | null;
}

const files = readdirSync(FIXTURES)
  .filter((f) => f.endsWith(".json"))
  .sort();

function load(file: string): Case[] {
  const data: unknown = JSON.parse(readFileSync(new URL(file, FIXTURES), "utf8"));
  if (!Array.isArray(data)) throw new Error(`${file}: ожидался массив случаев`);
  return data as Case[];
}

const all: Case[] = files.flatMap(load);
const byId = (id: string): Case => {
  const c = all.find((x) => x.id === id);
  if (!c) throw new Error(`нет случая ${id}`);
  return c;
};

// E-1: случаи «превращение без буквы» помечены суффиксом -e1 в id.
const criteria = (c: Case): string => (c.id.endsWith("-e1") ? "К-1, E-1" : "К-1");

function assertShape(c: Case): void {
  expect(typeof c.id === "string" && c.id.length > 0, "id").toBe(true);
  expect(typeof c.tz, `${c.id}: tz`).toBe("string");
  expect(c.fen === null || typeof c.fen === "string", `${c.id}: fen`).toBe(true);
  expect(Array.isArray(c.moves), `${c.id}: moves`).toBe(true);
  for (const m of c.moves) {
    expect(m.uci, `${c.id}: uci`).toMatch(/^[a-h][1-8][a-h][1-8][qrbn]?$/);
    expect(typeof m.san, `${c.id}: san`).toBe("string");
  }
  expect(c.legal === null || Array.isArray(c.legal), `${c.id}: legal`).toBe(true);
  expect(Array.isArray(c.illegal), `${c.id}: illegal`).toBe(true);
  expect([null, "white", "black"], `${c.id}: flag`).toContain(c.flag);
  if (c.expect !== null) {
    expect(RESULTS, `${c.id}: result`).toContain(c.expect.result);
    expect(TERMINATIONS, `${c.id}: termination`).toContain(c.expect.termination);
  }
  if (c.flag !== null) expect(c.expect, `${c.id}: у флага expect обязателен`).not.toBeNull();
}

// Проигрывает ходы случая, сверяя SAN, очередь хода и шах; возвращает конечную позицию.
function replay(c: Case): ChessPosition {
  const pos = ChessPosition.start(c.fen);
  for (const [i, m] of c.moves.entries()) {
    const before = pos.turn();
    const got = pos.play(m.uci);
    expect(got, `${c.id}: ход ${i + 1} ${m.uci} отклонён`).not.toBeNull();
    expect(got?.san, `${c.id}: SAN хода ${i + 1} ${m.uci}`).toBe(m.san);
    expect(pos.turn(), `${c.id}: очередь после ${m.uci}`).toBe(before === "white" ? "black" : "white");
    expect(pos.inCheck(), `${c.id}: шах после ${m.san}`).toBe(/[+#]$/.test(m.san));
  }
  return pos;
}

describe("@chezz/chess: фикстуры fixtures/chess", () => {
  it("К-1: все 9 тем на месте, id уникальны, у каждой темы есть случаи", () => {
    expect(files).toEqual([...TOPICS].map((t) => `${t}.json`).sort());
    for (const f of files) expect(load(f).length, f).toBeGreaterThan(0);
    const ids = all.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Обязательные окончания (ТЗ §7): каждое встречается хотя бы раз.
    const terms = new Set(all.map((c) => c.expect?.termination));
    for (const t of TERMINATIONS) expect(terms, t).toContain(t);
  });

  for (const file of files) {
    describe(file, () => {
      for (const c of load(file)) {
        it(`${criteria(c)}: ${c.id}`, () => {
          assertShape(c);
          const pos = replay(c);

          const legal = pos.legalUci();
          expect(legal, `${c.id}: legalUci() отсортирован`).toEqual([...legal].sort());
          if (c.legal !== null) expect(legal, `${c.id}: полный список допустимых UCI`).toEqual(c.legal);
          for (const m of c.legal ?? []) expect(m).toMatch(/^[a-h][1-8][a-h][1-8][qrbn]?$/);

          for (const u of c.illegal) {
            const fen = pos.fen();
            const ply = pos.ply();
            expect(pos.play(u), `${c.id}: ${u} должен быть отклонён`).toBeNull();
            expect(pos.fen(), `${c.id}: после отказа ${u} позиция не меняется`).toBe(fen);
            expect(pos.ply(), `${c.id}: после отказа ${u} ply не меняется`).toBe(ply);
            expect(legal, `${c.id}: ${u} нет в legalUci()`).not.toContain(u);
          }

          if (c.flag !== null) {
            expect(pos.outcome(), `${c.id}: позиция флага — партия ещё идёт`).toBeNull();
            expect(pos.flagOutcome(c.flag), `${c.id}: исход флага ${c.flag}`).toEqual(c.expect);
          } else {
            expect(pos.outcome(), `${c.id}: окончание`).toEqual(c.expect);
          }
        });
      }
    });
  }
});

describe("@chezz/chess: публичный API вне фикстур", () => {
  it("К-1: start(null) и start() — стандартная позиция, белые на ходу, ply 0, 20 ходов", () => {
    for (const pos of [ChessPosition.start(null), ChessPosition.start()]) {
      expect(pos.fen()).toBe(START_FEN);
      expect(pos.turn()).toBe("white");
      expect(pos.ply()).toBe(0);
      expect(pos.inCheck()).toBe(false);
      expect(pos.legalUci()).toHaveLength(20);
      expect(pos.outcome()).toBeNull();
    }
  });

  it("К-1: ply растёт на каждый принятый ход и не меняется на отказ", () => {
    const pos = ChessPosition.start(null);
    expect(pos.play("e2e4")).toEqual({ san: "e4" });
    expect(pos.ply()).toBe(1);
    expect(pos.play("e2e4")).toBeNull();
    expect(pos.ply()).toBe(1);
    expect(pos.play("e7e5")).toEqual({ san: "e5" });
    expect(pos.ply()).toBe(2);
  });

  it("К-1: мусорный UCI отклоняется, позиция не меняется", () => {
    const pos = ChessPosition.start(null);
    const fen = pos.fen();
    for (const u of ["", "e2", "e2e9", "i2i4", "e2e4e5", "e2-e4", "O-O", "e4", "e1e1"]) {
      expect(pos.play(u), u).toBeNull();
      expect(pos.fen(), u).toBe(fen);
    }
  });

  it("К-1, E-1: e7e8 без буквы отклонён, e7e8q принят как e8=Q", () => {
    const pos = ChessPosition.start("8/4P3/8/8/8/8/k6P/4K3 w - - 0 1");
    const fen = pos.fen();
    expect(pos.play("e7e8")).toBeNull();
    expect(pos.fen()).toBe(fen);
    expect(pos.legalUci()).not.toContain("e7e8");
    expect(pos.play("e7e8q")).toEqual({ san: "e8=Q" });
    expect(pos.turn()).toBe("black");
  });

  const fromStart = all.filter((c) => c.fen === null && c.moves.length > 0);

  it("К-1: среди фикстур есть партии из начальной позиции для fromSans", () => {
    expect(fromStart.length).toBeGreaterThanOrEqual(10);
  });

  for (const c of fromStart) {
    it(`К-1: fromSans восстанавливает ${c.id}`, () => {
      const played = ChessPosition.start(null);
      for (const m of c.moves) expect(played.play(m.uci), m.uci).not.toBeNull();
      const restored = ChessPosition.fromSans(c.moves.map((m) => m.san));
      expect(restored.fen()).toBe(played.fen());
      expect(restored.turn()).toBe(played.turn());
      expect(restored.ply()).toBe(c.moves.length);
      expect(restored.inCheck()).toBe(played.inCheck());
      expect(restored.legalUci()).toEqual(played.legalUci());
      // История позиций восстановлена: троекратное повторение и мат видны так же, как после play.
      expect(restored.outcome()).toEqual(played.outcome());
      expect(restored.outcome()).toEqual(c.flag === null ? c.expect : null);
    });
  }

  it("К-1: fromSans([]) — стандартная позиция", () => {
    const pos = ChessPosition.fromSans([]);
    expect(pos.fen()).toBe(START_FEN);
    expect(pos.ply()).toBe(0);
  });

  it("К-1: позиция из fromSans продолжает играть — повтор коней доводит до троекратного", () => {
    const pos = ChessPosition.fromSans(["Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1"]);
    expect(pos.outcome()).toBeNull();
    expect(pos.play("f6g8")).toEqual({ san: "Ng8" });
    expect(pos.outcome()).toEqual({ result: "draw", termination: "threefold_repetition" });
  });

  it("К-1: fromSans детского мата — мат белых", () => {
    const pos = ChessPosition.fromSans(["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#"]);
    expect(pos.outcome()).toEqual({ result: "white_wins", termination: "checkmate" });
    expect(pos.legalUci()).toEqual([]);
  });

  // canMate: только однозначные по материалу случаи (у другой стороны голый король или ферзь).
  const canMateCases: { id: string; fen: string | null; white: boolean; black: boolean }[] = [
    { id: "начальная позиция", fen: null, white: true, black: true },
    { id: "K+Q против K", fen: "8/8/8/4k3/8/8/8/KQ6 w - - 0 1", white: true, black: false },
    { id: "K+R против K", fen: "8/8/8/4k3/8/8/8/KR6 w - - 0 1", white: true, black: false },
    { id: "K+P против K", fen: "8/8/8/4k3/8/8/P7/K7 w - - 0 1", white: true, black: false },
    { id: "K против K+p", fen: "8/8/8/4k3/4p3/8/8/K7 w - - 0 1", white: false, black: true },
    { id: "K+Q против K+n", fen: "8/8/8/4k3/8/8/8/KQ4n1 w - - 0 1", white: true, black: false },
    { id: "K+Q против K+b", fen: "8/8/8/4k3/8/8/8/KQ4b1 w - - 0 1", white: true, black: false },
    { id: "K+N против K+q", fen: "6q1/8/8/4k3/8/8/8/K5N1 b - - 0 1", white: false, black: true },
    { id: "K+B против K+q", fen: "6q1/8/8/4k3/8/8/8/K5B1 b - - 0 1", white: false, black: true },
  ];
  for (const m of canMateCases) {
    it(`К-1: canMate — ${m.id}`, () => {
      const pos = ChessPosition.start(m.fen);
      expect(pos.canMate("white"), "white").toBe(m.white);
      expect(pos.canMate("black"), "black").toBe(m.black);
    });
  }

  it("К-1: flagOutcome согласован с canMate соперника", () => {
    for (const id of ["flag-white-black-has-knight-draw", "flag-white-black-has-queen-wins", "flag-black-white-has-bishop-draw"]) {
      const c = byId(id);
      const pos = replay(c);
      const flagged = c.flag as Color;
      const opponent: Color = flagged === "white" ? "black" : "white";
      const want: Outcome = pos.canMate(opponent)
        ? { result: opponent === "white" ? "white_wins" : "black_wins", termination: "timeout" }
        : { result: "draw", termination: "timeout_insufficient_material" };
      expect(pos.flagOutcome(flagged), id).toEqual(want);
    }
  });

  it("К-1: play и запросы не меняют позицию, если ход отклонён после окончания (мат)", () => {
    const pos = ChessPosition.fromSans(["f3", "e5", "g4", "Qh4#"]);
    const fen = pos.fen();
    expect(pos.play("e2e4")).toBeNull();
    expect(pos.fen()).toBe(fen);
    expect(pos.outcome()).toEqual({ result: "black_wins", termination: "checkmate" });
  });
});
