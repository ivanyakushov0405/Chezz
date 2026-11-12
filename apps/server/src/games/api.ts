// WebSocket-команды партии (ADR-0005 п.8; API §8.3, §9.1): game.subscribe, game.unsubscribe, game.move.
// Схема и права соединения проверены в realtime (API §8.1); участник и порядок проверок — в GameRoom/service.
import type { GameMove, GameSubscribe, GameUnsubscribe } from "@chezz/protocol";
import type { WsHandlers } from "../platform/ws.ts";
import type { GamesService } from "./service.ts";

export function gamesWsHandlers(games: GamesService): WsHandlers {
  return {
    "game.subscribe": async (ctx, message) => {
      const m = message as GameSubscribe;
      await games.subscribe(ctx, m.ref ?? null, m.game_id);
    },
    "game.unsubscribe": async (ctx, message) => {
      const m = message as GameUnsubscribe;
      games.unsubscribe(ctx, m.game_id);
    },
    // Время хода — момент прихода кадра (realtime), а не очереди соединения (A11, бриф «Решения»).
    "game.move": async (ctx, message, receivedAt) => {
      const m = message as GameMove;
      await games.move(ctx, m.ref ?? null, m.game_id, m.ply, m.uci, receivedAt);
    },
  };
}
