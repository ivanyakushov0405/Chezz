import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSnapshot } from "./snapshot.ts";

describe("снимок протокола", () => {
  it("AC-19, EC-17: JSON Schema схем совпадает с snapshot/protocol.json (обновить: npm run -w packages/protocol snapshot)", () => {
    const file = JSON.parse(readFileSync(new URL("./snapshot/protocol.json", import.meta.url), "utf8")) as unknown;
    expect(JSON.parse(JSON.stringify(buildSnapshot()))).toEqual(file);
  });
});
