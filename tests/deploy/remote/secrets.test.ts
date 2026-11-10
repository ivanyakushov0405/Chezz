// Секреты в stdin и файлы env (E02 T-3; OPERATIONS §7, §6.1; design П4, A2): проверка по deploy/env.allowlist,
// раскладка по файлам, права, атомарная запись, шаблон compose.staging.env.
import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  D2,
  DA,
  DT,
  PROD_SECRETS,
  REGISTRY,
  STAGING_SECRETS,
  composeCalls,
  expectResult,
  lastLine,
  isMutating,
  modeOf,
  parseEnvFile,
  secrets,
  useVps,
  writeFake,
  type Vps,
} from "../support/index.ts";

const vps = useVps();

const deployCmd = (v: Vps): string => `deploy ${v.c2} ${D2} ${v.c1}`;
const UP = `up ${DA} ${DT}`;

/** EC-9, A2: ключ prod — неверные секреты (stdin целиком). */
const BAD_PROD: Array<[string, string]> = [
  ["ключ не из allowlist", secrets(PROD_SECRETS, { EVIL_KEY: "1" })],
  ["ключ раздела [staging] (SEED_TOKEN_SECRET)", secrets(PROD_SECRETS, { SEED_TOKEN_SECRET: "x" })],
  ["ключ раздела [staging] (RATE_LIMIT_IP_PER_MIN)", secrets(PROD_SECRETS, { RATE_LIMIT_IP_PER_MIN: "1" })],
  ["PROD_APP_IMAGE в stdin", secrets(PROD_SECRETS, { PROD_APP_IMAGE: "evil/image@sha256:x" })],
  ["ключ не ^[A-Z][A-Z0-9_]*$", `${secrets(PROD_SECRETS)}cookie_secret=x\n`],
  ["строка без =", `${secrets(PROD_SECRETS)}JUST_TEXT\n`],
  ["значение с переводом строки (продолжение без =)", secrets(PROD_SECRETS, { COOKIE_SECRET: "abc\ndef" })],
  ["значение с $", secrets(PROD_SECRETS, { COOKIE_SECRET: "ab$cd" })],
  ["значение с одинарной кавычкой", secrets(PROD_SECRETS, { COOKIE_SECRET: "ab'cd" })],
  ["значение с двойной кавычкой", secrets(PROD_SECRETS, { COOKIE_SECRET: 'ab"cd' })],
  ["значение с обратной кавычкой", secrets(PROD_SECRETS, { COOKIE_SECRET: "ab`cd" })],
  ["значение с \\", secrets(PROD_SECRETS, { COOKIE_SECRET: "ab\\cd" })],
  ["повтор ключа", `${secrets(PROD_SECRETS)}APP_ORIGIN=https://other.chezz.test\n`],
  ["обязательный DATABASE_URL отсутствует", secrets(PROD_SECRETS, { DATABASE_URL: undefined })],
  ["обязательный POSTGRES_PASSWORD пуст", secrets(PROD_SECRETS, { POSTGRES_PASSWORD: "" })],
  ["обязательный [ops] SENTRY_INGEST отсутствует", secrets(PROD_SECRETS, { SENTRY_INGEST: undefined })],
  ["обязательный [ops] APP_DOMAIN пуст", secrets(PROD_SECRETS, { APP_DOMAIN: "" })],
  ["APP_ENV ≠ prod", secrets(PROD_SECRETS, { APP_ENV: "staging" })],
  ["пустой stdin", ""],
];

/** EC-9, A2: ключ staging — неверные секреты. */
const BAD_STAGING: Array<[string, string]> = [
  ["ключ [ops] (APP_DOMAIN)", secrets(STAGING_SECRETS, { APP_DOMAIN: "chezz.test" })],
  ["ключ [ops] (B2_KEY_ID)", secrets(STAGING_SECRETS, { B2_KEY_ID: "k" })],
  ["STAGING_APP_IMAGE в stdin", secrets(STAGING_SECRETS, { STAGING_APP_IMAGE: "evil/image@sha256:x" })],
  ["ключ не из allowlist", secrets(STAGING_SECRETS, { EVIL_KEY: "1" })],
  ["значение с $", secrets(STAGING_SECRETS, { SEED_TOKEN_SECRET: "a$b" })],
  ["значение с переводом строки", secrets(STAGING_SECRETS, { SEED_TOKEN_SECRET: "a\nb" })],
  ["значение с обратной кавычкой", secrets(STAGING_SECRETS, { SEED_TOKEN_SECRET: "a`b" })],
  ["обязательный SEED_TOKEN_SECRET отсутствует", secrets(STAGING_SECRETS, { SEED_TOKEN_SECRET: undefined })],
  ["обязательный DATABASE_URL пуст", secrets(STAGING_SECRETS, { DATABASE_URL: "" })],
  ["APP_ENV ≠ staging", secrets(STAGING_SECRETS, { APP_ENV: "prod" })],
];

async function expectRejected(v: Vps, envName: "prod" | "staging", cmd: string, stdin: string): Promise<void> {
  const before = await v.snapshot();
  const r = await v.entry(envName, cmd, stdin);
  expectResult(r, 2, "bad_command");
  expect(await v.snapshot(), "файлы env/ и state/ не изменены").toEqual(before);
  expect((await v.calls()).filter(isMutating), "ничего не выполнено").toEqual([]);
}

describe("секреты prod — отказ (EC-9, AC-23)", { timeout: 60_000 }, () => {
  it.each(BAD_PROD)("EC-9/AC-23: prod deploy, %s → код 2, файлы env не изменены", async (_name, stdin) => {
    const v = await vps("deployed");
    await expectRejected(v, "prod", deployCmd(v), stdin);
  });
});

describe("секреты staging — отказ (EC-9, AC-23)", { timeout: 60_000 }, () => {
  it.each(BAD_STAGING)("EC-9/AC-23: staging up, %s → код 2, файлы env не изменены", async (_name, stdin) => {
    const v = await vps("deployed");
    await expectRejected(v, "staging", UP, stdin);
  });
});

describe("раскладка секретов prod (AC-24, EC-10)", { timeout: 60_000 }, () => {
  const PATCH = { COOKIE_SECRET: "cookie-value", TELEGRAM_CHAT_ID: "new-chat", SENTRY_DSN: "https://k@o0.ingest.sentry.io/1" };

  it("AC-24/EC-10: [prod] → prod.env, APP_DOMAIN/ACME_EMAIL/SENTRY_INGEST + PROD_APP_IMAGE → compose.prod.env, прочие [ops] → ops.env; пустые не пишутся", async () => {
    const v = await vps("deployed");
    const r = await v.entry("prod", deployCmd(v), secrets(PROD_SECRETS, PATCH));
    expectResult(r, 0, "ok");
    expect(parseEnvFile(await v.readEnv("prod.env"))).toEqual({
      APP_ENV: "prod",
      APP_ORIGIN: "https://chezz.test",
      DATABASE_URL: "postgres://app:new-prod-pw@db:5432/chezz",
      POSTGRES_PASSWORD: "new-prod-pw",
      COOKIE_SECRET: "cookie-value",
      SENTRY_DSN: "https://k@o0.ingest.sentry.io/1",
    });
    expect(parseEnvFile(await v.readEnv("compose.prod.env"))).toEqual({
      APP_DOMAIN: "chezz.test",
      ACME_EMAIL: "ops@chezz.test",
      SENTRY_INGEST: "o0.ingest.sentry.io",
      PROD_APP_IMAGE: `${REGISTRY}/chezz-app@${D2}`,
    });
    expect(parseEnvFile(await v.readEnv("ops.env"))).toEqual({ TELEGRAM_CHAT_ID: "new-chat" });
  });

  it("EC-10: пустые optional (GOOGLE_*, COOKIE_SECRET, TELEGRAM_*, B2_*) не блокируют выкатку и не пишутся", async () => {
    const v = await vps("deployed");
    const r = await v.entry("prod", deployCmd(v), secrets(PROD_SECRETS));
    expectResult(r, 0, "ok");
    const all = { ...parseEnvFile(await v.readEnv("prod.env")), ...parseEnvFile(await v.readEnv("ops.env")) };
    for (const k of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "COOKIE_SECRET", "TELEGRAM_BOT_TOKEN", "B2_KEY_ID", "B2_BUCKET"]) {
      expect(all, k).not.toHaveProperty(k);
    }
  });

  it.skipIf(process.platform === "win32")("AC-24: права prod.env 600, ops.env и compose.prod.env 640", async () => {
    const v = await vps("deployed");
    expectResult(await v.entry("prod", deployCmd(v), secrets(PROD_SECRETS, PATCH)), 0, "ok");
    expect((await modeOf(join(v.envDir, "prod.env"))).toString(8)).toBe("600");
    expect((await modeOf(join(v.envDir, "ops.env"))).toString(8)).toBe("640");
    expect((await modeOf(join(v.envDir, "compose.prod.env"))).toString(8)).toBe("640");
  });

  it.skipIf(process.platform === "win32")("AC-24: запись атомарная — файл заменён (новый inode), а не переписан на месте", async () => {
    const v = await vps("deployed");
    const ino = async (n: string): Promise<number> => (await stat(join(v.envDir, n))).ino;
    const before = { prod: await ino("prod.env"), compose: await ino("compose.prod.env") };
    expectResult(await v.entry("prod", deployCmd(v), secrets(PROD_SECRETS, PATCH)), 0, "ok");
    expect(await ino("prod.env")).not.toBe(before.prod);
    expect(await ino("compose.prod.env")).not.toBe(before.compose);
  });

  it("AC-24: после записи в env/ нет временных файлов", async () => {
    const v = await vps("deployed");
    expectResult(await v.entry("prod", deployCmd(v), secrets(PROD_SECRETS, PATCH)), 0, "ok");
    expect((await readdir(v.envDir)).sort()).toEqual(
      ["compose.prod.env", "compose.staging.env", "ops.env", "prod.env"].sort(),
    );
  });
});

describe("раскладка секретов staging (AC-24, AC-25, EC-38)", { timeout: 60_000 }, () => {
  it("AC-25: up пишет только staging.env и compose.staging.env; compose.staging.env — ровно две строки по шаблону", async () => {
    const v = await vps("deployed");
    const before = await v.snapshot();
    const r = await v.entry("staging", UP, secrets(STAGING_SECRETS));
    expectResult(r, 0, "ok");
    const text = (await v.readEnv("compose.staging.env")) ?? "";
    expect(text.split(/\r?\n/).filter((l) => l !== "").sort()).toEqual(
      [`STAGING_APP_IMAGE=${REGISTRY}/chezz-app-staging@${DA}`, `STAGING_TOOLS_IMAGE=${REGISTRY}/chezz-tools-staging@${DT}`].sort(),
    );
    expect(parseEnvFile(await v.readEnv("staging.env"))).toEqual({
      APP_ENV: "staging",
      APP_ORIGIN: "https://staging.chezz.test",
      DATABASE_URL: "postgres://app:new-staging-pw@db-staging:5432/chezz",
      POSTGRES_PASSWORD: "new-staging-pw",
      SEED_TOKEN_SECRET: "seed-secret-value",
      RATE_LIMIT_IP_PER_MIN: "100000",
    });
    const after = await v.snapshot();
    const keep = (s: typeof before): Record<string, string> =>
      Object.fromEntries(
        Object.entries(s.files).filter(([k]) => !["env/staging.env", "env/compose.staging.env", "state/staging.started"].includes(k)),
      );
    expect(keep(after), "prod.env, ops.env, compose.prod.env, state prod.* не изменены").toEqual(keep(before));
    expect(after.head).toBe(before.head);
  });

  it("AC-25: down не меняет файлов env/", async () => {
    const v = await vps("deployed");
    await v.setRunning(["edge", "db", "app", "app-staging", "db-staging"]);
    const before = await v.snapshot();
    expectResult(await v.entry("staging", "down"), 0, "ok");
    const after = await v.snapshot();
    const envOnly = (s: typeof before): Record<string, string> =>
      Object.fromEntries(Object.entries(s.files).filter(([k]) => k.startsWith("env/")));
    expect(envOnly(after)).toEqual(envOnly(before));
  });

  it("EC-38: прежний compose.staging.env с чужими ключами (PROD_APP_IMAGE, APP_DOMAIN) после up — только две строки шаблона", async () => {
    const v = await vps("deployed");
    await v.writeEnv("compose.staging.env", "PROD_APP_IMAGE=evil/app@sha256:x\nAPP_DOMAIN=evil.test\nSTAGING_APP_IMAGE=old\n");
    expectResult(await v.entry("staging", UP, secrets(STAGING_SECRETS)), 0, "ok");
    expect(Object.keys(parseEnvFile(await v.readEnv("compose.staging.env"))).sort()).toEqual([
      "STAGING_APP_IMAGE",
      "STAGING_TOOLS_IMAGE",
    ]);
  });

  it("EC-38: compose вызывается с --env-file compose.staging.env, затем compose.prod.env (prod последним)", async () => {
    const v = await vps("deployed");
    expectResult(await v.entry("staging", UP, secrets(STAGING_SECRETS)), 0, "ok");
    const calls = composeCalls(await v.calls());
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c, c).toMatch(/ -p chezz /);
      expect(c, c).toMatch(/ -f \S*\/repo\/deploy\/compose\.yml /);
      const s = c.indexOf("--env-file ");
      const staging = c.indexOf("compose.staging.env");
      const prod = c.indexOf("compose.prod.env");
      expect(s >= 0 && staging > s && prod > staging, `порядок env-файлов: ${c}`).toBe(true);
    }
  });

  it.skipIf(process.platform === "win32")("AC-24: права staging.env 600, compose.staging.env 640", async () => {
    const v = await vps("deployed");
    expectResult(await v.entry("staging", UP, secrets(STAGING_SECRETS)), 0, "ok");
    expect((await modeOf(join(v.envDir, "staging.env"))).toString(8)).toBe("600");
    expect((await modeOf(join(v.envDir, "compose.staging.env"))).toString(8)).toBe("640");
  });
});

/** Результаты таблицы кодов П3. */
const RESULTS = ["ok", "rolled_back", "bad_command", "prod_busy", "broken", "backup_failed", "base_mismatch", "prod_missing", "pull_failed", "locked"];

describe("deploy — провал записи env (шаг 6) и пустые compose-файлы (OPERATIONS §5 п.7, П6)", { timeout: 60_000 }, () => {
  it("П6 п.6/п.12: запись env-файлов не удалась (mv в env/ упал) → код ≠ 0, result= есть, клон на прежнем HEAD (не на устаревшем prod.repo.prev), state не изменён", async () => {
    const v = await vps("deployed");
    // prod.repo.prev — от позапрошлой выкатки и ≠ HEAD: возврат клона на него был бы ошибкой (клон ещё не менялся).
    await v.writeState("prod.repo.prev", `${v.side}\n`);
    await writeFake(
      v.bin,
      "mv",
      `for last; do :; done\ncase "$last" in */env/*) echo "mv: cannot move: Permission denied" >&2; exit 1 ;; esac\ncommand -p mv "$@"`,
    );
    const state = (s: Awaited<ReturnType<Vps["snapshot"]>>): Record<string, string> =>
      // state/last-backup меняет бэкап pre-deploy (шаг 5) — законно.
      Object.fromEntries(Object.entries(s.files).filter(([k]) => k.startsWith("state/") && k !== "state/last-backup"));
    const before = await v.snapshot();
    const r = await v.entry("prod", deployCmd(v), secrets(PROD_SECRETS));
    expect(r.code, r.stdout + r.stderr).not.toBe(0);
    expect(RESULTS.map((x) => `result=${x}`), `последняя строка: ${lastLine(r.stdout)}`).toContain(lastLine(r.stdout));
    expect(await v.head(), "клон не переключался").toBe(v.c1);
    expect(state(await v.snapshot()), "state/ не изменён").toEqual(state(before));
  });

  it("OPERATIONS §5 п.7: нет compose.prod.env и compose.staging.env → deploy prod их пересоздаёт, код 0", async () => {
    const v = await vps("deployed");
    await rm(join(v.envDir, "compose.prod.env"));
    await rm(join(v.envDir, "compose.staging.env"));
    expectResult(await v.entry("prod", deployCmd(v), secrets(PROD_SECRETS)), 0, "ok");
    expect(parseEnvFile(await v.readEnv("compose.prod.env"))["PROD_APP_IMAGE"]).toBe(`${REGISTRY}/chezz-app@${D2}`);
    expect(await v.readEnv("compose.staging.env"), "compose.staging.env создан").not.toBeNull();
  });

  it("OPERATIONS §5 п.7: нет compose.staging.env → staging down его пересоздаёт, код 0", async () => {
    const v = await vps("deployed");
    await v.setRunning(["edge", "db", "app", "app-staging", "db-staging"]);
    await rm(join(v.envDir, "compose.staging.env"));
    expectResult(await v.entry("staging", "down"), 0, "ok");
    expect(await v.readEnv("compose.staging.env"), "compose.staging.env создан").not.toBeNull();
  });

  it.skipIf(process.platform === "win32")("OPERATIONS §5 п.7: пересозданные compose.prod.env и compose.staging.env — права 640", async () => {
    const v = await vps("deployed");
    await rm(join(v.envDir, "compose.prod.env"));
    await rm(join(v.envDir, "compose.staging.env"));
    expectResult(await v.entry("prod", deployCmd(v), secrets(PROD_SECRETS)), 0, "ok");
    expect((await modeOf(join(v.envDir, "compose.prod.env"))).toString(8)).toBe("640");
    expect((await modeOf(join(v.envDir, "compose.staging.env"))).toString(8)).toBe("640");
  });
});
