import { describe, expect, it } from "vitest";
import { initialPingState, medianRtt, nextPing, receivePong, type PingState } from "./ping.ts";

function sent(state: PingState, now: number): { state: PingState; n: number } {
  const r = nextPing(state, now);
  if (r.action === "dead") throw new Error("dead");
  return { state: r.state, n: r.action.send };
}

describe("ping/pong и RTT", () => {
  it("К-8: n растёт с 0 на каждом ping", () => {
    let s = initialPingState();
    const ns: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = sent(s, i * 5_000);
      s = receivePong(r.state, r.n, i * 5_000 + 10);
      ns.push(r.n);
    }
    expect(ns).toEqual([0, 1, 2]);
  });

  it("К-8: RTT — разница монотонного времени pong и ping; медиана 5 последних", () => {
    let s = initialPingState();
    const rtts = [100, 40, 300, 60, 80, 20];
    rtts.forEach((rtt, i) => {
      const r = sent(s, i * 5_000);
      s = receivePong(r.state, r.n, i * 5_000 + rtt);
    });
    expect(s.samples).toEqual([40, 300, 60, 80, 20]);
    expect(medianRtt(s.samples)).toBe(60);
  });

  it("К-8: pong с чужим n игнорируется", () => {
    const r = sent(initialPingState(), 0);
    expect(receivePong(r.state, 7, 50)).toBe(r.state);
    expect(receivePong(r.state, -1, 50)).toBe(r.state);
  });

  it("К-8: повтор pong с тем же n — второго измерения нет", () => {
    const r = sent(initialPingState(), 0);
    const once = receivePong(r.state, r.n, 30);
    expect(receivePong(once, r.n, 90).samples).toEqual([30]);
  });

  it("К-8: 3 ping без pong — четвёртый тик «dead»", () => {
    let s = initialPingState();
    for (let i = 0; i < 3; i++) s = sent(s, i * 5_000).state;
    expect(nextPing(s, 15_000).action).toBe("dead");
  });

  it("К-8: pong на поздний ping снимает и более ранние без ответа", () => {
    let s = initialPingState();
    for (let i = 0; i < 3; i++) s = sent(s, i * 5_000).state;
    s = receivePong(s, 2, 10_050);
    expect(s.outstanding.size).toBe(0);
    expect(nextPing(s, 15_000).action).toEqual({ send: 3 });
  });

  it("К-8: медиана — нет измерений null, чётное число — среднее двух", () => {
    expect(medianRtt([])).toBeNull();
    expect(medianRtt([10, 30])).toBe(20);
  });
});
