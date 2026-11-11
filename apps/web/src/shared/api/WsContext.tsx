// Одно WebSocket-соединение на вкладку (ARCHITECTURE §12): провайдер и хуки поверх `ws.ts`.
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { browserWsEnvironment, createWsClient, type WsClient, type WsStatus } from "./ws.ts";

const WsContext = createContext<WsClient | null>(null);

/** `client` — для тестов; по умолчанию — настоящий клиент браузера. Подключение — при монтировании. */
export function WsProvider({ children, client }: { children: ReactNode; client?: WsClient }) {
  const [value] = useState<WsClient>(() => client ?? createWsClient(browserWsEnvironment()));
  useEffect(() => {
    value.start();
  }, [value]);
  return <WsContext.Provider value={value}>{children}</WsContext.Provider>;
}

export function useWs(): WsClient {
  const v = useContext(WsContext);
  if (!v) throw new Error("useWs вне WsProvider");
  return v;
}

export function useWsStatus(): WsStatus {
  const ws = useWs();
  const subscribe = useMemo(() => (fn: () => void) => ws.onStatus(fn), [ws]);
  return useSyncExternalStore(subscribe, () => ws.status);
}
