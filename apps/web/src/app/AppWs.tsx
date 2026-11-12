// WebSocket приложения и «кто я» (API §10, DESIGN §10.2): 4001 — Toast «Вы вышли» и перечитать /api/me;
// вход или выход в этой вкладке — переподключиться, чтобы сервер видел новую Session.
import { useEffect, useRef, type ReactNode } from "react";
import { meOf, useMe } from "../features/auth/MeContext.tsx";
import { useWs, WsProvider } from "../shared/api/WsContext.tsx";
import type { WsClient } from "../shared/api/ws.ts";
import { useToast } from "../shared/ui/Toast/Toast.tsx";

function SessionBridge({ children }: { children: ReactNode }) {
  const ws = useWs();
  const toast = useToast();
  const { state, refresh } = useMe();
  const lastWho = useRef<string | null>(null);

  useEffect(
    () =>
      ws.onSessionClosed(() => {
        // Клиент уже переподключается гостем — смена «кто я» после refresh не должна рвать соединение ещё раз.
        lastWho.current = "guest";
        toast({ message: "shell.session_closed", tone: "info" });
        void refresh();
      }),
    [ws, toast, refresh],
  );

  // Кто подключён: id Игрока или «гость»; пока /api/me грузится — не трогаем соединение.
  const who = state.status === "loading" ? null : (meOf(state)?.id ?? "guest");
  useEffect(() => {
    if (who === null) return;
    if (lastWho.current !== null && lastWho.current !== who) ws.reconnect();
    lastWho.current = who;
  }, [who, ws]);

  return <>{children}</>;
}

export function AppWs({ children, client }: { children: ReactNode; client?: WsClient }) {
  return (
    <WsProvider client={client}>
      <SessionBridge>{children}</SessionBridge>
    </WsProvider>
  );
}
