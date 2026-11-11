import type { Move } from "@chezz/protocol";
import { useEffect, useRef } from "react";
import { useT } from "../../shared/i18n/I18nContext.tsx";
import { Button } from "../../shared/ui/Button/Button.tsx";
import styles from "./MoveList.module.css";

/**
 * MoveList (DESIGN §9.3): ходы парами, `viewPly` — показанная позиция (null — текущая).
 * Навигация ←/→ — на экране; здесь кнопки и «К текущему».
 */
export function MoveList({ moves, viewPly, onView }: { moves: readonly Move[]; viewPly: number | null; onView: (ply: number | null) => void }) {
  const t = useT();
  const shown = viewPly ?? moves.length;
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const el = list.current?.querySelector<HTMLElement>("[aria-current='true']");
    el?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [shown]);

  const go = (ply: number): void => onView(ply >= moves.length ? null : Math.max(0, ply));
  const rows: { n: number; white: number; black: number | null }[] = [];
  for (let i = 0; i < moves.length; i += 2) rows.push({ n: i / 2 + 1, white: i + 1, black: i + 1 < moves.length ? i + 2 : null });

  const cell = (ply: number) => (
    <button
      type="button"
      className={styles["move"]}
      aria-current={ply === shown || undefined}
      data-ply={ply}
      onClick={() => go(ply)}
    >
      {moves[ply - 1]!.san}
    </button>
  );

  return (
    <div className={styles["panel"]}>
      <ol ref={list} className={styles["list"]} aria-label={t("game.moves")} data-move-list="true">
        {rows.map((row) => (
          <li key={row.n} className={styles["row"]}>
            <span className={styles["number"]}>{row.n}.</span>
            {cell(row.white)}
            {row.black !== null ? cell(row.black) : null}
          </li>
        ))}
      </ol>
      <div className={styles["nav"]}>
        <Button variant="ghost" aria-label={t("game.prev")} disabled={shown === 0} onClick={() => go(shown - 1)}>
          ←
        </Button>
        <Button variant="ghost" aria-label={t("game.next")} disabled={viewPly === null} onClick={() => go(shown + 1)}>
          →
        </Button>
        {viewPly !== null ? (
          <Button variant="secondary" onClick={() => onView(null)} data-to-current="true">
            {t("game.to_current")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
