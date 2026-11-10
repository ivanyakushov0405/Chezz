/** Минимальный разбор Dockerfile для статических проверок (П9). */

export interface Instruction {
  /** Имя инструкции в верхнем регистре: FROM, ARG, ENV, … */
  op: string;
  /** Аргументы как в файле (продолжения строк склеены). */
  args: string;
}

export interface Stage {
  /** Образ или имя родительской стадии из FROM. */
  base: string;
  /** Имя из `AS <имя>` (в нижнем регистре) или null. */
  name: string | null;
  instructions: Instruction[];
}

export interface ParsedDockerfile {
  /** Инструкции до первого FROM (глобальные ARG). */
  preamble: Instruction[];
  stages: Stage[];
}

export function parseDockerfile(text: string): ParsedDockerfile {
  const logical: string[] = [];
  let buf = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (buf === "" && /^\s*#/.test(line)) continue;
    if (buf !== "" && /^\s*#/.test(line)) continue;
    if (line.endsWith("\\")) {
      buf += `${line.slice(0, -1)} `;
      continue;
    }
    buf += line;
    if (buf.trim() !== "") logical.push(buf.trim());
    buf = "";
  }
  if (buf.trim() !== "") logical.push(buf.trim());

  const preamble: Instruction[] = [];
  const stages: Stage[] = [];
  for (const l of logical) {
    const m = /^(\S+)\s*(.*)$/.exec(l);
    if (!m) continue;
    const op = m[1]!.toUpperCase();
    const args = m[2] ?? "";
    if (op === "FROM") {
      const parts = args.split(/\s+/).filter((p) => !p.startsWith("--"));
      const asIdx = parts.findIndex((p) => p.toUpperCase() === "AS");
      stages.push({
        base: parts[0] ?? "",
        name: asIdx >= 0 ? (parts[asIdx + 1] ?? "").toLowerCase() : null,
        instructions: [],
      });
      continue;
    }
    const target = stages.at(-1);
    if (target) target.instructions.push({ op, args });
    else preamble.push({ op, args });
  }
  return { preamble, stages };
}

/** Стадия по имени и цепочка её предков-стадий (от корня к ней). */
export function stageChain(df: ParsedDockerfile, name: string): Stage[] {
  const chain: Stage[] = [];
  let cur = df.stages.find((s) => s.name === name.toLowerCase());
  const seen = new Set<Stage>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    chain.unshift(cur);
    const base = cur.base.toLowerCase();
    cur = df.stages.find((s) => s.name === base);
  }
  return chain;
}

/** Инструкции стадии с учётом родительских стадий. */
export function stageInstructions(df: ParsedDockerfile, name: string): Instruction[] {
  return stageChain(df, name).flatMap((s) => s.instructions);
}

const unquote = (v: string): string => v.replace(/^"(.*)"$/s, "$1").replace(/^'(.*)'$/s, "$1");

/** Пары имя=значение из ENV/LABEL/ARG (формы `K=V K2=V2`, `K V`, `K`). */
export function keyValues(args: string): Array<{ key: string; value: string | null }> {
  const out: Array<{ key: string; value: string | null }> = [];
  const re = /([^\s=]+)(?:=("(?:[^"\\]|\\.)*"|'[^']*'|\S*))?/g;
  if (!args.includes("=")) {
    const m = /^(\S+)(?:\s+(.*))?$/.exec(args.trim());
    if (m) out.push({ key: unquote(m[1]!), value: m[2] === undefined ? null : unquote(m[2].trim()) });
    return out;
  }
  for (const m of args.matchAll(re)) {
    out.push({ key: unquote(m[1]!), value: m[2] === undefined ? null : unquote(m[2]) });
  }
  return out;
}

/** Все имена из ARG и ENV во всём файле. */
export function argAndEnvNames(df: ParsedDockerfile): string[] {
  const all = [...df.preamble, ...df.stages.flatMap((s) => s.instructions)];
  return all.filter((i) => i.op === "ARG" || i.op === "ENV").flatMap((i) => keyValues(i.args).map((kv) => kv.key));
}
