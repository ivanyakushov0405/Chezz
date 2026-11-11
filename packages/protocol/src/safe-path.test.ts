import { describe, expect, it } from "vitest";
import { safeLocalPath } from "./index.ts";

const ORIGIN = "https://chezz.test";
const HOME = `${ORIGIN}/`;

describe("safeLocalPath (SECURITY §4, S30)", () => {
  it("К-1: /challenge/3f9c… разрешён — абсолютный href своего origin", () => {
    expect(safeLocalPath("/challenge/3f9c", ORIGIN)).toBe(`${ORIGIN}/challenge/3f9c`);
    expect(safeLocalPath("/challenge/3f9c1e2d-4b5a-4c6d-8e7f-90a1b2c3d4e5", ORIGIN)).toBe(
      `${ORIGIN}/challenge/3f9c1e2d-4b5a-4c6d-8e7f-90a1b2c3d4e5`,
    );
  });

  it("К-1: свои пути с query и fragment сохраняются", () => {
    expect(safeLocalPath("/", ORIGIN)).toBe(HOME);
    expect(safeLocalPath("/player/knight_rider-7/games", ORIGIN)).toBe(`${ORIGIN}/player/knight_rider-7/games`);
    expect(safeLocalPath("/leaderboard/blitz?x=1#top", ORIGIN)).toBe(`${ORIGIN}/leaderboard/blitz?x=1#top`);
  });

  it("К-1: //evil.example → /", () => {
    expect(safeLocalPath("//evil.example", ORIGIN)).toBe(HOME);
    expect(safeLocalPath("//evil.example/challenge/3f9c", ORIGIN)).toBe(HOME);
  });

  it("К-1: /%09/evil.example → /", () => {
    expect(safeLocalPath("/%09/evil.example", ORIGIN)).toBe(HOME);
  });

  it("К-1: /\\evil.example → /", () => {
    expect(safeLocalPath("/\\evil.example", ORIGIN)).toBe(HOME);
    expect(safeLocalPath("/challenge\\3f9c", ORIGIN)).toBe(HOME);
  });

  it("К-1: /.//evil.example → /", () => {
    expect(safeLocalPath("/.//evil.example", ORIGIN)).toBe(HOME);
  });

  it("К-1: https://evil.example и другие абсолютные адреса → /", () => {
    for (const s of ["https://evil.example", "http://evil.example/x", "javascript:alert(1)", `${ORIGIN}/challenge/3f9c`]) {
      expect(safeLocalPath(s, ORIGIN), s).toBe(HOME);
    }
  });

  it("К-1: строка не с / → /", () => {
    for (const s of ["challenge/3f9c", "evil.example", " /challenge/3f9c", "?x=1", "#top"]) {
      expect(safeLocalPath(s, ORIGIN), JSON.stringify(s)).toBe(HOME);
    }
  });

  it("К-1: управляющие символы (< 0x20) → /", () => {
    for (const code of [0x00, 0x09, 0x0a, 0x0d, 0x1f]) {
      const s = `/${String.fromCharCode(code)}/evil.example`;
      expect(safeLocalPath(s, ORIGIN), `0x${code.toString(16)}`).toBe(HOME);
      expect(safeLocalPath(`/challenge/3f9c${String.fromCharCode(code)}`, ORIGIN), `tail 0x${code.toString(16)}`).toBe(HOME);
    }
  });

  it("К-1: символ 0x7F → /", () => {
    expect(safeLocalPath("/\u007f/evil.example", ORIGIN)).toBe(HOME);
    expect(safeLocalPath("/challenge/3f9c\u007f", ORIGIN)).toBe(HOME);
  });

  it("К-1: пусто, null, undefined → /", () => {
    expect(safeLocalPath("", ORIGIN)).toBe(HOME);
    expect(safeLocalPath(null, ORIGIN)).toBe(HOME);
    expect(safeLocalPath(undefined, ORIGIN)).toBe(HOME);
  });

  it("К-1: результат всегда своего origin", () => {
    const inputs = ["/challenge/3f9c", "//evil.example", "/%09/evil.example", "/\\evil.example", "/.//evil.example", "https://evil.example"];
    for (const s of inputs) expect(new URL(safeLocalPath(s, ORIGIN)).origin, s).toBe(ORIGIN);
  });
});
