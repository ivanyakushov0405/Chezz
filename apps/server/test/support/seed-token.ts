// Токен Session сид-игрока (TESTING §7.6, V20, V23): единственная реализация HMAC — для seed.ts и хелпера входа e2e.
import { createHmac } from "node:crypto";

/** base64url без `=`, 43 символа — тот же формат, что `randomBytes(32)` (SECURITY §5). */
export function seedSessionToken(secret: string, nickname: string): string {
  return createHmac("sha256", secret).update(nickname, "utf8").digest("base64url");
}

/** Ключ сида локально и в CI (TESTING §7.6, «фиксированный генератор»): публичный; на staging — SEED_TOKEN_SECRET. */
export const LOCAL_SEED_SECRET = "chezz-local-seed";

/** Игроки сида --demo (TESTING §7.6). */
export const SEED_PLAYERS: readonly string[] = Array.from({ length: 12 }, (_, i) => `seed_player_${String(i + 1).padStart(2, "0")}`);
