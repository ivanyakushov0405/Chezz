// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { hexToRgb, loadTheme, resolve } from "./tokenValues.ts";

const DOC = fileURLToPath(new URL("../../../../../docs/DESIGN_SYSTEM.md", import.meta.url));

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function pairs(): { fg: string[]; bg: string[]; min: number }[] {
  const text = readFileSync(DOC, "utf8");
  const m = /<!-- contrast-pairs:start -->([\s\S]*?)<!-- contrast-pairs:end -->/.exec(text);
  if (!m) throw new Error("нет маркеров contrast-pairs");
  const tokens = (cell: string) => [...cell.matchAll(/`(--[\w-]+)`/g)].map((x) => x[1] as string);
  return (m[1] as string)
    .split("\n")
    .filter((l) => l.startsWith("|") && l.includes("`--"))
    .map((l) => {
      const cells = l.split("|").map((c) => c.trim());
      return { fg: tokens(cells[1] as string), bg: tokens(cells[2] as string), min: Number(cells[3]) };
    });
}

describe("AC-32: контраст пар DESIGN §5", () => {
  const rows = pairs();
  it("таблица пар прочитана", () => {
    expect(rows.length).toBeGreaterThan(0);
  });
  for (const theme of ["light", "dark"] as const) {
    it(`${theme}: все пары проходят порог`, () => {
      const values = loadTheme(theme);
      for (const row of rows)
        for (const fg of row.fg)
          for (const bg of row.bg) {
            const r = ratio(resolve(values, fg), resolve(values, bg));
            expect(r, `${theme}: ${fg} на ${bg} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(row.min);
          }
    });
  }
});
