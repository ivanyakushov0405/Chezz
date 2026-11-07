import { createT, type Locale, type T } from "@chezz/i18n";
import { reportMissingI18nKey } from "../observability/sentry.ts";
import { createContext, useContext, useMemo, type ReactNode } from "react";

const I18nContext = createContext<T | null>(null);

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const t = useMemo(() => createT(locale, {
        onMissing: import.meta.env.DEV ? "throw" : "key",
        onMissingKey: reportMissingI18nKey,
      }), [locale]);
  return <I18nContext.Provider value={t}>{children}</I18nContext.Provider>;
}

export function useT(): T {
  const t = useContext(I18nContext);
  if (!t) throw new Error("useT вне I18nProvider");
  return t;
}
