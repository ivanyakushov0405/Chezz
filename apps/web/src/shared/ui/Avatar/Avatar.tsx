import styles from "./Avatar.module.css";

/** Аватар показывается только с домена Google (SECURITY §10); иначе — заглушка. */
export const AVATAR_PREFIX = "https://lh3.googleusercontent.com/";

export interface AvatarProps {
  url: string | null;
  size: "s" | "m" | "l";
}

/** Avatar (DESIGN §7): декоративный (`alt=""`) — имя даёт родитель. */
export function Avatar({ url, size }: AvatarProps) {
  const safe = url !== null && url.startsWith(AVATAR_PREFIX) ? url : null;
  const cls = `${styles["avatar"]} ${styles[size]}`;
  if (safe !== null) return <img className={cls} src={safe} alt="" referrerPolicy="no-referrer" />;
  return (
    <span className={`${cls} ${styles["placeholder"]}`} data-placeholder="true" aria-hidden="true">
      <svg viewBox="0 0 24 24" className={styles["icon"]} focusable="false">
        <circle cx="12" cy="9" r="4" fill="currentColor" />
        <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" fill="currentColor" />
      </svg>
    </span>
  );
}
