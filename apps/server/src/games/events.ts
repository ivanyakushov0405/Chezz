// События games (ARCHITECTURE §7.3, ADR-0005 п.3; форма — API §11): game_started, game_ended.
// Подписчики — matchmaking (E10), realtime (game.started, E08); синхронный вызов после коммита.

export interface GameStartedEvent {
  game_id: string;
  white_id: string;
  black_id: string;
}

export interface GameEndedEvent {
  game_id: string;
  white_id: string;
  black_id: string;
}

export interface GamesEvents {
  onGameStarted(fn: (event: GameStartedEvent) => void): void;
  onGameEnded(fn: (event: GameEndedEvent) => void): void;
  emitGameStarted(event: GameStartedEvent): void;
  emitGameEnded(event: GameEndedEvent): void;
}

/** Ошибка подписчика не ломает партию и других подписчиков: её получает `onError`. */
export function createGamesEvents(onError: (err: unknown) => void): GamesEvents {
  const started: ((e: GameStartedEvent) => void)[] = [];
  const ended: ((e: GameEndedEvent) => void)[] = [];
  const emit = <E>(list: ((e: E) => void)[], event: E): void => {
    for (const fn of list) {
      try {
        fn(event);
      } catch (err) {
        onError(err);
      }
    }
  };
  return {
    onGameStarted: (fn) => void started.push(fn),
    onGameEnded: (fn) => void ended.push(fn),
    emitGameStarted: (event) => emit(started, event),
    emitGameEnded: (event) => emit(ended, event),
  };
}
