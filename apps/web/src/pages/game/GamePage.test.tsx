// Экран партии (DESIGN §9.3, §10.3): сообщения сервера через FakeWsClient, ход — через поле «Ход» и доску.
import { DEFAULT_USER_SETTINGS, type GameMoved } from "@chezz/protocol";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { BLACK_ID, GAME_ID, makeState, WHITE_ID } from "../../test/games.ts";
import { click, key, makeMe, mountApp, waitFor } from "../../test/render.tsx";
import { FakeWsClient } from "../../test/ws.ts";

const PATH = `/game/${GAME_ID}`;
const screen = (root: HTMLElement): HTMLElement | null => root.querySelector("[data-screen]");
const states = (root: HTMLElement): string[] => (screen(root)?.dataset["state"] ?? "").split(" ");
const input = (root: HTMLElement): HTMLInputElement | null => root.querySelector("[data-move-input]");

async function open(opts: { me?: "white" | "black" | "guest"; autoQueen?: boolean } = {}) {
  const ws = new FakeWsClient();
  const who = opts.me ?? "white";
  const initial =
    who === "guest"
      ? ({ status: "guest" } as const)
      : ({
          status: "ready",
          me: makeMe({ id: who === "white" ? WHITE_ID : BLACK_ID, settings: { ...DEFAULT_USER_SETTINGS, auto_queen: opts.autoQueen ?? true } }),
        } as const);
  const root = await mountApp(PATH, initial, ws);
  await waitFor(() => expect(ws.sent).toContainEqual({ type: "game.subscribe", game_id: GAME_ID }));
  return { ws, root };
}

async function typeMove(root: HTMLElement, text: string): Promise<void> {
  const el = input(root);
  if (el === null) throw new Error("нет поля «Ход»");
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await key(el, "Enter");
}

const moved = (ply: number, san: string, running: "white" | "black" | null = ply % 2 === 1 ? "black" : "white"): GameMoved => ({
  type: "game.moved",
  game_id: GAME_ID,
  ply,
  san,
  clock: { white_ms: 178_000, black_ms: 180_000, running },
  draw_offer: null,
  takeback_offer: null,
});

describe("GamePage: game-live", () => {
  it("К-9: участник — подписка, доска, обе PlayerLine с часами, своя сторона снизу", async () => {
    const { ws, root } = await open({ me: "black" });
    await ws.emit(makeState({ your_color: "black" }));
    expect(screen(root)?.dataset["screen"]).toBe("game-live");
    expect(states(root)).toEqual(["default"]);
    expect(root.querySelector("[data-player-line='bottom']")?.textContent).toContain("bob");
    expect(root.querySelector("[data-player-line='top']")?.textContent).toContain("alice");
    expect(root.querySelector("[data-player-line='top']")?.textContent).toContain("1500?");
    expect(root.querySelectorAll("[role='timer']")).toHaveLength(2);
    expect(root.querySelector(".cg-wrap")?.classList.contains("orientation-black")).toBe(true);
    expect(input(root)).not.toBeNull();
  });

  it("К-9: ход вводом SAN — game.move с ply и UCI, move-pending до ответа; game.moved — ход в списке", async () => {
    const { ws, root } = await open();
    await ws.emit(makeState());
    await typeMove(root, "e4");
    expect(ws.sent.at(-1)).toEqual({ type: "game.move", ref: "m1", game_id: GAME_ID, ply: 0, uci: "e2e4" });
    expect(states(root)).toContain("move-pending");
    await ws.emit(moved(1, "e4"));
    expect(states(root)).toEqual(["default"]);
    expect(root.querySelector("[data-move-list]")?.textContent).toContain("e4");
  });

  it("К-9: ход UCI тоже принимается; несуществующий — ошибка под полем, команды нет", async () => {
    const { ws, root } = await open();
    await ws.emit(makeState());
    await typeMove(root, "Nf6");
    expect(root.textContent).toContain("Нет такого хода");
    expect(ws.sent.filter((m) => m.type === "game.move")).toEqual([]);
    await typeMove(root, "g1f3");
    expect(ws.sent.at(-1)).toMatchObject({ type: "game.move", uci: "g1f3" });
  });

  it("К-9: отказ со снимком — фигура возвращается и Toast error.<code>", async () => {
    const { ws, root } = await open();
    await ws.emit(makeState());
    await typeMove(root, "e4");
    await ws.emit({ type: "error", ref: "m1", code: "not_your_turn", game_id: GAME_ID, details: null });
    await ws.emit(makeState());
    expect(states(root)).toEqual(["default"]);
    expect(root.querySelector("[data-move-list]")?.textContent).not.toContain("e4");
    expect(document.querySelector("[data-tone='danger']")?.textContent).toBe("Сейчас не ваш ход");
  });

  it("К-9: разрыв ply — повторная подписка за снимком", async () => {
    const { ws } = await open();
    await ws.emit(makeState());
    const before = ws.sent.filter((m) => m.type === "game.subscribe").length;
    await ws.emit(moved(3, "Nf3"));
    expect(ws.sent.filter((m) => m.type === "game.subscribe")).toHaveLength(before + 1);
  });

  it("К-9: превращение без auto_queen — PromotionPicker, выбранная фигура в UCI", async () => {
    const { ws, root } = await open({ autoQueen: false });
    const sans = ["e4", "d5", "exd5", "c6", "dxc6", "Nf6", "cxb7", "Nc6"];
    await ws.emit(makeState({ game: { moves: sans.map((san) => ({ san, clock_ms: 180_000 })) } }));
    await typeMove(root, "b7a8");
    expect(states(root)).toContain("promotion");
    await click(root.querySelector("[data-piece='n']"));
    expect(ws.sent.at(-1)).toMatchObject({ type: "game.move", ply: 8, uci: "b7a8n" });
  });

  it("К-9: auto_queen — ферзь сразу, без выбора", async () => {
    const { ws, root } = await open({ autoQueen: true });
    const sans = ["e4", "d5", "exd5", "c6", "dxc6", "Nf6", "cxb7", "Nc6"];
    await ws.emit(makeState({ game: { moves: sans.map((san) => ({ san, clock_ms: 180_000 })) } }));
    await typeMove(root, "b7a8");
    expect(root.querySelector("[data-promotion-picker]")).toBeNull();
    expect(ws.sent.at(-1)).toMatchObject({ uci: "b7a8q" });
  });

  it("К-9: свои часы ниже порога U11 — low-time; чужие — нет", async () => {
    const { ws, root } = await open();
    await ws.emit(makeState({ game: { moves: [{ san: "e4", clock_ms: 5_000 }, { san: "e5", clock_ms: 5_000 }] }, clock: { white_ms: 5_000, black_ms: 180_000, running: "white" } }));
    expect(states(root)).toContain("low-time");
    expect(root.querySelector("[data-side='white'] [data-clock-low]")).not.toBeNull();
    expect(root.querySelector("[data-side='black'] [data-clock-low]")).toBeNull();
  });

  it("К-9: ←/→ — просмотр истории, «К текущему» возвращает; во время просмотра ход нельзя", async () => {
    const { ws, root } = await open();
    await ws.emit(makeState({ game: { moves: ["e4", "e5"].map((san) => ({ san, clock_ms: 180_000 })) } }));
    await key(document.body, "ArrowLeft");
    expect(root.querySelector("[aria-current='true']")?.textContent).toBe("e4");
    await typeMove(root, "Nf3");
    expect(ws.sent.filter((m) => m.type === "game.move")).toEqual([]);
    await click(root.querySelector("[data-to-current]"));
    expect(root.querySelector("[aria-current='true']")?.textContent).toBe("e5");
    expect(root.querySelector("[data-to-current]")).toBeNull();
  });

  it("К-9: game.ended — GameResultPanel: результат · окончание, изменение рейтинга, «Новая игра» → /", async () => {
    const { ws, root } = await open();
    await ws.emit(makeState({ clock: { white_ms: 100_000, black_ms: 90_000, running: "black" } }));
    await ws.emit({
      type: "game.ended",
      game_id: GAME_ID,
      status: "finished",
      result: "white_wins",
      termination: "checkmate",
      ratings: { white: { rating_before: 1500, rating_after: 1512 }, black: { rating_before: 1620, rating_after: 1611 } },
    });
    expect(states(root)).toContain("ended");
    const panel = root.querySelector("[data-game-result]");
    expect(panel?.querySelector("h2")?.textContent).toBe("Победа белых · мат");
    expect(panel?.querySelector("[data-rating-side='white']")?.textContent).toContain("+12");
    expect(panel?.querySelector("[data-rating-side='black']")?.textContent).toContain("−9");
    expect(panel?.querySelector("a")?.getAttribute("href")).toBe("/");
    expect(input(root)).toBeNull();
  });

  it("К-10: переподключение — reconnecting, доска закрыта, ввод хода заблокирован; game.state после welcome снимает", async () => {
    const { ws, root } = await open();
    await ws.emit(makeState());
    await ws.setStatus("reconnecting");
    expect(states(root)).toContain("reconnecting");
    expect(root.querySelector("[data-board-locked]")).not.toBeNull();
    expect(input(root)?.disabled).toBe(true);
    const subs = ws.sent.filter((m) => m.type === "game.subscribe").length;
    await ws.setStatus("open");
    expect(ws.sent.filter((m) => m.type === "game.subscribe")).toHaveLength(subs + 1);
    await ws.emit(makeState());
    expect(states(root)).toEqual(["default"]);
  });

  it("К-10: неподтверждённый ход при разрыве не повторяется", async () => {
    const { ws, root } = await open();
    await ws.emit(makeState());
    await typeMove(root, "e4");
    await ws.setStatus("reconnecting");
    await ws.setStatus("open");
    expect(ws.sent.filter((m) => m.type === "game.move")).toHaveLength(1);
    expect(states(root)).not.toContain("move-pending");
  });
});

describe("GamePage: зритель и ошибки", () => {
  it("К-9: зритель — game-spectator, «Вы зритель», без ввода хода, доску можно перевернуть", async () => {
    const { ws, root } = await open({ me: "guest" });
    await ws.emit(makeState({ your_color: null }));
    expect(screen(root)?.dataset["screen"]).toBe("game-spectator");
    expect(root.querySelector("[data-spectator]")?.textContent).toBe("Вы зритель");
    expect(input(root)).toBeNull();
    expect(root.querySelector(".cg-wrap")?.classList.contains("orientation-white")).toBe(true);
    await click([...root.querySelectorAll("button")].find((b) => b.textContent === "Перевернуть доску") ?? null);
    expect(root.querySelector(".cg-wrap")?.classList.contains("orientation-black")).toBe(true);
  });

  it("К-9: нет партии — not-found", async () => {
    const { ws, root } = await open();
    await ws.emit({ type: "error", ref: null, code: "not_found", game_id: GAME_ID, details: null });
    expect(states(root)).toEqual(["not-found"]);
    expect(root.textContent).toContain("Партия не найдена");
  });

  it("К-9: /game/<не UUID> — экран not-found приложения, подписки нет", async () => {
    const ws = new FakeWsClient();
    const root = await mountApp("/game/abc", { status: "guest" }, ws);
    expect(root.querySelector("[data-screen='game-live']")).toBeNull();
    expect(ws.sent).toEqual([]);
  });

  it("К-9: уход со страницы — game.unsubscribe", async () => {
    const { ws, root } = await open();
    await ws.emit(makeState());
    await click(root.querySelector("a[href='/terms']"));
    expect(ws.sent).toContainEqual({ type: "game.unsubscribe", game_id: GAME_ID });
  });
});
