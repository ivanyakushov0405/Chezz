import { LOCALES, type Locale } from "@chezz/i18n";

export const LOCALE_STORAGE_KEY = "chezz.locale";

function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Язык гостя (DESIGN §15): localStorage, иначе navigator.language на «ru» → ru, иначе en. */
export function detectLocale(storage: Pick<Storage, "getItem"> | null, navigatorLanguage: string): Locale {
  let stored: string | null = null;
  try {
    stored = storage?.getItem(LOCALE_STORAGE_KEY) ?? null;
  } catch {
    stored = null;
  }
  if (isLocale(stored)) return stored;
  return navigatorLanguage.toLowerCase().startsWith("ru") ? "ru" : "en";
}

export function currentLocale(): Locale {
  let storage: Storage | null = null;
  try {
    storage = window.localStorage;
  } catch {
    storage = null;
  }
  return detectLocale(storage, navigator.language);
}
