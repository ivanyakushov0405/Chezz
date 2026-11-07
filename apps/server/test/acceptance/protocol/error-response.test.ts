// Acceptance: схема `ErrorResponse` из `@chezz/protocol` (API §5.1; design.md E03, «`@chezz/protocol` (T-1)»).
// AC-32: `error.request_id` — `z.uuid()`. Снимок `snapshot/protocol.json` проверяет snapshot.test.ts разработчика.
import { ErrorResponse } from "@chezz/protocol";
import { describe, expect, it } from "vitest";

const REQUEST_ID = "5b0c1d2e-3f4a-4b5c-8d6e-7f8091a2b3c4";

function body(request_id: unknown): unknown {
  return { error: { code: "internal", message: "Internal error", details: null, request_id } };
}

describe("ErrorResponse.error.request_id (AC-32)", () => {
  it("AC-32: request_id = UUID → ответ проходит схему", () => {
    expect(ErrorResponse.safeParse(body(REQUEST_ID)).success).toBe(true);
  });

  it("AC-32: request_id = \"x\" → ответ не проходит схему", () => {
    expect(ErrorResponse.safeParse(body("x")).success).toBe(false);
  });

  it("AC-32: request_id = пустая строка → ответ не проходит схему", () => {
    expect(ErrorResponse.safeParse(body("")).success).toBe(false);
  });

  it("AC-32: request_id = UUID с лишним хвостом → ответ не проходит схему", () => {
    expect(ErrorResponse.safeParse(body(`${REQUEST_ID}0`)).success).toBe(false);
  });
});
