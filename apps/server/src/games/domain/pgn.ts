// PGN законченной партии (ARCHITECTURE §9.1 п.7, §9.4): собирается один раз в конце; без ников —
// теги White/Black подставляются при выдаче (SECURITY S13, E12).
import type { GameResultValue, TerminationValue } from "../tables.ts";

const RESULT_TAG: Record<GameResultValue | "aborted", string> = {
  white_wins: "1-0",
  black_wins: "0-1",
  draw: "1/2-1/2",
  aborted: "*",
};

export interface PgnInput {
  started_at: Date;
  time_base: number;
  time_increment: number;
  result: GameResultValue | null;
  termination: TerminationValue;
  sans: readonly string[];
}

/** `YYYY.MM.DD` по UTC. */
const pgnDate = (d: Date): string => d.toISOString().slice(0, 10).replace(/-/g, ".");

export function buildPgn(input: PgnInput): string {
  const result = RESULT_TAG[input.result ?? "aborted"];
  const tags = [
    ["Event", "Chezz"],
    ["Site", "Chezz"],
    ["Date", pgnDate(input.started_at)],
    ["Result", result],
    ["TimeControl", `${input.time_base}+${input.time_increment}`],
    ["Termination", input.termination],
  ];
  const moves: string[] = [];
  input.sans.forEach((san, i) => {
    moves.push(i % 2 === 0 ? `${i / 2 + 1}. ${san}` : san);
  });
  moves.push(result);
  return `${tags.map(([k, v]) => `[${k} "${v}"]`).join("\n")}\n\n${moves.join(" ")}\n`;
}
