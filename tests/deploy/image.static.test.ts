// Статические проверки deploy/Dockerfile и .dockerignore (E02 T-2; OPERATIONS §6.2; design П9).
// Сборка и содержимое образа — image.image.test.ts (проект deploy-image).
import { describe, expect, it } from "vitest";
import {
  argAndEnvNames,
  keyValues,
  parseDockerfile,
  readRepoFile,
  stageChain,
  stageInstructions,
  type Instruction,
  type ParsedDockerfile,
} from "./support/index.ts";

const loadDockerfile = async (): Promise<ParsedDockerfile> => parseDockerfile(await readRepoFile("deploy/Dockerfile"));

const ofOp = (ins: Instruction[], op: string): Instruction[] => ins.filter((i) => i.op === op);

/** Значения ENV стадии (последнее присваивание побеждает). */
function envOf(ins: Instruction[]): Map<string, string | null> {
  const env = new Map<string, string | null>();
  for (const i of ofOp(ins, "ENV")) for (const kv of keyValues(i.args)) env.set(kv.key, kv.value);
  return env;
}

function labelsOf(ins: Instruction[]): Map<string, string | null> {
  const l = new Map<string, string | null>();
  for (const i of ofOp(ins, "LABEL")) for (const kv of keyValues(i.args)) l.set(kv.key, kv.value);
  return l;
}

const lastOf = (ins: Instruction[], op: string): Instruction | undefined => ofOp(ins, op).at(-1);

const REF_APP_VERSION = /^\$\{?APP_VERSION\}?$/;

describe("deploy/Dockerfile — статически", () => {
  it("AC-1: база node:24-bookworm-slim, есть цели app и tools", async () => {
    const df = await loadDockerfile();
    const names = df.stages.map((s) => s.name);
    expect(names).toContain("app");
    expect(names).toContain("tools");
    const roots = ["app", "tools"].map((n) => stageChain(df, n)[0]!.base);
    for (const base of roots) expect(base).toBe("node:24-bookworm-slim");
    // Ни одна стадия не берёт другой node-образ.
    for (const s of df.stages) {
      if (/^node:/.test(s.base)) expect(s.base).toBe("node:24-bookworm-slim");
    }
  });

  it("AC-2: цель app — USER node, EXPOSE 3000 9464, ENV HOST и METRICS_HOST = 0.0.0.0", async () => {
    const df = await loadDockerfile();
    const ins = stageInstructions(df, "app");
    expect(lastOf(ins, "USER")?.args.trim()).toMatch(/^(node|1000)(:(node|1000))?$/);
    const exposed = ofOp(ins, "EXPOSE").flatMap((i) => i.args.split(/\s+/).map((p) => p.replace(/\/tcp$/, "")));
    expect(exposed).toEqual(expect.arrayContaining(["3000", "9464"]));
    const env = envOf(ins);
    expect(env.get("HOST")).toBe("0.0.0.0");
    expect(env.get("METRICS_HOST")).toBe("0.0.0.0");
  });

  it("AC-2: цель app — ARG APP_VERSION → ENV APP_VERSION и LABEL org.opencontainers.image.revision", async () => {
    const df = await loadDockerfile();
    const ins = [...df.preamble, ...stageInstructions(df, "app")];
    const args = ofOp(ins, "ARG").flatMap((i) => keyValues(i.args).map((kv) => kv.key));
    expect(args).toContain("APP_VERSION");
    expect(envOf(stageInstructions(df, "app")).get("APP_VERSION") ?? "").toMatch(REF_APP_VERSION);
    expect(labelsOf(stageInstructions(df, "app")).get("org.opencontainers.image.revision") ?? "").toMatch(REF_APP_VERSION);
  });

  it("AC-2: цель app — CMD в exec-форме начинается с node --enable-source-maps", async () => {
    const df = await loadDockerfile();
    const cmd = lastOf(stageInstructions(df, "app"), "CMD");
    expect(cmd, "нет CMD у цели app").toBeDefined();
    const parsed = JSON.parse(cmd!.args) as unknown;
    expect(Array.isArray(parsed)).toBe(true);
    const argv = parsed as string[];
    expect(argv.slice(0, 2)).toEqual(["node", "--enable-source-maps"]);
    expect(argv).toContain("apps/server/src/main.ts");
  });

  it("AC-4: цель tools — USER node", async () => {
    const df = await loadDockerfile();
    expect(lastOf(stageInstructions(df, "tools"), "USER")?.args.trim()).toMatch(/^(node|1000)(:(node|1000))?$/);
  });

  it("AC-6: нет ARG/ENV с именами секретов (*_SECRET, *PASSWORD*, DATABASE_URL, *_KEY, *TOKEN*)", async () => {
    const df = await loadDockerfile();
    const names = argAndEnvNames(df);
    expect(names.length).toBeGreaterThan(0);
    const secretLike = names.filter((n) => /_SECRET$|PASSWORD|^DATABASE_URL$|_KEY$|TOKEN/i.test(n));
    expect(secretLike).toEqual([]);
  });

  it("EC-37: ARG APP_VERSION без значения по умолчанию — образ без --build-arg не получает версию", async () => {
    const df = await loadDockerfile();
    const all = [...df.preamble, ...df.stages.flatMap((s) => s.instructions)];
    const decl = ofOp(all, "ARG")
      .flatMap((i) => keyValues(i.args))
      .filter((kv) => kv.key === "APP_VERSION");
    expect(decl.length).toBeGreaterThan(0);
    for (const kv of decl) expect(kv.value ?? "").toBe("");
    // ENV APP_VERSION — только из ARG, не литерал.
    for (const s of df.stages) {
      const v = envOf(s.instructions).get("APP_VERSION");
      if (v !== undefined) expect(v ?? "").toMatch(REF_APP_VERSION);
    }
  });
});

describe(".dockerignore — статически", () => {
  const patterns = async (): Promise<string[]> =>
    (await readRepoFile(".dockerignore"))
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#"))
      .map((l) => l.replace(/^\/+/, "").replace(/\/+$/, ""));

  it("AC-3: исключены .git, .env*, node_modules, docs, .claude", async () => {
    const p = await patterns();
    const has = (...alts: string[]): boolean => alts.some((a) => p.includes(a));
    expect(has(".git", "**/.git"), ".git").toBe(true);
    expect(has(".env*", "**/.env*"), ".env*").toBe(true);
    expect(has("node_modules", "**/node_modules"), "node_modules").toBe(true);
    expect(has("docs", "**/docs"), "docs").toBe(true);
    expect(has(".claude", "**/.claude"), ".claude").toBe(true);
  });

  it("AC-3: .dockerignore не возвращает секретные файлы исключением (!.env*)", async () => {
    const p = await patterns();
    expect(p.filter((l) => /^!.*\.env/.test(l))).toEqual([]);
  });
});
