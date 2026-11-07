import en from "./en.json" with { type: "json" };
import ru from "./ru.json" with { type: "json" };

export const LOCALES = ["ru", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export type Messages = Readonly<Record<string, string>>;
export const MESSAGES: Readonly<Record<Locale, Messages>> = { ru, en };

export type TParams = Readonly<Record<string, string | number>>;
export type T = (key: string, params?: TParams) => string;

export interface CreateTOptions {
  /** `throw` — нет ключа → исключение (dev, тесты); `key` — вернуть ключ (prod). DESIGN §15. */
  onMissing: "throw" | "key";
}

/** Строка по ключу; `{name}` подставляется; при `params.count` — суффикс `_one/_few/_many/_other` по Intl.PluralRules. */
export function createT(locale: Locale, options: CreateTOptions): T {
  return createTFrom(MESSAGES[locale], locale, options);
}

/** То же над произвольным словарём (тесты). */
export function createTFrom(messages: Messages, locale: Locale, options: CreateTOptions): T {
  const rules = new Intl.PluralRules(locale);
  return (key, params) => {
    let text: string | undefined;
    const count = params?.["count"];
    if (typeof count === "number") text = messages[`${key}_${rules.select(count)}`];
    text ??= messages[key];
    if (text === undefined) {
      if (options.onMissing === "throw") throw new Error(`i18n: missing key "${key}" (${locale})`);
      return key;
    }
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
      const value = params[name];
      return value === undefined ? whole : String(value);
    });
  };
}
