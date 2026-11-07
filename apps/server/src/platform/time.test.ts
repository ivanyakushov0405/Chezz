import { describe, expect, it } from "vitest";
import { ManualTimeSource } from "../../test/support/time.ts";

describe("ManualTimeSource", () => {
  it("AC-11 EC-4: advance срабатывает только таймеры внутри сдвига, по возрастанию дедлайна; отменённый и дальний — нет", async () => {
    const wall = new Date("2026-03-01T12:00:00.000Z");
    const time = new ManualTimeSource({ now: 1000, wall });
    const fired: string[] = [];

    time.setTimer(300, () => fired.push(`b@${time.now()}`));
    time.setTimer(100, () => fired.push(`a@${time.now()}`));
    const cancelled = time.setTimer(200, () => fired.push("cancelled"));
    time.setTimer(600, () => fired.push("far"));
    time.clearTimer(cancelled);

    await time.advance(500);

    expect(fired).toEqual(["a@1100", "b@1300"]);
    expect(time.now()).toBe(1500);
    expect(time.wallNow().getTime()).toBe(wall.getTime() + 500);
    expect(time.pendingTimers()).toBe(1);

    await time.advance(100);
    expect(fired).toEqual(["a@1100", "b@1300", "far"]);
  });

  it("AC-11 EC-4: таймер, поставленный обработчиком внутри окна, срабатывает в том же advance", async () => {
    const time = new ManualTimeSource();
    const fired: number[] = [];
    time.setTimer(100, () => {
      fired.push(time.now());
      time.setTimer(50, () => fired.push(time.now()));
      time.setTimer(500, () => fired.push(-1));
    });

    await time.advance(200);

    expect(fired).toEqual([100, 150]);
    expect(time.now()).toBe(200);
  });

  it("AC-11 EC-4: равные дедлайны — в порядке постановки; advance(0) срабатывает таймер с нулевой задержкой", async () => {
    const time = new ManualTimeSource();
    const fired: string[] = [];
    time.setTimer(0, () => fired.push("first"));
    time.setTimer(0, () => fired.push("second"));

    await time.advance(0);

    expect(fired).toEqual(["first", "second"]);
    expect(time.now()).toBe(0);
  });

  it("AC-11: отрицательный сдвиг — ошибка", async () => {
    await expect(new ManualTimeSource().advance(-1)).rejects.toThrow(RangeError);
  });
});
