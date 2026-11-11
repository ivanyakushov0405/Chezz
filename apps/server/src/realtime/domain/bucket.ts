// Token bucket сообщений WebSocket на соединение (SECURITY §9, ARCHITECTURE A21). Чистая функция: время — параметром.

export interface BucketConfig {
  /** Пополнение, токенов в секунду. */
  rate_per_s: number;
  /** Запас (ёмкость корзины). */
  burst: number;
  /** Корзина пуста дольше этого — соединение закрывается (1008, API §10). */
  close_after_empty_ms: number;
}

/** SECURITY §9: 10/с, запас 20; пуста дольше 10 с — закрытие. */
export const WS_MESSAGE_BUCKET: BucketConfig = Object.freeze({ rate_per_s: 10, burst: 20, close_after_empty_ms: 10_000 });

export interface BucketState {
  tokens: number;
  /** Монотонное время последнего пересчёта, мс. */
  updated_ms: number;
  /**
   * С какого момента клиент упирается в лимит: первый отказ. Сбрасывается, только когда сообщение
   * принято с запасом (до него в корзине ≥ 2 токенов) — иначе бот на 50/с, получающий токен раз в 100 мс,
   * не закрылся бы никогда (SECURITY §9, пример).
   */
  empty_since_ms: number | null;
}

export type BucketVerdict = "ok" | "rejected" | "close";

export function fullBucket(config: BucketConfig, now_ms: number): BucketState {
  return { tokens: config.burst, updated_ms: now_ms, empty_since_ms: null };
}

/** Сообщение пришло в now_ms: забрать токен или отказать; отказ позже close_after_empty_ms от первого — «close». */
export function takeToken(config: BucketConfig, state: BucketState, now_ms: number): { state: BucketState; verdict: BucketVerdict } {
  const elapsed = Math.max(0, now_ms - state.updated_ms);
  const tokens = Math.min(config.burst, state.tokens + (elapsed * config.rate_per_s) / 1000);
  if (tokens >= 1) {
    const emptySince = tokens >= 2 ? null : state.empty_since_ms;
    return { state: { tokens: tokens - 1, updated_ms: now_ms, empty_since_ms: emptySince }, verdict: "ok" };
  }
  const emptySince = state.empty_since_ms ?? now_ms;
  const verdict: BucketVerdict = now_ms - emptySince > config.close_after_empty_ms ? "close" : "rejected";
  return { state: { tokens, updated_ms: now_ms, empty_since_ms: emptySince }, verdict };
}
