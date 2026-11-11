// Категория контроля времени (GLOSSARY §6): time_base + 40 × time_increment (с); ≤ 179 — пуля, 180–479 — блиц, ≥ 480 — рапид.
import type { Category } from "@chezz/protocol";

export function categoryOf(timeBaseS: number, timeIncrementS: number): Category {
  const total = timeBaseS + 40 * timeIncrementS;
  if (total <= 179) return "bullet";
  if (total <= 479) return "blitz";
  return "rapid";
}
