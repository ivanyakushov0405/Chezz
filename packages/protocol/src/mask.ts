// Сегмент после `/challenge/` и `/api/challenges/` — секрет вызова по ссылке (SECURITY §15, S37, API S9).
// Сегмент кончается на `/`, `?`, `#`, пробеле, кавычке или скобке (текст сообщения, URL, путь).
const CHALLENGE_ID_RE = /(\/(?:api\/challenges|challenge)\/)[^/?#\s"'<>(){}[\]\\]+/g;

/**
 * Заменяет `id` вызова на `:id` в тексте (путь, URL, сообщение): `/challenge/3f2c…` → `/challenge/:id`.
 * Единственная реализация: её импортируют `apps/server` (pino) и `apps/web` (Sentry). Остальное сохраняется.
 */
export function maskChallengeIds(text: string): string {
  return text.replace(CHALLENGE_ID_RE, "$1:id");
}
