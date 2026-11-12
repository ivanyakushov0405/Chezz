// Баннер состояния соединения (DESIGN §7, §10.2): один на приложение, в оболочке.
import { useEffect, useState } from "react";
import { useWs, useWsStatus } from "../../api/WsContext.tsx";
import { useT } from "../../i18n/I18nContext.tsx";
import { Banner } from "../Banner/Banner.tsx";
import { Button } from "../Button/Button.tsx";

/** «Переподключение…» — не раньше чем через 1 с (DESIGN §10.2), чтобы короткий разрыв не мигал. */
export const RECONNECTING_BANNER_DELAY_MS = 1_000;

export function ConnectionBanner() {
  const t = useT();
  const ws = useWs();
  const status = useWsStatus();
  const [showReconnecting, setShowReconnecting] = useState(false);

  useEffect(() => {
    if (status !== "reconnecting") {
      setShowReconnecting(false);
      return;
    }
    const timer = window.setTimeout(() => setShowReconnecting(true), RECONNECTING_BANNER_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [status]);

  switch (status) {
    case "reconnecting":
      return showReconnecting ? <Banner tone="warning" message={t("ws.reconnecting")} /> : null;
    case "offline":
      return <Banner tone="warning" message={t("ws.offline")} />;
    case "outdated":
      return (
        <Banner
          tone="danger"
          message={t("error.client_outdated")}
          action={
            <Button variant="secondary" onClick={() => window.location.reload()}>
              {t("ws.reload")}
            </Button>
          }
        />
      );
    case "too-many-tabs":
      return (
        <Banner
          tone="danger"
          message={t("error.too_many_connections")}
          action={
            <Button variant="secondary" onClick={() => ws.reconnect()}>
              {t("ws.reconnect")}
            </Button>
          }
        />
      );
    default:
      return null;
  }
}
