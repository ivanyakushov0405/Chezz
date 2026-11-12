// Состояние экрана партии из сообщений сервера (API §9.3, §5.2): чистые функции, без React и WebSocket.
// Сервер — источник истины: снимок `game.state` заменяет всё, `game.moved` дописывает ход, разрыв `ply` — повтор подписки.
import type { Clock, Color, Connected, ErrorCode, Game, ServerMessage } from "@chezz/protocol";
import { displayedMs } from "./clockDisplay.ts";

/** Ход отправлен, ответа ещё нет (DESIGN §10.3 `move-pending`): фигура стоит на новом поле. */
export interface PendingMove {
  ref: string;
  ply: number;
  uci: string;
}

export interface GameView {
  game: Game;
  clock: Clock;
  /** `performance.now()` получения `clock` (API §9.4). */
  clockAt: number;
  yourColor: Color | null;
  connected: Connected;
  pending: PendingMove | null;
}

export type GameScreenState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; code: ErrorCode }
  | { status: "ready"; view: GameView };

export interface Applied {
  state: GameScreenState;
  /** Разрыв `ply` — запросить снимок заново (`game.subscribe`). */
  resubscribe?: true;
  /** Отказ — `Toast` `error.<code>`. */
  toast?: ErrorCode;
}

const moverOf = (ply: number): Color => (ply % 2 === 1 ? "white" : "black");

/** Применить сообщение сервера к экрану партии `gameId`; чужие сообщения не меняют состояние. */
export function applyServerMessage(state: GameScreenState, gameId: string, message: ServerMessage, at: number): Applied {
  switch (message.type) {
    case "game.state": {
      if (message.game_id !== gameId) return { state };
      return {
        state: {
          status: "ready",
          view: {
            game: message.game,
            clock: message.clock,
            clockAt: at,
            yourColor: message.your_color,
            connected: message.connected,
            pending: null,
          },
        },
      };
    }
    case "game.moved": {
      if (message.game_id !== gameId || state.status !== "ready") return { state };
      const { view } = state;
      const have = view.game.moves.length;
      if (message.ply <= have) return { state };
      if (message.ply > have + 1) return { state, resubscribe: true };
      const mover = moverOf(message.ply);
      const move = { san: message.san, clock_ms: mover === "white" ? message.clock.white_ms : message.clock.black_ms };
      return {
        state: {
          status: "ready",
          view: { ...view, game: { ...view.game, moves: [...view.game.moves, move] }, clock: message.clock, clockAt: at, pending: null },
        },
      };
    }
    case "game.ended": {
      if (message.game_id !== gameId || state.status !== "ready") return { state };
      const { view } = state;
      // Часы останавливаются на показанном значении: в `game.ended` часов нет, флаг уже зафиксировал сервер.
      const clock: Clock = {
        white_ms: Math.round(displayedMs(view.clock, "white", view.clockAt, at, true)),
        black_ms: Math.round(displayedMs(view.clock, "black", view.clockAt, at, true)),
        running: null,
      };
      return {
        state: {
          status: "ready",
          view: {
            ...view,
            game: { ...view.game, status: message.status, result: message.result, termination: message.termination, ratings: message.ratings },
            clock,
            clockAt: at,
            pending: null,
          },
        },
      };
    }
    case "error": {
      // `rate_limited` шлюз отдаёт до разбора команды — без `ref` и `game_id` (API §8.1): ждущий ход тоже отклонён.
      const pending = state.status === "ready" ? state.view.pending : null;
      const mine = message.game_id === gameId || (pending !== null && (message.ref === pending.ref || message.code === "rate_limited"));
      if (!mine) return { state };
      if (state.status !== "ready") {
        return { state: message.code === "not_found" ? { status: "not-found" } : { status: "error", code: message.code } };
      }
      // Отказ хода: фигура возвращается (снимок, если он есть, придёт следом и заменит всё).
      return { state: { status: "ready", view: { ...state.view, pending: null } }, toast: message.code };
    }
    default:
      return { state };
  }
}

/** Ход отправлен: запомнить до ответа сервера. */
export function withPending(state: GameScreenState, pending: PendingMove): GameScreenState {
  return state.status === "ready" ? { status: "ready", view: { ...state.view, pending } } : state;
}

/** Соединение разорвано: неподтверждённый ход забывается и не повторяется (API §10). */
export function withoutPending(state: GameScreenState): GameScreenState {
  return state.status === "ready" && state.view.pending !== null ? { status: "ready", view: { ...state.view, pending: null } } : state;
}
