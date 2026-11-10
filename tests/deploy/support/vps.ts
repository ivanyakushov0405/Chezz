/**
 * Подменный VPS для deploy/remote/*.sh (E02 T-3; design П2–П8, ADR-0011).
 *
 * Шаблон (один на файл тестов): клон `repo` с копией `deploy/` из рабочей копии, коммиты C1 (HEAD, ветка main),
 * C2 (потомок C1, есть в `origin/main` после fetch), SIDE (потомок C1, не в main); `origin.git` — bare, main = C2.
 * `remote.origin.url` = https://github.com/Test-Owner/chezz.git, fetch перенаправлен на bare через `insteadOf`.
 *
 * Каждый тест — свой каталог: `root/` (CHEZZ_ROOT: repo, env, state), `backups/` (CHEZZ_BACKUP_DIR),
 * `bin/` (подмены docker, curl, flock, setsid, sleep, df — первыми в PATH), `cfg/` (сценарий подмен), `calls.log`.
 * git — настоящий.
 *
 * Файлы сценария в `cfg/` (читают подмены, см. support/fakes/):
 *   running         — запущенные сервисы compose, по строке (меняют up / rm -sfv / stop);
 *   revisions       — «digest revision» по строке (docker image inspect; up пишет current_version);
 *   bad_versions    — revision «плохих» образов; bad_mode — up|metrics|health|health2|hsts|csp|restarts;
 *   pull_fail       — подстроки, при которых docker pull → 1;
 *   lock_busy       — flock → занято; tamper — первая подмена переписывает deploy/remote/*.sh клона;
 *   metrics_extra   — строки /metrics prod (chezz_games_active …); metrics_down — curl /metrics → 7;
 *   dump, dump_code — stdout и код pg_dump; seed_code, load_code, report, up_staging_code.
 */
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, expect } from "vitest";
import { makeTempDir, runScript, toBashPath, writeFake, type RunResult } from "./bash.js";
import { REPO_ROOT, runCmd, tail } from "./exec.js";

export const dg = (c: string): string => `sha256:${c.repeat(64)}`;
/** Образы prod: D0 — позапрошлый, D1 — текущий, D2 — новый; DX — не в истории (revision = C1). */
export const D0 = dg("0");
export const D1 = dg("1");
export const D2 = dg("2");
export const DX = dg("f");
/** Образы staging: app и tools. */
export const DA = dg("a");
export const DT = dg("b");
/** revision образа D0 (не коммит клона). */
export const R0 = "d0".repeat(20);
export const OWNER_URL = "https://github.com/Test-Owner/chezz.git";
export const REGISTRY = "ghcr.io/test-owner";
export const APP_DOMAIN = "chezz.test";

export const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export const PROD_SECRETS: Record<string, string> = {
  APP_ENV: "prod",
  APP_ORIGIN: "https://chezz.test",
  DATABASE_URL: "postgres://app:new-prod-pw@db:5432/chezz",
  POSTGRES_PASSWORD: "new-prod-pw",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  COOKIE_SECRET: "",
  SENTRY_DSN: "",
  APP_DOMAIN,
  ACME_EMAIL: "ops@chezz.test",
  SENTRY_INGEST: "o0.ingest.sentry.io",
  TELEGRAM_BOT_TOKEN: "",
  TELEGRAM_CHAT_ID: "",
  B2_KEY_ID: "",
  B2_APP_KEY: "",
  B2_BUCKET: "",
  BACKUP_REQUIRE_OFFSITE: "",
};

export const STAGING_SECRETS: Record<string, string> = {
  APP_ENV: "staging",
  APP_ORIGIN: "https://staging.chezz.test",
  DATABASE_URL: "postgres://app:new-staging-pw@db-staging:5432/chezz",
  POSTGRES_PASSWORD: "new-staging-pw",
  SEED_TOKEN_SECRET: "seed-secret-value",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  COOKIE_SECRET: "",
  SENTRY_DSN: "",
  RATE_LIMIT_IP_PER_MIN: "100000",
};

/** stdin секретов: строки KEY=VALUE (как `printf '%s=%s\n'` шага SSH). */
export function secrets(base: Record<string, string>, patch: Record<string, string | undefined> = {}): string {
  const merged: Record<string, string | undefined> = { ...base, ...patch };
  return Object.entries(merged)
    .filter((e): e is [string, string] => e[1] !== undefined)
    .map(([k, v]) => `${k}=${v}\n`)
    .join("");
}

const GIT_ENV: Record<string, string> = {
  GIT_AUTHOR_NAME: "tester",
  GIT_AUTHOR_EMAIL: "tester@chezz.test",
  GIT_COMMITTER_NAME: "tester",
  GIT_COMMITTER_EMAIL: "tester@chezz.test",
  GIT_CONFIG_NOSYSTEM: "1",
};

async function git(cwd: string, args: string[]): Promise<string> {
  const r = await runCmd("git", args, { cwd, env: GIT_ENV, timeoutMs: 30_000 });
  if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${tail(r.stdout + r.stderr)}`);
  return r.stdout.trim();
}

const nativeSlash = (p: string): string => p.replaceAll("\\", "/");

interface Template {
  dir: string;
  repo: string;
  c1: string;
  c2: string;
  side: string;
  cleanup: () => Promise<void>;
}

let template: Promise<Template> | undefined;

async function buildTemplate(): Promise<Template> {
  const { dir, cleanup } = await makeTempDir("chezz-vps-tpl-");
  const repo = join(dir, "repo");
  const origin = join(dir, "origin.git");
  await mkdir(repo, { recursive: true });
  await cp(join(REPO_ROOT, "deploy"), join(repo, "deploy"), { recursive: true });
  await git(repo, ["init", "-q", "-b", "main"]);
  await git(repo, ["config", "core.autocrlf", "false"]);
  await git(repo, ["config", "commit.gpgsign", "false"]);
  await git(repo, ["add", "-A"]);
  await git(repo, ["commit", "-q", "-m", "c1"]);
  const c1 = await git(repo, ["rev-parse", "HEAD"]);
  const tree = await git(repo, ["rev-parse", "HEAD^{tree}"]);
  const c2 = await git(repo, ["commit-tree", tree, "-p", c1, "-m", "c2"]);
  const side = await git(repo, ["commit-tree", tree, "-p", c1, "-m", "side"]);
  await git(repo, ["update-ref", "refs/heads/side", side]);
  await git(dir, ["init", "-q", "--bare", origin]);
  await git(repo, ["push", "-q", nativeSlash(origin), `${c2}:refs/heads/main`]);
  await git(repo, ["remote", "add", "origin", OWNER_URL]);
  await git(repo, ["config", `url.${nativeSlash(origin)}.insteadOf`, OWNER_URL]);
  return { dir, repo, c1, c2, side, cleanup };
}

/** Удаляет шаблон файла тестов (afterAll). */
export async function disposeTemplate(): Promise<void> {
  if (!template) return;
  const t = await template.catch(() => undefined);
  template = undefined;
  await t?.cleanup();
}

export type Scenario = "fresh" | "deployed";

export interface Snapshot {
  head: string;
  files: Record<string, string>;
}

export interface Vps {
  dir: string;
  root: string;
  repo: string;
  envDir: string;
  stateDir: string;
  backups: string;
  cfgDir: string;
  logFile: string;
  bin: string;
  c1: string;
  c2: string;
  side: string;
  /** Записать файл сценария подмен (cfg/<name>). */
  setCfg: (name: string, content: string) => Promise<void>;
  setRunning: (services: string[]) => Promise<void>;
  /** Запуск `entry.sh <env>` с `SSH_ORIGINAL_COMMAND` и stdin. */
  entry: (envName: "prod" | "staging", command: string, stdin?: string) => Promise<RunResult>;
  /** Запуск скрипта `deploy/remote/<name>` клона напрямую (backup.sh, staging-ttl.sh). */
  script: (name: string, args?: string[], env?: Record<string, string>) => Promise<RunResult>;
  /** Строки журнала вызовов подмен. */
  calls: () => Promise<string[]>;
  head: () => Promise<string>;
  snapshot: () => Promise<Snapshot>;
  readState: (name: string) => Promise<string | null>;
  readEnv: (name: string) => Promise<string | null>;
  writeState: (name: string, content: string) => Promise<void>;
  writeEnv: (name: string, content: string) => Promise<void>;
  cleanup: () => Promise<void>;
}

const FAKES = ["docker", "curl", "flock", "setsid", "sleep", "df"] as const;

async function readOrNull(p: string): Promise<string | null> {
  return existsSync(p) ? await readFile(p, "utf8") : null;
}

/** Файлы env/ и state/ (без журналов last-*.log и lock) — для «ничего не изменено». */
async function collect(dir: string, prefix: string, out: Record<string, string>): Promise<void> {
  if (!existsSync(dir)) return;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const rel = `${prefix}/${e.name}`;
    if (/^state\/(last-(prod|staging)\.log|lock)$/.test(rel)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await collect(p, rel, out);
    else out[rel] = await readFile(p, "utf8");
  }
}

export async function newVps(scenario: Scenario = "deployed"): Promise<Vps> {
  template ??= buildTemplate();
  const t = await template;
  const { dir, cleanup } = await makeTempDir("chezz-vps-");
  const root = join(dir, "root");
  const repo = join(root, "repo");
  const envDir = join(root, "env");
  const stateDir = join(root, "state");
  const backups = join(dir, "backups");
  const cfgDir = join(dir, "cfg");
  const bin = join(dir, "bin");
  const logFile = join(dir, "calls.log");
  await cp(t.repo, repo, { recursive: true });
  await mkdir(envDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  await mkdir(cfgDir, { recursive: true });
  await writeFile(logFile, "");

  const lib = (await readFile(join(REPO_ROOT, "tests/deploy/support/fakes/lib.sh"), "utf8"))
    .replaceAll("@@CFG@@", toBashPath(cfgDir))
    .replaceAll("@@LOG@@", toBashPath(logFile));
  await writeFile(join(cfgDir, "lib.sh"), lib);
  for (const name of FAKES) {
    const body = (await readFile(join(REPO_ROOT, "tests/deploy/support/fakes", name), "utf8")).replaceAll(
      "@@LIB@@",
      toBashPath(join(cfgDir, "lib.sh")),
    );
    await writeFake(bin, name, body);
  }

  const setCfg = async (name: string, content: string): Promise<void> => {
    await writeFile(join(cfgDir, name), content);
  };
  const setRunning = async (services: string[]): Promise<void> => {
    await setCfg("running", services.map((s) => `${s}\n`).join(""));
  };
  const writeState = async (name: string, content: string): Promise<void> => {
    await writeFile(join(stateDir, name), content);
  };
  const writeEnv = async (name: string, content: string): Promise<void> => {
    await writeFile(join(envDir, name), content);
  };

  await setCfg(
    "revisions",
    [`${D0} ${R0}`, `${D1} ${t.c1}`, `${D2} ${t.c2}`, `${DX} ${t.c1}`, `${DA} ${t.c2}`, `${DT} ${t.c2}`]
      .map((l) => `${l}\n`)
      .join(""),
  );
  await writeEnv("compose.staging.env", "");
  if (scenario === "fresh") {
    await writeEnv("compose.prod.env", "");
    await setRunning([]);
  } else {
    await writeState("prod.image", `${D1}\n`);
    await writeState("prod.image.prev", `${D0}\n`);
    await writeState("prod.repo.prev", `${t.c1}\n`);
    await writeState(
      "prod.history",
      `2026-11-01T10:00:00Z ${D0} ${R0} deploy\n2026-11-02T10:00:00Z ${D1} ${t.c1} deploy\n`,
    );
    await writeEnv(
      "prod.env",
      "APP_ENV=prod\nAPP_ORIGIN=https://chezz.test\nDATABASE_URL=postgres://app:old-prod-pw@db:5432/chezz\nPOSTGRES_PASSWORD=old-prod-pw\n",
    );
    await writeEnv("ops.env", "TELEGRAM_CHAT_ID=old-chat\n");
    await writeEnv(
      "compose.prod.env",
      `PROD_APP_IMAGE=${REGISTRY}/chezz-app@${D1}\nAPP_DOMAIN=${APP_DOMAIN}\nACME_EMAIL=ops@chezz.test\nSENTRY_INGEST=o0.ingest.sentry.io\n`,
    );
    await setRunning(["edge", "db", "app"]);
    await setCfg("current_version", t.c1);
  }

  // Git Bash (bin/bash.exe) ставит /mingw64/bin первым в PATH — там настоящий curl; BASH_ENV возвращает подмены вперёд.
  const bashEnv = join(cfgDir, "bash_env.sh");
  await writeFile(bashEnv, `PATH='${toBashPath(bin)}':"$PATH"
`);
  const baseEnv = (): Record<string, string> => ({ CHEZZ_ROOT: root, CHEZZ_BACKUP_DIR: backups, BASH_ENV: bashEnv });

  const requireScript = (name: string): string => {
    const p = join(repo, "deploy", "remote", name);
    if (!existsSync(join(REPO_ROOT, "deploy", "remote", name))) throw new Error(`нет deploy/remote/${name}`);
    return p;
  };

  return {
    dir,
    root,
    repo,
    envDir,
    stateDir,
    backups,
    cfgDir,
    logFile,
    bin,
    c1: t.c1,
    c2: t.c2,
    side: t.side,
    setCfg,
    setRunning,
    entry: async (envName, command, stdin = "") =>
      await runScript(requireScript("entry.sh"), {
        args: [envName],
        env: { ...baseEnv(), SSH_ORIGINAL_COMMAND: command },
        stdin,
        fakeBin: bin,
        timeoutMs: 55_000,
      }),
    script: async (name, args = [], env = {}) =>
      await runScript(requireScript(name), {
        args,
        env: { ...baseEnv(), ...env },
        fakeBin: bin,
        timeoutMs: 55_000,
      }),
    calls: async () => (await readFile(logFile, "utf8")).split(/\r?\n/).filter((l) => l !== ""),
    head: async () => await git(repo, ["rev-parse", "HEAD"]),
    snapshot: async () => {
      const files: Record<string, string> = {};
      await collect(envDir, "env", files);
      await collect(stateDir, "state", files);
      return { head: await git(repo, ["rev-parse", "HEAD"]), files };
    },
    readState: async (name) => await readOrNull(join(stateDir, name)),
    readEnv: async (name) => await readOrNull(join(envDir, name)),
    writeState,
    writeEnv,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
      await cleanup().catch(() => undefined);
    },
  };
}

/** Непустые строки вывода. */
export const lines = (text: string): string[] => text.split(/\r?\n/).filter((l) => l.trim() !== "");
export const lastLine = (text: string): string => lines(text).at(-1) ?? "";

/** Код выхода и последняя строка `result=<имя>` (AC-20). */
export function expectResult(r: RunResult, code: number, name: string): void {
  expect({ code: r.code, last: lastLine(r.stdout) }, `вывод:\n${tail(r.stdout + r.stderr, 15)}`).toEqual({
    code,
    last: `result=${name}`,
  });
}

/** Строки `KEY=VALUE` env-файла → объект (повтор ключа — ошибка теста). */
export function parseEnvFile(text: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of lines(text ?? "")) {
    const i = l.indexOf("=");
    expect(i, `строка env без "=": ${l}`).toBeGreaterThan(0);
    const k = l.slice(0, i);
    expect(out, `повтор ключа ${k}`).not.toHaveProperty(k);
    out[k] = l.slice(i + 1);
  }
  return out;
}

/** Права файла (POSIX). */
export async function modeOf(p: string): Promise<number> {
  return (await stat(p)).mode & 0o777;
}

/** Вызовы compose (строки журнала docker с `compose`). */
export const composeCalls = (calls: string[]): string[] => calls.filter((c) => c.startsWith("docker compose"));
/**
 * Распознавание вызовов — по ключевым словам П2, порядок и прочие флаги не важны («другие флаги допустимы»).
 */
export const words = (c: string): string[] => c.split(/\s+/).filter((w) => w !== "");
/** В argv есть все слова. */
export const hasWords = (c: string, ...ws: string[]): boolean => {
  const set = new Set(words(c));
  return ws.every((w) => set.has(w));
};
/** Флаг задан: короткий в любой связке (`-sfv` = `-s -f -v`) или длинный. */
export const hasFlag = (c: string, short: string, long?: string): boolean =>
  words(c).some((w) => (/^-[A-Za-z]+$/.test(w) && w.slice(1).includes(short)) || (long !== undefined && w === long));
/** Опция со значением: `-U app`, `-Uapp`, `--opt=v`, `--opt v`. */
export const hasOpt = (c: string, opt: string, value: string): boolean => {
  const w = words(c);
  return w.some((x, i) => (x === opt && w[i + 1] === value) || x === `${opt}${value}` || x === `${opt}=${value}`);
};
export const isCompose = (c: string): boolean => c.startsWith("docker compose ");
export const isUpProd = (c: string): boolean =>
  isCompose(c) && hasWords(c, "up") && words(c).some((w) => w.startsWith("--wait")) && !c.includes("app-staging");
export const isStagingRm = (c: string): boolean =>
  isCompose(c) &&
  hasWords(c, "rm", "app-staging", "db-staging") &&
  hasFlag(c, "s", "--stop") &&
  hasFlag(c, "f", "--force") &&
  hasFlag(c, "v", "--volumes");
export const isPgDump = (c: string): boolean =>
  isCompose(c) && hasWords(c, "exec", "db", "pg_dump") && hasOpt(c, "-U", "app") && hasOpt(c, "-d", "chezz") && /(^|\s)(-Fc|--format=c|--format=custom)(\s|$)/.test(c);
/** docker pull образа `ghcr.io/<owner>/<пакет>@<digest>`. */
export const isPullOf = (c: string, ref: string): boolean => c.startsWith("docker pull ") && words(c).includes(ref);
/** docker image prune -af --filter until=168h. */
export const isPrune = (c: string): boolean =>
  c.startsWith("docker image prune") && hasFlag(c, "a", "--all") && hasFlag(c, "f", "--force") && /until=168h/.test(c);
/** Любой вызов, меняющий систему (pull, prune, compose up/rm/stop/run/exec; клон проверяется через HEAD). */
export const isMutating = (c: string): boolean =>
  /^docker (pull|image prune)/.test(c) || (isCompose(c) && ["up", "rm", "stop", "run", "exec"].some((w) => hasWords(c, w)));

/** Секунд назад → UTC ISO-8601 Z без миллисекунд. */
export const isoAgo = (seconds: number): string =>
  new Date(Date.now() - seconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * Регистрирует очистку (afterEach — каталоги тестов, afterAll — шаблон) и возвращает фабрику VPS.
 * Вызывать на верхнем уровне файла тестов.
 */
export function useVps(): (scenario?: Scenario) => Promise<Vps> {
  const opened: Vps[] = [];
  afterEach(async () => {
    for (const v of opened.splice(0)) await v.cleanup();
  });
  afterAll(disposeTemplate);
  return async (scenario: Scenario = "deployed") => {
    const v = await newVps(scenario);
    opened.push(v);
    return v;
  };
}
