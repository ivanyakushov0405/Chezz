import { describe, expect, it } from "vitest";
import { maskChallengeIds } from "./mask.ts";

const ID = "3f2c9a1e-5b7d-4c8e-9f01-2a3b4c5d6e7f";

describe("maskChallengeIds", () => {
  it("AC-21: страница вызова", () => {
    expect(maskChallengeIds(`/challenge/${ID}`)).toBe("/challenge/:id");
  });

  it("AC-21: маршрут API с продолжением", () => {
    expect(maskChallengeIds(`/api/challenges/${ID}/accept`)).toBe("/api/challenges/:id/accept");
  });

  it("EC-13: без id и уже маскированный путь не меняются", () => {
    expect(maskChallengeIds("/api/challenges")).toBe("/api/challenges");
    expect(maskChallengeIds("/api/challenges?x=1")).toBe("/api/challenges?x=1");
    expect(maskChallengeIds("/challenge/:id")).toBe("/challenge/:id");
    expect(maskChallengeIds(maskChallengeIds(`/challenge/${ID}`))).toBe("/challenge/:id");
  });

  it("EC-13: два id в одной строке", () => {
    expect(maskChallengeIds(`GET /challenge/${ID} then /api/challenges/${ID}/cancel`)).toBe(
      "GET /challenge/:id then /api/challenges/:id/cancel",
    );
  });

  it("EC-13: полный URL со строкой запроса и #", () => {
    expect(maskChallengeIds(`https://chezz.example/challenge/${ID}?a=1#top`)).toBe("https://chezz.example/challenge/:id?a=1#top");
    expect(maskChallengeIds(`https://h/api/challenges/${ID}#x`)).toBe("https://h/api/challenges/:id#x");
  });

  it("EC-13: /game/<id> не меняется", () => {
    expect(maskChallengeIds(`/game/${ID}`)).toBe(`/game/${ID}`);
  });

  it("id в тексте ошибки и в кавычках", () => {
    expect(maskChallengeIds(`failed "/challenge/${ID}" (retry)`)).toBe('failed "/challenge/:id" (retry)');
  });
});
