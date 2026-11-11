/**
 * Проверка `return_to` (SECURITY §4, S30): одна функция для `platform` и SPA.
 * Возвращает абсолютный href своего origin; при отказе — `origin + "/"`.
 * Кроме правил S30 проверяется и раскодированная строка: `/%09/evil.example` — отказ (пример SECURITY §4).
 */
/** Символ с кодом < 0x20, 0x7F или `\` (S30 п.1). */
const FORBIDDEN_CHARS = {
  test(value: string): boolean {
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code < 0x20 || code === 0x7f || code === 0x5c) return true;
    }
    return false;
  },
};

function decodeOrNull(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function safeLocalPath(returnTo: string | null | undefined, origin: string): string {
  const base = origin.replace(/\/+$/, "");
  const fallback = `${base}/`;
  if (!returnTo || !returnTo.startsWith("/") || FORBIDDEN_CHARS.test(returnTo)) return fallback;
  const decoded = decodeOrNull(returnTo);
  if (decoded === null || FORBIDDEN_CHARS.test(decoded) || decoded.startsWith("//")) return fallback;
  let url: URL;
  try {
    url = new URL(returnTo, base);
  } catch {
    return fallback;
  }
  if (url.origin !== base || url.pathname.startsWith("//")) return fallback;
  const decodedPath = decodeOrNull(url.pathname);
  if (decodedPath === null || decodedPath.startsWith("//")) return fallback;
  return url.href;
}
