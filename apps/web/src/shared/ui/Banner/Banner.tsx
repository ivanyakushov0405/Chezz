import type { ReactNode } from "react";
import styles from "./Banner.module.css";

export type BannerTone = "info" | "warning" | "danger";

/** Banner (DESIGN §7): постоянное состояние экрана; `message` — уже переведённый текст, `action` — кнопка. */
export function Banner({ tone, message, action }: { tone: BannerTone; message: ReactNode; action?: ReactNode }) {
  return (
    <div className={`${styles["banner"]} ${styles[tone]}`} role="status" data-tone={tone}>
      <span className={styles["message"]}>{message}</span>
      {action !== undefined ? <span className={styles["action"]}>{action}</span> : null}
    </div>
  );
}
