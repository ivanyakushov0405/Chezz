// Партия на экране (API §9.3, §10): подписка (и повтор после каждого welcome), сообщения → gameState, отправка хода.
import { useCallback, useEffect, useRef, useState } from "react";
import { useWs, useWsStatus } from "../../shared/api/WsContext.tsx";
import { useToast } from "../../shared/ui/Toast/Toast.tsx";
import { applyServerMessage, withoutPending, withPending, type GameScreenState } from "./gameState.ts";

export interface UseGame {
  state: GameScreenState;
  /** Соединение есть (welcome получен); иначе — `reconnecting`, ходы запрещены. */
  online: boolean;
  /** Отправить ход; false — нельзя (нет соединения, не готово, уже ждём ответ). */
  move: (uci: string) => boolean;
  /** Повторить подписку после ошибки загрузки. */
  retry: () => void;
}

export function useGame(gameId: string): UseGame {
  const ws = useWs();
  const status = useWsStatus();
  const toast = useToast();
  const [state, setState] = useState<GameScreenState>({ status: "loading" });
  const current = useRef(state);
  const seq = useRef(0);

  const commit = useCallback((next: GameScreenState) => {
    current.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    commit({ status: "loading" });
    const subscribe = (): void => void ws.send({ type: "game.subscribe", game_id: gameId });
    if (ws.status === "open") subscribe();
    const offWelcome = ws.onWelcome(subscribe);
    const offMessage = ws.onMessage((message) => {
      const applied = applyServerMessage(current.current, gameId, message, performance.now());
      if (applied.state !== current.current) commit(applied.state);
      if (applied.resubscribe) subscribe();
      if (applied.toast !== undefined) toast({ message: `error.${applied.toast}`, tone: "danger" });
    });
    return () => {
      offWelcome();
      offMessage();
      ws.send({ type: "game.unsubscribe", game_id: gameId });
    };
  }, [ws, gameId, commit, toast]);

  // Разрыв: неподтверждённый ход не повторяется (API §10), экран восстановится из game.state.
  const online = status === "open";
  useEffect(() => {
    if (!online) commit(withoutPending(current.current));
  }, [online, commit]);

  const move = useCallback(
    (uci: string): boolean => {
      const s = current.current;
      if (s.status !== "ready" || s.view.pending !== null || s.view.game.status !== "active") return false;
      const ref = `m${++seq.current}`;
      const ply = s.view.game.moves.length;
      if (!ws.send({ type: "game.move", ref, game_id: gameId, ply, uci })) return false;
      commit(withPending(s, { ref, ply, uci }));
      return true;
    },
    [ws, gameId, commit],
  );

  const retry = useCallback(() => {
    commit({ status: "loading" });
    ws.send({ type: "game.subscribe", game_id: gameId });
  }, [ws, gameId, commit]);

  return { state, online, move, retry };
}
