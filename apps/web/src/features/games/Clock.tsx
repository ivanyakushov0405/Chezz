import { formatClock } from "./clockDisplay.ts";
import styles from "./Clock.module.css";

/** Clock (DESIGN §7, §9.3): `active` — идут; `low` — ниже порога U11 (важнее `active`). */
export function Clock({ ms, active, low, label }: { ms: number; active: boolean; low: boolean; label: string }) {
  const cls = [styles["clock"], active ? styles["active"] : "", low ? styles["low"] : ""].filter(Boolean).join(" ");
  return (
    <div className={cls} role="timer" aria-label={label} data-clock-active={active || undefined} data-clock-low={low || undefined}>
      {formatClock(ms)}
    </div>
  );
}
