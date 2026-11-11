import { PAGES } from "@chezz/protocol";
import { useEffect } from "react";
import { useT } from "../../shared/i18n/I18nContext.tsx";
import { ButtonLink } from "../../shared/ui/Button/Button.tsx";
import styles from "../legal/CenteredPage.module.css";

/** Экран `not-found` (DESIGN §9, §10.4: только default). */
export function NotFoundPage() {
  const t = useT();
  useEffect(() => {
    document.title = `${t("not_found.title")} — ${t("app.name")}`;
  }, [t]);
  return (
    <main className={styles["screen"]} data-screen="not-found" data-state="default">
      <h1 className={styles["title"]}>{t("not_found.title")}</h1>
      <ButtonLink href={PAGES.home()} variant="secondary">
        {t("not_found.home")}
      </ButtonLink>
    </main>
  );
}
