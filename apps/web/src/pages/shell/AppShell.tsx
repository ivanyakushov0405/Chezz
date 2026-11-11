// Экран `shell` (DESIGN §9, §10.4; design-spec E04): шапка, подвал, Toast; состояния default / guest / error.
import { PAGES, type Locale } from "@chezz/protocol";
import { useEffect, useState, type ReactNode } from "react";
import { useLocaleSwitch } from "../../app/AppLocale.tsx";
import { errorCodeOf, meOf, useMe } from "../../features/auth/MeContext.tsx";
import { useT } from "../../shared/i18n/I18nContext.tsx";
import { currentPath, Link, useLocation } from "../../shared/router/Router.tsx";
import { Avatar } from "../../shared/ui/Avatar/Avatar.tsx";
import { Badge } from "../../shared/ui/Badge/Badge.tsx";
import { ButtonLink } from "../../shared/ui/Button/Button.tsx";
import { ConnectionBanner } from "../../shared/ui/ConnectionBanner/ConnectionBanner.tsx";
import { Logo } from "../../shared/ui/Logo/Logo.tsx";
import { Menu } from "../../shared/ui/Menu/Menu.tsx";
import { SegmentedControl } from "../../shared/ui/SegmentedControl/SegmentedControl.tsx";
import { useToast } from "../../shared/ui/Toast/Toast.tsx";
import styles from "./AppShell.module.css";

/** Адрес входа: `/auth/google/start?return_to=<путь>` (API §12.1). С экрана ошибки входа — без return_to. */
export function loginHref(path: string): string {
  if (path.startsWith("/auth/")) return "/auth/google/start";
  return `/auth/google/start?return_to=${encodeURIComponent(path)}`;
}

const LOCALE_OPTIONS = [
  { value: "ru", label: "RU" },
  { value: "en", label: "EN" },
] as const satisfies readonly { value: Locale; label: string }[];

function AccountMenu() {
  const t = useT();
  const toast = useToast();
  const { state, logout, logoutAll } = useMe();
  const me = meOf(state);
  const [pending, setPending] = useState<"logout" | "logout_all" | null>(null);
  if (me === null) return null;

  const run = async (which: "logout" | "logout_all"): Promise<void> => {
    setPending(which);
    try {
      await (which === "logout" ? logout() : logoutAll());
      toast({ message: "shell.session_closed", tone: "info" });
    } catch (err) {
      toast({ message: `error.${errorCodeOf(err)}`, tone: "danger" });
    } finally {
      setPending(null);
    }
  };

  const nickname = me.nickname;
  return (
    <Menu
      label={nickname === null ? t("shell.account_menu_anonymous") : t("shell.account_menu", { nickname })}
      heading={nickname ?? undefined}
      trigger={
        <>
          <Avatar url={me.avatar_url} size="s" />
          {nickname !== null ? <span className={styles["nickname"]}>{nickname}</span> : null}
        </>
      }
      items={[
        { id: "logout", label: t("shell.logout"), loading: pending === "logout", onSelect: () => run("logout") },
        { id: "logout_all", label: t("shell.logout_all"), loading: pending === "logout_all", onSelect: () => run("logout_all") },
      ]}
    />
  );
}

function LanguageSwitch() {
  const t = useT();
  const toast = useToast();
  const { locale, changeLocale } = useLocaleSwitch();
  return (
    <SegmentedControl
      label={t("shell.language")}
      options={LOCALE_OPTIONS}
      value={locale}
      onChange={(next) => {
        changeLocale(next).catch((err: unknown) => toast({ message: `error.${errorCodeOf(err)}`, tone: "danger" }));
      }}
    />
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const t = useT();
  const toast = useToast();
  const location = useLocation();
  const { state } = useMe();
  const me = meOf(state);

  // `/api/me` не ответил — работаем как гость + Toast (DESIGN §10.4 `shell error*`).
  const errorCode = state.status === "error" ? state.code : null;
  useEffect(() => {
    if (errorCode !== null) toast({ message: `error.${errorCode}`, tone: "danger" });
  }, [errorCode, toast]);

  const shellState = me === null ? (state.status === "error" ? "guest error" : "guest") : "default";
  return (
    <div className={styles["shell"]} data-shell="true" data-shell-state={shellState}>
      <header className={styles["header"]}>
        <div className={styles["bar"]}>
          <div className={styles["brand"]}>
            <span className={styles["logoNarrow"]}>
              <Logo withName={false} />
            </span>
            <span className={styles["logoWide"]}>
              <Logo />
            </span>
            <Badge label={t("app.beta")} />
          </div>
          <div className={styles["account"]}>
            {state.status === "loading" ? null : me === null ? (
              <ButtonLink href={loginHref(currentPath(location))}>{t("shell.login_google")}</ButtonLink>
            ) : (
              <AccountMenu />
            )}
          </div>
        </div>
      </header>
      <ConnectionBanner />
      <div className={styles["content"]}>{children}</div>
      <footer className={styles["footer"]}>
        <Link className={styles["footerLink"]} href={PAGES.terms()}>
          {t("shell.footer.terms")}
        </Link>
        <Link className={styles["footerLink"]} href={PAGES.privacy()}>
          {t("shell.footer.privacy")}
        </Link>
        <LanguageSwitch />
      </footer>
    </div>
  );
}
