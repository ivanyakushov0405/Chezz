import type { PlayerRef } from "@chezz/protocol";
import { useT } from "../../shared/i18n/I18nContext.tsx";
import styles from "./PlayerLine.module.css";

/** PlayerLine (DESIGN §7): ник, рейтинг (`?` — предварительный), связь. Флаг страны и разрыв с отсчётом — E07. */
export function PlayerLine({ player, connected, side }: { player: PlayerRef; connected: boolean; side: "top" | "bottom" }) {
  const t = useT();
  return (
    <div className={styles["line"]} data-player-line={side}>
      <span className={connected ? styles["dot"] : `${styles["dot"]} ${styles["away"]}`} aria-hidden="true" />
      <span className={styles["nickname"]}>{player.nickname ?? t("game.deleted_player")}</span>
      {player.rating !== null ? (
        <span className={styles["rating"]}>
          {player.rating}
          {player.provisional ? "?" : ""}
        </span>
      ) : null}
      {!connected ? <span className={styles["status"]}>{t("game.player_offline")}</span> : null}
    </div>
  );
}
