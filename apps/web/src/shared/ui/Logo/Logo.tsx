import { PAGES } from "@chezz/protocol";
import { useT } from "../../i18n/I18nContext.tsx";
import styles from "./Logo.module.css";

export interface LogoProps {
  withName?: boolean;
}

export function Logo({ withName = true }: LogoProps) {
  const t = useT();
  const name = t("app.name");
  return (
    <a className={styles["logo"]} href={PAGES.home()} {...(withName ? {} : { "aria-label": name })}>
      <span className={styles["mark"]} aria-hidden="true" />
      {withName ? <span className={styles["name"]}>{name}</span> : null}
    </a>
  );
}
