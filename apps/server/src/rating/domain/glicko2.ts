// Glicko-2 по статье Glickman «Example of the Glicko-2 system», без периодов — метод Lichess (ТЗ §4.7;
// ARCHITECTURE §11, A29). Чистые функции: время с последней партии приходит параметром.

export interface Glicko {
  rating: number;
  rd: number;
  volatility: number;
}

export interface RatedGame {
  opponent: { rating: number; rd: number };
  score: 0 | 0.5 | 1;
}

/** Старт и сброс (ТЗ §4.7, GLOSSARY G24). */
export const DEFAULT_GLICKO: Readonly<Glicko> = Object.freeze({ rating: 1500, rd: 350, volatility: 0.06 });

/** τ — константа модуля, не параметр (ARCHITECTURE §11). */
const TAU = 0.5;
/** Периодов Glicko-2 за сутки без игр (lila `Glicko.periodsPerDay`; ARCHITECTURE §11, F6-Q3). */
export const RD_PERIODS_PER_DAY = 0.21436;
/** Потолок RD после роста — стартовое RD (ARCHITECTURE §11). */
export const MAX_RD = 350;
/** Перевод шкалы Glicko ↔ Glicko-2 (статья, шаг 2). */
const SCALE = 173.7178;
const BASE_RATING = 1500;
/** Точность итерации волатильности (статья, шаг 5). */
const EPSILON = 1e-6;
/** Защита от зацикливания итерации; на корректных входах сходится за десятки шагов. */
const MAX_ITERATIONS = 1000;

function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

function expected(mu: number, muJ: number, phiJ: number): number {
  return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));
}

/** Шаг 5 статьи: новая волатильность (алгоритм Illinois). */
function newVolatility(phi: number, sigma: number, v: number, delta: number): number {
  const a = Math.log(sigma * sigma);
  const f = (x: number): number => {
    const ex = Math.exp(x);
    const d = phi * phi + v + ex;
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * d * d) - (x - a) / (TAU * TAU);
  };

  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k += 1;
    B = a - k * TAU;
  }
  let fA = f(A);
  let fB = f(B);
  for (let i = 0; Math.abs(B - A) > EPSILON; i += 1) {
    if (i >= MAX_ITERATIONS) throw new Error("glicko2: volatility iteration did not converge");
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
  }
  return Math.exp(A / 2);
}

/** φ после `elapsedDays` суток без игр, шкала Glicko-2, не выше MAX_RD (ARCHITECTURE §11). */
function grownPhi(rd: number, volatility: number, elapsedDays: number): number {
  if (!Number.isFinite(elapsedDays) || elapsedDays < 0) throw new RangeError("glicko2: elapsedDays must be >= 0");
  const grown = Math.sqrt((rd / SCALE) ** 2 + RD_PERIODS_PER_DAY * elapsedDays * volatility * volatility);
  return Math.min(grown, MAX_RD / SCALE);
}

/** RD после роста за время без игр — для соперника в пересчёте (ARCHITECTURE §11). */
export function grownRd(rd: number, volatility: number, elapsedDays: number): number {
  return grownPhi(rd, volatility, elapsedDays) * SCALE;
}

/**
 * Единственная функция пересчёта (A29): после партии — массив из одной партии.
 * Перед шагами статьи RD растёт за `elapsedDays` суток без игр, не выше MAX_RD (ARCHITECTURE §11).
 */
export function rateMany(player: Glicko, games: RatedGame[], elapsedDays: number): Glicko {
  if (games.length === 0) throw new RangeError("glicko2: games must not be empty");

  const mu = (player.rating - BASE_RATING) / SCALE;
  const sigma = player.volatility;
  const phi = grownPhi(player.rd, sigma, elapsedDays);

  // Шаги 3–4: v и Δ.
  let vInv = 0;
  let sum = 0;
  for (const game of games) {
    const muJ = (game.opponent.rating - BASE_RATING) / SCALE;
    const phiJ = game.opponent.rd / SCALE;
    const gJ = g(phiJ);
    const e = expected(mu, muJ, phiJ);
    vInv += gJ * gJ * e * (1 - e);
    sum += gJ * (game.score - e);
  }
  const v = 1 / vInv;
  const delta = v * sum;

  // Шаги 5–8.
  const sigmaNew = newVolatility(phi, sigma, v, delta);
  const phiStar = Math.sqrt(phi * phi + sigmaNew * sigmaNew);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = mu + phiNew * phiNew * sum;

  return { rating: muNew * SCALE + BASE_RATING, rd: phiNew * SCALE, volatility: sigmaNew };
}
