import { useEffect } from "react";
import { useT } from "../../shared/i18n/I18nContext.tsx";
import styles from "./LegalPage.module.css";

/** Экран `legal` — `/terms` и `/privacy` (DESIGN §9; design-spec E04): в E04 текст-заглушка. */
export function LegalPage({ kind }: { kind: "terms" | "privacy" }) {
  const t = useT();
  const title = t(`legal.${kind}.title`);
  useEffect(() => {
    document.title = `${title} — ${t("app.name")}`;
  }, [title, t]);
  return (
    <main className={styles["screen"]} data-screen="legal" data-state="default">
      <article className={styles["article"]}>
        <h1 className={styles["title"]}>{title}</h1>
        <p className={styles["text"]}>{t("legal.placeholder")}</p>
      </article>
    </main>
  );
}
