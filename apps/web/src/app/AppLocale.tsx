// Язык интерфейса (DESIGN §15, U21, U29): Игрок — `Me.locale` (смена — PATCH /api/me); гость и П1 — localStorage / браузер.
import { REST_ROUTES, type Locale } from "@chezz/protocol";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { meOf, useMe } from "../features/auth/MeContext.tsx";
import { callApi } from "../shared/api/rest.ts";
import { I18nProvider } from "../shared/i18n/I18nContext.tsx";
import { currentLocale, saveGuestLocale } from "../shared/i18n/locale.ts";

interface LocaleValue {
  locale: Locale;
  /** Бросает ApiError, если PATCH /api/me не удался. */
  changeLocale: (locale: Locale) => Promise<void>;
}

const LocaleContext = createContext<LocaleValue | null>(null);

export function AppLocale({ children }: { children: ReactNode }) {
  const { state, setMe } = useMe();
  const [guestLocale, setGuestLocale] = useState<Locale>(currentLocale);
  const me = meOf(state);
  const isPlayer = me !== null && !me.onboarding_required;
  const locale: Locale = isPlayer ? me.locale : guestLocale;

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  // Тема Игрока — из настроек; гость — prefers-color-scheme (DESIGN U8).
  const theme = isPlayer ? me.settings.theme : null;
  useEffect(() => {
    if (theme === null) delete document.documentElement.dataset["theme"];
    else document.documentElement.dataset["theme"] = theme;
  }, [theme]);

  const changeLocale = useCallback(
    async (next: Locale) => {
      if (isPlayer) {
        const { user } = await callApi(REST_ROUTES.updateMe, { body: { locale: next } });
        setMe(user);
      } else {
        saveGuestLocale(next);
        setGuestLocale(next);
      }
    },
    [isPlayer, setMe],
  );

  const value = useMemo(() => ({ locale, changeLocale }), [locale, changeLocale]);
  return (
    <LocaleContext.Provider value={value}>
      <I18nProvider locale={locale}>{children}</I18nProvider>
    </LocaleContext.Provider>
  );
}

export function useLocaleSwitch(): LocaleValue {
  const v = useContext(LocaleContext);
  if (!v) throw new Error("useLocaleSwitch вне AppLocale");
  return v;
}
