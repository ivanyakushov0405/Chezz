// deploy/remote/entry.sh (E02 T-3; OPERATIONS §9.3; design П2, П3, A5; ADR-0011): белый список команд,
// копия remote/ в mktemp -d, setsid и журнал, блокировка flock, строка result=.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  D0,
  D1,
  D2,
  DA,
  DT,
  PROD_SECRETS,
  STAGING_SECRETS,
  expectResult,
  hasOpt,
  isMutating,
  lastLine,
  lines,
  secrets,
  useVps,
  type Vps,
} from "../support/index.ts";

const vps = useVps();

type Cmd = (v: Vps) => string;

/** EC-8: ключ prod — команды не из белого списка. */
const BAD_PROD: Array<[string, Cmd]> = [
  ["чужая команда", () => "rm -rf /"],
  ["пустая команда", () => ""],
  ["неизвестная подкоманда", () => "shell"],
  ["SHA из 39 hex", (v) => `deploy ${v.c2.slice(1)} ${D2} ${v.c1}`],
  ["SHA в верхнем регистре", (v) => `deploy ${v.c2.toUpperCase()} ${D2} ${v.c1}`],
  ["digest короче 64 hex", (v) => `deploy ${v.c2} sha256:abc ${v.c1}`],
  ["digest без префикса sha256:", (v) => `deploy ${v.c2} ${"2".repeat(64)} ${v.c1}`],
  ["digest в верхнем регистре", (v) => `deploy ${v.c2} sha256:${"A".repeat(64)} ${v.c1}`],
  ["база не SHA и не bootstrap", (v) => `deploy ${v.c2} ${D2} main`],
  ["нет базы", (v) => `deploy ${v.c2} ${D2}`],
  ["четвёртый аргумент не force", (v) => `deploy ${v.c2} ${D2} ${v.c1} now`],
  ["лишний аргумент после force", (v) => `deploy ${v.c2} ${D2} ${v.c1} force extra`],
  ["rollback с двумя аргументами", () => `rollback ${D0} ${D1}`],
  ["rollback не с digest", () => "rollback latest"],
  ["status с аргументом", () => "status now"],
  ["метасимвол ;", (v) => `deploy ${v.c2} ${D2} ${v.c1}; touch /tmp/chezz-x`],
  ["метасимвол $( )", () => "status $(id)"],
  ["обратная кавычка", () => "status `id`"],
  ["метасимвол |", () => "status | cat"],
  ["метасимвол &&", () => "status && id"],
  ["перевод строки внутри команды", () => "status\nrollback"],
];

/** EC-8: ключ staging — команды не из белого списка. */
const BAD_STAGING: Array<[string, Cmd]> = [
  ["чужая команда", () => "bash -i"],
  ["пустая команда", () => ""],
  ["up с одним digest", () => `up ${DA}`],
  ["up с лишним аргументом", () => `up ${DA} ${DT} extra`],
  ["up не с digest", () => `up ${DA} latest`],
  ["down с аргументом", () => "down now"],
  ["load с аргументом", () => "load 150"],
  ["метасимвол ;", () => "down; id"],
  ["метасимвол $( )", () => `up ${DA} $(id)`],
];

async function expectBadCommand(v: Vps, envName: "prod" | "staging", command: string, stdin = ""): Promise<void> {
  const before = await v.snapshot();
  const r = await v.entry(envName, command, stdin);
  expectResult(r, 2, "bad_command");
  expect(await v.snapshot(), "state/, env/ и клон не изменены").toEqual(before);
  expect((await v.calls()).filter(isMutating), "ничего не выполнено").toEqual([]);
}

describe("entry.sh prod — белый список", { timeout: 60_000 }, () => {
  it.each(BAD_PROD)("EC-8/AC-17: prod, %s → код 2, result=bad_command, ничего не изменено", async (_name, cmd) => {
    const v = await vps("deployed");
    await expectBadCommand(v, "prod", cmd(v), secrets(PROD_SECRETS));
  });
});

describe("entry.sh staging — белый список", { timeout: 60_000 }, () => {
  it.each(BAD_STAGING)("EC-8/AC-17: staging, %s → код 2, result=bad_command, ничего не изменено", async (_name, cmd) => {
    const v = await vps("deployed");
    await expectBadCommand(v, "staging", cmd(v), secrets(STAGING_SECRETS));
  });
});

describe("entry.sh — ключ среды и команда другой среды (AC-18)", { timeout: 60_000 }, () => {
  it("AC-18/EC-8: ключ staging с командой deploy → код 2", async () => {
    const v = await vps("deployed");
    await expectBadCommand(v, "staging", `deploy ${v.c2} ${D2} ${v.c1}`, secrets(PROD_SECRETS));
  });

  it("AC-18/EC-8: ключ staging с командой rollback → код 2", async () => {
    const v = await vps("deployed");
    await expectBadCommand(v, "staging", "rollback");
  });

  it("AC-18/EC-8: ключ staging с командой rollback <digest> → код 2", async () => {
    const v = await vps("deployed");
    await expectBadCommand(v, "staging", `rollback ${D0}`);
  });

  it("AC-18/EC-8: ключ prod с командой up → код 2", async () => {
    const v = await vps("deployed");
    await expectBadCommand(v, "prod", `up ${DA} ${DT}`, secrets(STAGING_SECRETS));
  });

  it("AC-18/EC-8: ключ prod с командой down → код 2", async () => {
    const v = await vps("deployed");
    await v.setRunning(["edge", "db", "app", "app-staging", "db-staging"]);
    await expectBadCommand(v, "prod", "down");
  });

  it("AC-18/EC-8: ключ prod с командой load → код 2", async () => {
    const v = await vps("deployed");
    await v.setRunning(["edge", "db", "app", "app-staging", "db-staging"]);
    await expectBadCommand(v, "prod", "load");
  });
});

describe("entry.sh — копия remote/ во временном каталоге (AC-19, EC-29)", { timeout: 60_000 }, () => {
  it("AC-19/EC-29: правка deploy/remote/*.sh клона во время staging down не меняет поведение", async () => {
    const v = await vps("deployed");
    await v.setRunning(["edge", "db", "app", "app-staging", "db-staging"]);
    await v.setCfg("tamper", "");
    const r = await v.entry("staging", "down");
    expect(existsSync(join(v.cfgDir, "tampered")), "подмена успела переписать клон").toBe(true);
    const clone = await readFile(join(v.repo, "deploy", "remote", "deploy.sh"), "utf8").catch(() => "");
    expect(clone, "клон действительно изменён").toContain("result=tampered");
    expect(r.stdout).not.toContain("tampered");
    expectResult(r, 0, "ok");
  });

  it("AC-19/EC-29: правка клона во время prod rollback не меняет поведение", async () => {
    const v = await vps("deployed");
    await v.setCfg("tamper", "");
    const r = await v.entry("prod", "rollback");
    expect(existsSync(join(v.cfgDir, "tampered")), "подмена успела переписать клон").toBe(true);
    expect(r.stdout).not.toContain("tampered");
    expectResult(r, 0, "ok");
    expect((await v.readState("prod.image"))?.trim()).toBe(D0);
  });
});

describe("entry.sh — result= и журнал (AC-20, EC-28)", { timeout: 60_000 }, () => {
  const CASES: Array<[string, number, string, (v: Vps) => Promise<{ env: "prod" | "staging"; cmd: string; stdin?: string }>]> = [
    ["ok (staging down)", 0, "ok", () => Promise.resolve({ env: "staging", cmd: "down" })],
    ["bad_command", 2, "bad_command", () => Promise.resolve({ env: "prod", cmd: "nope" })],
    [
      "prod_busy",
      3,
      "prod_busy",
      async (v) => {
        await v.setCfg("metrics_extra", "chezz_games_active 11\n");
        return { env: "prod", cmd: `deploy ${v.c2} ${D2} ${v.c1}`, stdin: secrets(PROD_SECRETS) };
      },
    ],
    [
      "base_mismatch",
      6,
      "base_mismatch",
      (v) => Promise.resolve({ env: "prod", cmd: `deploy ${v.c2} ${D2} ${v.c2}`, stdin: secrets(PROD_SECRETS) }),
    ],
    [
      "pull_failed",
      8,
      "pull_failed",
      async (v) => {
        await v.setCfg("pull_fail", `chezz-app@${D2}\n`);
        return { env: "prod", cmd: `deploy ${v.c2} ${D2} ${v.c1}`, stdin: secrets(PROD_SECRETS) };
      },
    ],
    [
      "locked",
      9,
      "locked",
      async (v) => {
        await v.setCfg("lock_busy", "");
        return { env: "staging", cmd: "down" };
      },
    ],
  ];

  it.each(CASES)(
    "AC-20: %s → код и последняя строка result=<имя>; журнал state/last-<среда>.log кончается той же строкой",
    async (_name, code, result, prepare) => {
      const v = await vps("deployed");
      const { env, cmd, stdin } = await prepare(v);
      const r = await v.entry(env, cmd, stdin ?? "");
      expectResult(r, code, result);
      const journal = await v.readState(`last-${env}.log`);
      expect(journal, `нет state/last-${env}.log`).not.toBeNull();
      expect(lastLine(journal ?? "")).toBe(`result=${result}`);
    },
  );

  it("AC-20: staging up до первой выкатки prod → код 7, result=prod_missing", async () => {
    const v = await vps("fresh");
    const r = await v.entry("staging", `up ${DA} ${DT}`, secrets(STAGING_SECRETS));
    expectResult(r, 7, "prod_missing");
  });

  it("EC-28: долгая команда идёт через setsid; журнал перезаписан и содержит вывод до result=", async () => {
    const v = await vps("deployed");
    await v.writeState("last-staging.log", "old-journal-line-from-previous-run\n");
    await v.setRunning(["edge", "db", "app", "app-staging", "db-staging"]);
    const r = await v.entry("staging", "down");
    expectResult(r, 0, "ok");
    const calls = await v.calls();
    expect(calls.some((c) => c.startsWith("setsid ")), "setsid не вызван").toBe(true);
    const journal = (await v.readState("last-staging.log")) ?? "";
    expect(journal).not.toContain("old-journal-line-from-previous-run");
    expect(lastLine(journal)).toBe("result=ok");
    expect(lines(r.stdout), "stdout entry — тот же журнал").toEqual(lines(journal));
  });

  it("EC-28: prod deploy идёт через setsid, журнал state/last-prod.log", async () => {
    const v = await vps("deployed");
    const r = await v.entry("prod", `deploy ${v.c2} ${D2} ${v.c1}`, secrets(PROD_SECRETS));
    expectResult(r, 0, "ok");
    expect((await v.calls()).some((c) => c.startsWith("setsid ")), "setsid не вызван").toBe(true);
    expect(lastLine((await v.readState("last-prod.log")) ?? "")).toBe("result=ok");
  });
});

describe("entry.sh — блокировка flock (A5, EC-31)", { timeout: 60_000 }, () => {
  const lockCalls = (calls: string[]): string[] => calls.filter((c) => c.startsWith("flock "));

  it("A5: блокировка занята → 9, result=locked, prod deploy ничего не изменил", async () => {
    const v = await vps("deployed");
    await v.setCfg("lock_busy", "");
    const before = await v.snapshot();
    const r = await v.entry("prod", `deploy ${v.c2} ${D2} ${v.c1}`, secrets(PROD_SECRETS));
    expectResult(r, 9, "locked");
    expect(await v.snapshot()).toEqual(before);
    expect((await v.calls()).filter(isMutating)).toEqual([]);
  });

  it("A5: блокировка занята → 9, staging up ничего не изменил", async () => {
    const v = await vps("deployed");
    await v.setCfg("lock_busy", "");
    const before = await v.snapshot();
    const r = await v.entry("staging", `up ${DA} ${DT}`, secrets(STAGING_SECRETS));
    expectResult(r, 9, "locked");
    expect(await v.snapshot()).toEqual(before);
    expect((await v.calls()).filter(isMutating)).toEqual([]);
  });

  it("A5: блокировка занята → 9 для rollback и staging down", async () => {
    const v = await vps("deployed");
    await v.setCfg("lock_busy", "");
    expectResult(await v.entry("prod", "rollback"), 9, "locked");
    expectResult(await v.entry("staging", "down"), 9, "locked");
    expect((await v.calls()).filter(isMutating)).toEqual([]);
    expect((await v.readState("prod.image"))?.trim()).toBe(D1);
  });

  it("A5: блокировка — flock -w 900 на $CHEZZ_ROOT/state/lock", async () => {
    const v = await vps("deployed");
    expectResult(await v.entry("staging", "down"), 0, "ok");
    const locks = lockCalls(await v.calls());
    expect(locks.length, "flock не вызван").toBeGreaterThan(0);
    const wait900 = (c: string): boolean =>
      hasOpt(c, "-w", "900") || hasOpt(c, "--wait", "900") || hasOpt(c, "--timeout", "900");
    // Форма с путём в argv (П2: `flock -w 900 <$CHEZZ_ROOT/state/lock> …`); форму с fd без знания реализации не проверить.
    expect(locks.some((c) => wait900(c) && /\/state\/lock(\s|$)/.test(c)), locks.join("\n")).toBe(true);
  });

  it("A5: status выполняется без блокировки — при занятой блокировке код 0", async () => {
    const v = await vps("deployed");
    await v.setCfg("lock_busy", "");
    expectResult(await v.entry("prod", "status"), 0, "ok");
    expectResult(await v.entry("staging", "status"), 0, "ok");
  });

  it("EC-31: prod deploy и staging up берут одну и ту же блокировку", async () => {
    const v = await vps("deployed");
    expectResult(await v.entry("staging", `up ${DA} ${DT}`, secrets(STAGING_SECRETS)), 0, "ok");
    const stagingLocks = lockCalls(await v.calls());
    expectResult(await v.entry("prod", `deploy ${v.c2} ${D2} ${v.c1}`, secrets(PROD_SECRETS)), 0, "ok");
    const prodLocks = lockCalls(await v.calls()).slice(stagingLocks.length);
    const lockPath = (c: string): string | undefined => /(\S*\/state\/lock)(\s|$)/.exec(c)?.[1];
    const s = stagingLocks.map(lockPath).find(Boolean);
    const p = prodLocks.map(lockPath).find(Boolean);
    expect(s, `staging: ${stagingLocks.join("\n")}`).toBeDefined();
    expect(p, `prod: ${prodLocks.join("\n")}`).toBe(s);
  });
});
