import { useT } from "../../shared/i18n/I18nContext.tsx";
import styles from "./LobbyPage.module.css";

/** Главная-заглушка (E01): только состояние default (DESIGN §10.4). Шапка и подвал — `shell` (E04). */
export function LobbyPage() {
  const t = useT();
  return (
    <main className={styles["screen"]} data-screen="lobby" data-state="default">
      <p className={styles["text"]}>{t("lobby.coming_soon")}</p>
    </main>
  );
}
