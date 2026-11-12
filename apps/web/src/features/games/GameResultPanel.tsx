import { PAGES, type Color, type Game } from "@chezz/protocol";
import { useT } from "../../shared/i18n/I18nContext.tsx";
import { ButtonLink } from "../../shared/ui/Button/Button.tsx";
import styles from "./GameResultPanel.module.css";

/** «+12», «−9», «±0» (DESIGN §15: минус — U+2212). */
export function formatDelta(delta: number): string {
  if (delta > 0) return `+${delta}`;
  if (delta < 0) return `−${Math.abs(delta)}`;
  return "±0";
}

/** GameResultPanel (U16): результат · окончание, изменение рейтинга, «Новая игра» → `/`. «Разбор» — E12/E13. */
export function GameResultPanel({ game, yourColor }: { game: Game; yourColor: Color | null }) {
  const t = useT();
  const result = game.status === "aborted" ? t("game.result.aborted") : game.result !== null ? t(`game.result.${game.result}`) : "";
  const termination = game.termination !== null && game.status !== "aborted" ? t(`game.termination.${game.termination}`) : null;
  const sides: Color[] = yourColor === "black" ? ["black", "white"] : ["white", "black"];
  return (
    <section className={styles["panel"]} data-game-result="true" aria-live="polite">
      <h2 className={styles["title"]}>
        {result}
        {termination !== null ? ` · ${termination}` : null}
      </h2>
      {game.ratings !== null ? (
        <ul className={styles["ratings"]}>
          {sides.map((side) => {
            const change = game.ratings![side];
            const delta = change.rating_after - change.rating_before;
            return (
              <li key={side} className={styles["rating"]} data-rating-side={side}>
                <span className={styles["nickname"]}>{game[side].nickname ?? t("game.deleted_player")}</span>
                <span>{change.rating_after}</span>
                <span className={delta >= 0 ? styles["up"] : styles["down"]}>{formatDelta(delta)}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
      <ButtonLink href={PAGES.home()}>{t("game.new_game")}</ButtonLink>
    </section>
  );
}
