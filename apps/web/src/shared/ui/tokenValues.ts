import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Только для тестов: значения токенов из tokens.css по теме (DESIGN §17). */
const TOKENS_PATH = fileURLToPath(new URL("./tokens.css", import.meta.url));

function declarations(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(m[1] as string, (m[2] as string).trim());
  return out;
}

function blocks(css: string, selectorRe: RegExp): Map<string, string> {
  const out = new Map<string, string>();
  // блоки верхнего уровня без вложенных скобок: «селектор { тело }»
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selectorRe.test((m[1] as string).trim())) for (const [k, v] of declarations(m[2] as string)) out.set(k, v);
  }
  return out;
}

export function loadTheme(theme: "light" | "dark"): Map<string, string> {
  const css = readFileSync(TOKENS_PATH, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const values = blocks(css, /^(:root|:root,\s*\[data-theme="light"\])$/);
  if (theme === "dark") for (const [k, v] of blocks(css, /^\[data-theme="dark"\]$/)) values.set(k, v);
  return values;
}

/** Раскрывает var(--x) до литерала. */
export function resolve(values: Map<string, string>, name: string): string {
  let value = values.get(name);
  if (value === undefined) throw new Error(`нет токена ${name}`);
  for (let i = 0; i < 10; i += 1) {
    const m = /^var\((--[\w-]+)\)$/.exec(value);
    if (!m) return value;
    const next = values.get(m[1] as string);
    if (next === undefined) throw new Error(`нет токена ${m[1]}`);
    value = next;
  }
  throw new Error(`цикл в ${name}`);
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`не hex-цвет: ${hex}`);
  const n = parseInt(m[1] as string, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
