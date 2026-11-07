import { useT } from "../../shared/i18n/I18nContext.tsx";
import { Badge } from "../../shared/ui/Badge/Badge.tsx";
import { Logo } from "../../shared/ui/Logo/Logo.tsx";
import styles from "./LobbyPage.module.css";

/** Главная-заглушка E01: только состояние default (DESIGN §10.4). */
export function LobbyPage() {
  const t = useT();
  return (
    <div className={styles["screen"]} data-screen="lobby" data-state="default">
      <main className={styles["main"]}>
        <div className={styles["brand"]}>
          <Logo />
          <Badge label={t("app.beta")} />
        </div>
        <p className={styles["text"]}>{t("lobby.coming_soon")}</p>
      </main>
    </div>
  );
}
