// Правила шахмат (ARCHITECTURE §10): обёртка chess.js — один пакет у сервера и клиента (A3).
// Применение хода в UCI, SAN, окончания и «может ли сторона поставить мат» для флага (§9.1 п.8).
import { Chess, type Square } from "chess.js";

export type Color = "white" | "black";

/** Автоокончания (ТЗ §4.6, GLOSSARY §8). */
export type Termination = "checkmate" | "stalemate" | "threefold_repetition" | "fifty_moves" | "insufficient_material";

export interface Outcome {
  result: "white_wins" | "black_wins" | "draw";
  termination: Termination | "timeout" | "timeout_insufficient_material";
}

const UCI_RE = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;

const toColor = (c: "w" | "b"): Color => (c === "w" ? "white" : "black");
const winOf = (color: Color): Outcome["result"] => (color === "white" ? "white_wins" : "black_wins");
const other = (color: Color): Color => (color === "white" ? "black" : "white");

/** Цвет поля: a1 тёмное (сумма координат чётная). */
const isDarkSquare = (square: string): boolean => (square.charCodeAt(0) - 97 + Number(square[1]) - 1) % 2 === 0;

export class ChessPosition {
  readonly #chess: Chess;

  private constructor(chess: Chess) {
    this.#chess = chess;
  }

  /** Позиция из FEN; null или без аргумента — стандартная начальная. Неверный FEN — ошибка. */
  static start(fen?: string | null): ChessPosition {
    return new ChessPosition(fen === undefined || fen === null ? new Chess() : new Chess(fen));
  }

  /** Восстановление по SAN `moves[]` партии (ARCHITECTURE §9.3); недопустимый SAN — ошибка. */
  static fromSans(sans: readonly string[]): ChessPosition {
    const chess = new Chess();
    for (const san of sans) chess.move(san);
    return new ChessPosition(chess);
  }

  /** Ход в UCI (`e2e4`, `e7e8q`); null — ход недопустим, позиция не меняется. Превращение — только с буквой. */
  play(uci: string): { san: string } | null {
    const m = UCI_RE.exec(uci);
    if (m === null) return null;
    const [, from, to, promotion] = m as unknown as [string, Square, Square, string | undefined];
    const candidate = this.#chess
      .moves({ verbose: true, square: from })
      .find((move) => move.to === to && (move.promotion ?? undefined) === promotion);
    if (candidate === undefined) return null;
    const done = this.#chess.move({ from, to, ...(promotion === undefined ? {} : { promotion }) });
    return { san: done.san };
  }

  /** Все допустимые ходы в UCI, отсортированы. */
  legalUci(): string[] {
    return this.#chess
      .moves({ verbose: true })
      .map((move) => move.from + move.to + (move.promotion ?? ""))
      .sort();
  }

  turn(): Color {
    return toColor(this.#chess.turn());
  }

  /** Число сделанных полуходов от начала (для позиции из FEN — с этой позиции). */
  ply(): number {
    return this.#chess.history().length;
  }

  fen(): string {
    return this.#chess.fen();
  }

  inCheck(): boolean {
    return this.#chess.inCheck();
  }

  /** Автоокончание (ТЗ §4.6) или null — партия идёт. Мат проверяется первым. */
  outcome(): Outcome | null {
    const c = this.#chess;
    if (c.isCheckmate()) return { result: winOf(other(this.turn())), termination: "checkmate" };
    if (c.isStalemate()) return { result: "draw", termination: "stalemate" };
    if (c.isInsufficientMaterial()) return { result: "draw", termination: "insufficient_material" };
    if (c.isThreefoldRepetition()) return { result: "draw", termination: "threefold_repetition" };
    if (c.isDrawByFiftyMoves()) return { result: "draw", termination: "fifty_moves" };
    return null;
  }

  /**
   * Хватает ли стороне материала, чтобы поставить мат (ARCHITECTURE §9.1 п.8). Не хватает: один король;
   * король и один конь; король и слоны только одного цвета полей. Остальное (пешка, ладья, ферзь,
   * два коня, конь и слон, разнопольные слоны) — хватает.
   */
  canMate(color: Color): boolean {
    const side = color === "white" ? "w" : "b";
    const pieces = this.#chess
      .board()
      .flat()
      .filter((p): p is NonNullable<typeof p> => p !== null && p.color === side && p.type !== "k");
    if (pieces.length === 0) return false;
    if (pieces.some((p) => p.type === "p" || p.type === "r" || p.type === "q")) return true;
    const knights = pieces.filter((p) => p.type === "n").length;
    const bishops = pieces.filter((p) => p.type === "b");
    if (knights === 1 && bishops.length === 0) return false;
    if (knights === 0) {
      const dark = bishops.filter((b) => isDarkSquare(b.square)).length;
      return dark !== 0 && dark !== bishops.length;
    }
    return true;
  }

  /** Итог флага стороны `flagged`: у соперника нет материала для мата — ничья, иначе его победа (GLOSSARY §8). */
  flagOutcome(flagged: Color): Outcome {
    const opponent = other(flagged);
    return this.canMate(opponent)
      ? { result: winOf(opponent), termination: "timeout" }
      : { result: "draw", termination: "timeout_insufficient_material" };
  }
}
