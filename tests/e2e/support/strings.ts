export type Lang = "ru" | "en";

/** Строки главной-заглушки из «Публичных интерфейсов» design.md (T-5). */
export const LOBBY_STRINGS: Record<Lang, { name: string; beta: string; comingSoon: string }> = {
  ru: { name: "Chezz", beta: "Бета", comingSoon: "Скоро здесь можно будет играть в шахматы онлайн." },
  en: { name: "Chezz", beta: "Beta", comingSoon: "Online chess is coming soon." },
};

export const LOCALE_STORAGE_KEY = "chezz.locale";
export const TRANSLATION_KEY_RE = /^[a-z_]+(\.[a-z_]+)+$/;

/** Видимые строки текста страницы (по строкам innerText). */
export function visibleLines(text: string): string[] {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
