import type { Color } from "@chezz/protocol";
import { useEffect, useRef } from "react";
import { useT } from "../../shared/i18n/I18nContext.tsx";
import styles from "./PromotionPicker.module.css";

export type PromotionPiece = "q" | "r" | "b" | "n";
const PIECES: readonly PromotionPiece[] = ["q", "r", "b", "n"];
/** Картинка фигуры набора cburnett (DESIGN §6; merida — E16). */
const pieceSrc = (color: Color, p: PromotionPiece): string => `/pieces/cburnett/${color === "white" ? "w" : "b"}${p.toUpperCase()}.svg`;

/** PromotionPicker (DESIGN §9.3): 4 фигуры; Esc — отмена хода. При `auto_queen` не показывается. */
export function PromotionPicker({ color, onPick, onCancel }: { color: Color; onPick: (piece: PromotionPiece) => void; onCancel: () => void }) {
  const t = useT();
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  return (
    <div
      className={styles["backdrop"]}
      onClick={onCancel}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
      data-promotion-picker="true"
    >
      <div role="dialog" aria-label={t("game.promotion.title")} className={styles["picker"]} onClick={(e) => e.stopPropagation()}>
        {PIECES.map((p, i) => (
          <button
            key={p}
            ref={i === 0 ? first : undefined}
            type="button"
            className={styles["choice"]}
            aria-label={t(`game.piece.${p}`)}
            data-piece={p}
            onClick={() => onPick(p)}
          >
            <img className={styles["img"]} src={pieceSrc(color, p)} alt="" />
          </button>
        ))}
      </div>
    </div>
  );
}
