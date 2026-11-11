// Показ рейтинга (ТЗ §4.7; GLOSSARY «Предварительный рейтинг», G33): считает сервер, клиент только рисует.

/** RD больше этого — рейтинг предварительный, знак «?» (ТЗ §4.7). */
export const PROVISIONAL_RD = 110;

export function isProvisional(rd: number): boolean {
  return rd > PROVISIONAL_RD;
}

/** Рейтинг до целого (ТЗ §4.7); половина — вверх (1499,5 → 1500). */
export function roundRating(rating: number): number {
  return Math.round(rating);
}
