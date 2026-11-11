import { describe, expect, it } from "vitest";
import { fullBucket, takeToken, WS_MESSAGE_BUCKET as C, type BucketState } from "./bucket.ts";

function burst(state: BucketState, count: number, now: number): { state: BucketState; verdicts: string[] } {
  const verdicts: string[] = [];
  let s = state;
  for (let i = 0; i < count; i++) {
    const r = takeToken(C, s, now);
    s = r.state;
    verdicts.push(r.verdict);
  }
  return { state: s, verdicts };
}

describe("token bucket", () => {
  it("К-7: пачка из 21 сообщения в один момент — 20 приняты, 21-е отклонено", () => {
    const { verdicts } = burst(fullBucket(C, 0), 21, 0);
    expect(verdicts.filter((v) => v === "ok")).toHaveLength(20);
    expect(verdicts[20]).toBe("rejected");
  });

  it("К-7: пополнение 10/с — через 100 мс после опустошения один токен", () => {
    const empty = burst(fullBucket(C, 0), 20, 0).state;
    expect(takeToken(C, empty, 99).verdict).toBe("rejected");
    expect(takeToken(C, empty, 100).verdict).toBe("ok");
  });

  it("К-7: запас не растёт выше 20 за долгий простой", () => {
    const empty = burst(fullBucket(C, 0), 20, 0).state;
    const { verdicts } = burst(empty, 21, 60_000);
    expect(verdicts.filter((v) => v === "ok")).toHaveLength(20);
  });

  it("К-7: бот 50/с — после 20 сообщений отказы, закрытие на первом отказе позже 10 с", () => {
    let s = fullBucket(C, 0);
    let firstReject: number | null = null;
    let closedAt: number | null = null;
    for (let t = 0; t <= 20_000 && closedAt === null; t += 20) {
      const r = takeToken(C, s, t);
      s = r.state;
      if (r.verdict === "rejected" && firstReject === null) firstReject = t;
      if (r.verdict === "close") closedAt = t;
    }
    expect(firstReject).not.toBeNull();
    expect(closedAt).not.toBeNull();
    expect(closedAt! - firstReject!).toBeGreaterThan(10_000);
    expect(closedAt! - firstReject!).toBeLessThanOrEqual(10_100);
  });

  it("К-7: ровно 10 с от первого отказа — ещё rejected", () => {
    const s = takeToken(C, { tokens: 0, updated_ms: 0, empty_since_ms: null }, 0).state;
    expect(takeToken(C, { ...s, updated_ms: 10_000 }, 10_000).verdict).toBe("rejected");
    expect(takeToken(C, { ...s, updated_ms: 10_001 }, 10_001).verdict).toBe("close");
  });

  it("К-7: пауза после пачки — отсчёт сброшен, следующая пачка снова получает 10 с", () => {
    let s = burst(fullBucket(C, 0), 21, 0).state;
    expect(s.empty_since_ms).toBe(0);
    s = takeToken(C, s, 500).state; // 5 токенов накопилось — сообщение принято с запасом
    expect(s.empty_since_ms).toBeNull();
  });

  it("К-7: время назад не добавляет токенов", () => {
    const empty = burst(fullBucket(C, 1_000), 20, 1_000).state;
    expect(takeToken(C, empty, 0).verdict).toBe("rejected");
  });
});
