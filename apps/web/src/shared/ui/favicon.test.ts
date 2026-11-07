// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadTheme, resolve } from "./tokenValues.ts";

const SVG = readFileSync(fileURLToPath(new URL("../../../public/favicon.svg", import.meta.url)), "utf8");

describe("favicon.svg (U42)", () => {
  it("цвета = --color-accent светлой и тёмной тем", () => {
    const light = resolve(loadTheme("light"), "--color-accent").toLowerCase();
    const dark = resolve(loadTheme("dark"), "--color-accent").toLowerCase();
    const style = /<style>([\s\S]*?)<\/style>/.exec(SVG)?.[1] ?? "";
    const [base, media] = style.split("@media");
    expect((base ?? "").toLowerCase()).toContain(light);
    expect((media ?? "").toLowerCase()).toContain("prefers-color-scheme:dark");
    expect((media ?? "").toLowerCase()).toContain(dark);
  });

  it("viewBox 32 и один path", () => {
    expect(SVG).toContain('viewBox="0 0 32 32"');
    expect(SVG.match(/<path\b/g)).toHaveLength(1);
  });
});
