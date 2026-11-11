import type { Category } from "./common.ts";

/**
 * Адреса страниц SPA (API §14): единственное место, где они строятся — для SPA, `seo`, `sitemap.xml`, `return_to`.
 * `/sitemap.xml` и `/robots.txt` — не страницы SPA.
 */
export const PAGES = {
  home: (): string => "/",
  welcome: (returnTo?: string): string =>
    returnTo === undefined ? "/welcome" : `/welcome?return_to=${encodeURIComponent(returnTo)}`,
  player: (nickname: string): string => `/player/${encodeURIComponent(nickname)}`,
  playerGames: (nickname: string): string => `/player/${encodeURIComponent(nickname)}/games`,
  leaderboard: (category: Category): string => `/leaderboard/${category}`,
  game: (id: string): string => `/game/${id}`,
  gameAnalysis: (id: string): string => `/game/${id}/analysis`,
  challenge: (id: string): string => `/challenge/${id}`,
  settings: (): string => "/settings",
  accountDelete: (): string => "/account/delete",
  terms: (): string => "/terms",
  privacy: (): string => "/privacy",
} as const;
