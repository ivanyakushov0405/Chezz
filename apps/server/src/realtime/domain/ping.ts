// ping/pong и RTT соединения (ARCHITECTURE A11; API §9.4). Чистые функции: время — параметром.

/** Интервал ping, мс (API §8.1 `ping_interval_ms`, §9.4). */
export const PING_INTERVAL_MS = 5_000;
/** Столько ping без pong — соединение мёртвое (15 с, API §9.4). */
export const MAX_UNANSWERED_PINGS = 3;
/** RTT — медиана стольких последних измерений (A11). */
export const RTT_SAMPLES = 5;

export interface PingState {
  /** n следующего ping. */
  next_n: number;
  /** Отправленные без ответа: n → монотонное время отправки, мс. */
  outstanding: ReadonlyMap<number, number>;
  /** Последние измерения RTT, мс (не больше RTT_SAMPLES), от старых к новым. */
  samples: readonly number[];
}

export function initialPingState(): PingState {
  return { next_n: 0, outstanding: new Map(), samples: [] };
}

/** Тик ping: «dead» — уже MAX_UNANSWERED_PINGS без ответа; иначе — n для отправки. */
export function nextPing(state: PingState, now_ms: number): { state: PingState; action: { send: number } | "dead" } {
  if (state.outstanding.size >= MAX_UNANSWERED_PINGS) return { state, action: "dead" };
  const n = state.next_n;
  const outstanding = new Map(state.outstanding);
  outstanding.set(n, now_ms);
  return { state: { ...state, next_n: n + 1, outstanding }, action: { send: n } };
}

/** pong с n: измерение RTT; ping старше n считаются потерянными. Чужой n — состояние без изменений. */
export function receivePong(state: PingState, n: number, now_ms: number): PingState {
  const sent = state.outstanding.get(n);
  if (sent === undefined) return state;
  const outstanding = new Map([...state.outstanding].filter(([k]) => k > n));
  const samples = [...state.samples, Math.max(0, now_ms - sent)].slice(-RTT_SAMPLES);
  return { ...state, outstanding, samples };
}

/** Медиана измерений; нет измерений — null (компенсация тогда 0, A11). */
export function medianRtt(samples: readonly number[]): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
