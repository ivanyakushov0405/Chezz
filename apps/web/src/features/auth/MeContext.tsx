// «Кто я» на клиенте: GET /api/me (API §12.1, P10); выход и выход со всех устройств.
import { REST_ROUTES, type Me } from "@chezz/protocol";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, callApi, type ApiErrorCode } from "../../shared/api/rest.ts";

/** `error` — `/api/me` не ответил: интерфейс как у гостя + Toast (DESIGN §10.4 `shell error*`); авто-повтора нет. */
export type MeState = { status: "loading" } | { status: "guest" } | { status: "error"; code: ApiErrorCode } | { status: "ready"; me: Me };

interface MeValue {
  state: MeState;
  /** Новый `Me` из ответа (первый вход, PATCH /api/me). */
  setMe: (me: Me) => void;
  /** Перечитать `/api/me` (навигация после ошибки). */
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
}

const MeContext = createContext<MeValue | null>(null);

export function errorCodeOf(err: unknown): ApiErrorCode {
  return err instanceof ApiError ? err.code : "unknown";
}

/** Выход: 401 `unauthenticated` — Session уже закрыта (другое устройство, срок): итог тот же, что у успеха. */
async function signOut(call: () => Promise<unknown>): Promise<void> {
  try {
    await call();
  } catch (err) {
    if (!(err instanceof ApiError && err.code === "unauthenticated")) throw err;
  }
}

export function MeProvider({ children, initial }: { children: ReactNode; initial?: MeState }) {
  const [state, setState] = useState<MeState>(initial ?? { status: "loading" });

  const refresh = useCallback(async () => {
    try {
      const { user } = await callApi(REST_ROUTES.getMe, {});
      setState(user === null ? { status: "guest" } : { status: "ready", me: user });
    } catch (err) {
      setState({ status: "error", code: errorCodeOf(err) });
    }
  }, []);

  useEffect(() => {
    if (initial === undefined) void refresh();
  }, [initial, refresh]);

  const logout = useCallback(async () => {
    await signOut(() => callApi(REST_ROUTES.logout, {}));
    setState({ status: "guest" });
  }, []);

  const logoutAll = useCallback(async () => {
    await signOut(() => callApi(REST_ROUTES.logoutAll, {}));
    setState({ status: "guest" });
  }, []);

  const setMe = useCallback((me: Me) => setState({ status: "ready", me }), []);

  const value = useMemo(() => ({ state, setMe, refresh, logout, logoutAll }), [state, setMe, refresh, logout, logoutAll]);
  return <MeContext.Provider value={value}>{children}</MeContext.Provider>;
}

export function useMe(): MeValue {
  const v = useContext(MeContext);
  if (!v) throw new Error("useMe вне MeProvider");
  return v;
}

/** `Me` вошедшего (Игрок или П1), иначе null. */
export function meOf(state: MeState): Me | null {
  return state.status === "ready" ? state.me : null;
}
