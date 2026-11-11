import { useEffect, useRef } from "react";
import { useT } from "../../shared/i18n/I18nContext.tsx";
import { ButtonLink } from "../../shared/ui/Button/Button.tsx";
import styles from "../legal/CenteredPage.module.css";

/** Страница входа без `return_to` (бриф E04, «Решения», п.10б). */
export const LOGIN_RETRY_HREF = "/auth/google/start";

/**
 * Экран `login-failed` (DESIGN §9): callback ответил index.html со статусом 400 на своём адресе.
 * Причину не показываем (SECURITY §4); query (`code`, `state`) убирается из адреса; фокус — на `<h1>`.
 */
export function LoginFailedPage() {
  const t = useT();
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (window.location.search !== "" || window.location.hash !== "") {
      window.history.replaceState(window.history.state, "", window.location.pathname);
    }
    heading.current?.focus();
  }, []);

  useEffect(() => {
    document.title = `${t("login_failed.title")} — ${t("app.name")}`;
  }, [t]);

  return (
    <main className={styles["screen"]} data-screen="login-failed" data-state="default">
      <h1 ref={heading} className={styles["title"]} tabIndex={-1}>
        {t("login_failed.title")}
      </h1>
      <ButtonLink href={LOGIN_RETRY_HREF}>{t("login_failed.retry")}</ButtonLink>
    </main>
  );
}
