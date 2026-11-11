// Права соединения (API §8.1, sec-3): гость и П1 шлют только подписки и pong; остальное модулям не передаётся.

/** `type`, которые принимаются от любого соединения («все» в API §13). */
export const OPEN_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  "pong",
  "lobby.subscribe",
  "lobby.unsubscribe",
  "game.subscribe",
  "game.unsubscribe",
]);

export type Who = "guest" | "onboarding" | "player";

/** Отказ для сообщения type от соединения who; null — пропустить к обработчику. */
export function refusalFor(who: Who, type: string): "unauthenticated" | "onboarding_required" | null {
  if (who === "player" || OPEN_MESSAGE_TYPES.has(type)) return null;
  return who === "guest" ? "unauthenticated" : "onboarding_required";
}
