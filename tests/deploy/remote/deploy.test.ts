// prod deploy (E02 T-3; OPERATIONS §9.4, §9.5; design П6, A3, A4): занятость, база, предок, pull, метка,
// бэкап, запись состояния, гашение staging, проверки а–г, restore_prev, prune.
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  APP_DOMAIN,
  D1,
  D2,
  DX,
  ISO_Z,
  PROD_SECRETS,
  REGISTRY,
  composeCalls,
  expectResult,
  hasOpt,
  hasWords,
  isPrune,
  isPullOf,
  isMutating,
  isPgDump,
  isStagingRm,
  isUpProd,
  lines,
  parseEnvFile,
  runCmd,
  secrets,
  useVps,
  type Vps,
} from "../support/index.ts";

const vps = useVps();

interface DeployArgs {
  sha?: string;
  digest?: string;
  base?: string;
  force?: boolean;
  stdin?: string;
}

async function deploy(v: Vps, a: DeployArgs = {}): ReturnType<Vps["entry"]> {
  const cmd = ["deploy", a.sha ?? v.c2, a.digest ?? D2, a.base ?? v.c1, ...(a.force ? ["force"] : [])].join(" ");
  return await v.entry("prod", cmd, a.stdin ?? secrets(PROD_SECRETS));
}

async function expectNothingChanged(v: Vps, run: () => Promise<void>, opts: { allowPull?: boolean; allowDump?: boolean } = {}): Promise<void> {
  const before = await v.snapshot();
  await run();
  expect(await v.snapshot(), "state/, env/, клон не изменены").toEqual(before);
  const calls = await v.calls();
  const mut = calls.filter(isMutating).filter((c) => !(opts.allowPull && c.startsWith("docker pull")) && !(opts.allowDump && isPgDump(c)));
  expect(mut, "ничего не выполнено").toEqual([]);
}

const prodImage = async (v: Vps): Promise<string | undefined> => (await v.readState("prod.image"))?.trim();
const historyLines = async (v: Vps): Promise<string[]> => lines((await v.readState("prod.history")) ?? "");
const prodAppImage = async (v: Vps): Promise<string | undefined> =>
  parseEnvFile(await v.readEnv("compose.prod.env"))["PROD_APP_IMAGE"];

async function makeBad(v: Vps, mode: string, versions: string[]): Promise<void> {
  await v.setCfg("bad_versions", versions.map((x) => `${x}\n`).join(""));
  await v.setCfg("bad_mode", mode);
}

describe("deploy — успешная выкатка (AC-31, AC-33, AC-35)", { timeout: 60_000 }, () => {
  it("AC-31: prod.image.prev = прежний, prod.image = новый, prod.repo.prev = прежний SHA, клон на <sha> (detached), строка deploy, PROD_APP_IMAGE", async () => {
    const v = await vps("deployed");
    const r = await deploy(v);
    expectResult(r, 0, "ok");
    expect((await v.readState("prod.image.prev"))?.trim()).toBe(D1);
    expect(await prodImage(v)).toBe(D2);
    expect((await v.readState("prod.repo.prev"))?.trim()).toBe(v.c1);
    expect(await v.head()).toBe(v.c2);
    const sym = await runCmd("git", ["-C", v.repo, "symbolic-ref", "-q", "HEAD"]);
    expect(sym.code, "HEAD detached").not.toBe(0);
    const hist = await historyLines(v);
    expect(hist.slice(0, 2), "прежние строки prod.history сохранены").toHaveLength(2);
    const last = hist.at(-1)?.split(" ") ?? [];
    expect(last.slice(1)).toEqual([D2, v.c2, "deploy"]);
    expect(last[0]).toMatch(ISO_Z);
    expect(await prodAppImage(v)).toBe(`${REGISTRY}/chezz-app@${D2}`);
  });

  it("AC-31: docker pull образа по digest из ghcr.io/<owner в нижнем регистре>/chezz-app", async () => {
    const v = await vps("deployed");
    expectResult(await deploy(v), 0, "ok");
    expect((await v.calls()).some((c) => isPullOf(c, `${REGISTRY}/chezz-app@${D2}`))).toBe(true);
  });

  it("AC-31: up поднимает edge db app с --wait и таймаутом 120", async () => {
    const v = await vps("deployed");
    expectResult(await deploy(v), 0, "ok");
    const ups = (await v.calls()).filter(isUpProd);
    expect(ups.some((c) => hasOpt(c, "--wait-timeout", "120") && hasWords(c, "edge", "db", "app")), ups.join("\n")).toBe(true);
  });

  it("AC-33: проверки а–г — метрики 127.0.0.1:9464, health https://$APP_DOMAIN/api/health, sleep 60, RestartCount, повтор health", async () => {
    const v = await vps("deployed");
    expectResult(await deploy(v), 0, "ok");
    const calls = await v.calls();
    expect(calls.some((c) => c.startsWith("curl ") && c.includes("http://127.0.0.1:9464/metrics")), "а) метрики").toBe(true);
    const health = calls.map((c, i) => [c, i] as const).filter(([c]) => c.startsWith("curl ") && c.includes(`https://${APP_DOMAIN}/api/health`));
    expect(health.length, "б) health").toBeGreaterThanOrEqual(2);
    const sleepIdx = calls.findIndex((c) => /^sleep 60s?(\s|$)/.test(c));
    expect(sleepIdx, "г) sleep 60").toBeGreaterThanOrEqual(0);
    expect(health.some(([, i]) => i > sleepIdx), "г) health после sleep 60").toBe(true);
    expect(
      calls.some((c, i) => i > sleepIdx && /^docker (container )?inspect /.test(c) && c.includes("RestartCount") && c.includes("chezz-app-1")),
      "г) RestartCount после sleep 60",
    ).toBe(true);
  });

  it("AC-35: после успешной выкатки — docker image prune -af --filter until=168h", async () => {
    const v = await vps("deployed");
    expectResult(await deploy(v), 0, "ok");
    const calls = await v.calls();
    const prune = calls.findIndex(isPrune);
    const lastUp = calls.findLastIndex(isUpProd);
    expect(prune, "prune не вызван").toBeGreaterThan(lastUp);
  });
});

describe("deploy — занятость (AC-26, AC-27, EC-11, EC-12)", { timeout: 60_000 }, () => {
  it("AC-26/EC-11: chezz_games_active 11 без force → 3 prod_busy, ничего не изменено", async () => {
    const v = await vps("deployed");
    await v.setCfg("metrics_extra", "# TYPE chezz_games_active gauge\nchezz_games_active 11\n");
    await expectNothingChanged(v, async () => expectResult(await deploy(v), 3, "prod_busy"));
  });

  it("AC-26/EC-11: chezz_games_active 11 с force → выкатка идёт", async () => {
    const v = await vps("deployed");
    await v.setCfg("metrics_extra", "chezz_games_active 11\n");
    expectResult(await deploy(v, { force: true }), 0, "ok");
    expect(await prodImage(v)).toBe(D2);
  });

  it("AC-26: chezz_games_active 10 (не больше 10) → выкатка идёт", async () => {
    const v = await vps("deployed");
    await v.setCfg("metrics_extra", "chezz_games_active 10\n");
    expectResult(await deploy(v), 0, "ok");
  });

  it("AC-27/EC-12: метрики chezz_games_active нет → 0, выкатка идёт", async () => {
    const v = await vps("deployed");
    expectResult(await deploy(v), 0, "ok");
  });

  it("AC-27/EC-12: app не отвечает на /metrics (curl ≠ 0) → 0, выкатка идёт", async () => {
    const v = await vps("deployed");
    await v.setRunning(["edge", "db"]);
    expectResult(await deploy(v), 0, "ok");
    expect(await prodImage(v)).toBe(D2);
  });

  it("AC-27/EC-12/EC-18: первая выкатка (bootstrap): app и db не запущены → занятость 0, backup=skipped_no_db, код 0", async () => {
    const v = await vps("fresh");
    const r = await deploy(v, { base: "bootstrap" });
    expectResult(r, 0, "ok");
    expect(lines(r.stdout)).toContain("backup=skipped_no_db");
    expect((await v.calls()).some(isPgDump), "pg_dump не вызывается").toBe(false);
    expect(await prodImage(v)).toBe(D2);
    expect((await v.readState("prod.repo.prev"))?.trim()).toBe(v.c1);
    expect(await v.head()).toBe(v.c2);
    expect(await prodAppImage(v)).toBe(`${REGISTRY}/chezz-app@${D2}`);
  });
});

describe("deploy — база, предок, метка, pull (AC-28, AC-29, EC-13…EC-15, A3)", { timeout: 60_000 }, () => {
  it("AC-28/EC-13: base ≠ SHA клона → 6 base_mismatch, ничего не изменено", async () => {
    const v = await vps("deployed");
    await expectNothingChanged(v, async () => expectResult(await deploy(v, { base: v.c2 }), 6, "base_mismatch"));
  });

  it("AC-28/EC-13: base — произвольный SHA → 6, ничего не изменено", async () => {
    const v = await vps("deployed");
    await expectNothingChanged(v, async () => expectResult(await deploy(v, { base: "c".repeat(40) }), 6, "base_mismatch"));
  });

  it("AC-28: base=bootstrap — проверка базы пропущена, выкатка идёт", async () => {
    const v = await vps("deployed");
    expectResult(await deploy(v, { base: "bootstrap" }), 0, "ok");
    expect(await v.head()).toBe(v.c2);
  });

  it("AC-29/EC-14: <sha> не предок origin/main → 2, ничего не изменено", async () => {
    const v = await vps("deployed");
    await expectNothingChanged(v, async () => expectResult(await deploy(v, { sha: v.side }), 2, "bad_command"));
  });

  it("AC-29/EC-15: метка revision образа ≠ <sha> → 2, ничего не изменено", async () => {
    const v = await vps("deployed");
    await expectNothingChanged(
      v,
      async () => expectResult(await deploy(v, { digest: DX }), 2, "bad_command"),
      { allowPull: true },
    );
  });

  it("A3: pull не удался → 8", async () => {
    const v = await vps("deployed");
    await v.setCfg("pull_fail", `chezz-app@${D2}\n`);
    await expectNothingChanged(v, async () => expectResult(await deploy(v), 8, "pull_failed"), { allowPull: true });
  });

  it("A3: pull не удался при первой выкатке → 8, prod.image не создан", async () => {
    const v = await vps("fresh");
    await v.setCfg("pull_fail", `chezz-app@${D2}\n`);
    await expectNothingChanged(v, async () => expectResult(await deploy(v, { base: "bootstrap" }), 8, "pull_failed"), {
      allowPull: true,
    });
    expect(existsSync(`${v.stateDir}/prod.image`)).toBe(false);
  });
});

describe("deploy — бэкап pre-deploy (AC-30, EC-17, EC-18, EC-19)", { timeout: 60_000 }, () => {
  it("AC-30/EC-17: backup.sh упал → 5 backup_failed; prod.image, prod.history, клон, PROD_APP_IMAGE не изменены", async () => {
    const v = await vps("deployed");
    await v.setCfg("dump_code", "1");
    await expectNothingChanged(v, async () => expectResult(await deploy(v), 5, "backup_failed"), {
      allowPull: true,
      allowDump: true,
    });
    expect((await v.calls()).some(isUpProd), "up не вызывался").toBe(false);
  });

  it("AC-30/EC-18: db не запущен → бэкап пропущен, backup=skipped_no_db, выкатка идёт", async () => {
    const v = await vps("deployed");
    await v.setRunning(["edge", "app"]);
    const r = await deploy(v);
    expectResult(r, 0, "ok");
    expect(lines(r.stdout)).toContain("backup=skipped_no_db");
    expect((await v.calls()).some(isPgDump)).toBe(false);
  });

  it("AC-30: db запущен → backup=ok, дамп chezz-<UTC>-pre-deploy.dump до up", async () => {
    const v = await vps("deployed");
    const r = await deploy(v);
    expectResult(r, 0, "ok");
    expect(lines(r.stdout)).toContain("backup=ok");
    const dumps = await readdir(v.backups);
    expect(dumps.some((f) => /^chezz-\d{8}T\d{6}Z-pre-deploy\.dump$/.test(f)), dumps.join(", ")).toBe(true);
    const calls = await v.calls();
    expect(calls.findIndex(isPgDump)).toBeLessThan(calls.findIndex(isUpProd));
  });

  it("EC-19: BACKUP_REQUIRE_OFFSITE=true в секретах, режим local → 5, дампа нет, ничего не изменено", async () => {
    const v = await vps("deployed");
    const stdin = secrets(PROD_SECRETS, { BACKUP_REQUIRE_OFFSITE: "true" });
    await expectNothingChanged(v, async () => expectResult(await deploy(v, { stdin }), 5, "backup_failed"), {
      allowPull: true,
      allowDump: true,
    });
    const dumps = existsSync(v.backups) ? await readdir(v.backups) : [];
    expect(dumps.filter((f) => f.startsWith("chezz-"))).toEqual([]);
  });
});

describe("deploy — гашение staging (AC-32)", { timeout: 60_000 }, () => {
  it("AC-32: staging запущен → rm -sfv app-staging db-staging до up prod", async () => {
    const v = await vps("deployed");
    await v.setRunning(["edge", "db", "app", "app-staging", "db-staging"]);
    expectResult(await deploy(v), 0, "ok");
    const calls = await v.calls();
    const rm = calls.findIndex(isStagingRm);
    expect(rm, "rm -sfv app-staging db-staging").toBeGreaterThanOrEqual(0);
    expect(calls[rm], "rm с --profile staging").toMatch(/--profile staging/);
    expect(rm).toBeLessThan(calls.findIndex(isUpProd));
  });
});

describe("deploy — провал и restore_prev (AC-33, AC-34, EC-20, EC-23, A4)", { timeout: 60_000 }, () => {
  const MODES: Array<[string, string]> = [
    ["а) нет app_info{version=<sha>}", "metrics"],
    ["б) health не ok", "health"],
    ["в) нет Strict-Transport-Security", "hsts"],
    ["в) нет Content-Security-Policy", "csp"],
    ["г) EC-23: RestartCount > 0 через 60 с", "restarts"],
    ["г) health через 60 с не ok", "health2"],
  ];

  it.each(MODES)("AC-33: провал проверки %s → restore_prev → 1 rolled_back", async (_name, mode) => {
    const v = await vps("deployed");
    await makeBad(v, mode, [v.c2]);
    expectResult(await deploy(v), 1, "rolled_back");
    expect(await prodImage(v)).toBe(D1);
    expect(await v.head()).toBe(v.c1);
  });

  it("AC-34/EC-20: up --wait не прошёл (миграция) → restore_prev: клон на prod.repo.prev, prod.image прежний, строка restore → 1", async () => {
    const v = await vps("deployed");
    await makeBad(v, "up", [v.c2]);
    expectResult(await deploy(v), 1, "rolled_back");
    expect(await v.head()).toBe(v.c1);
    expect(await prodImage(v)).toBe(D1);
    expect(await prodAppImage(v)).toBe(`${REGISTRY}/chezz-app@${D1}`);
    const last = (await historyLines(v)).at(-1)?.split(" ") ?? [];
    expect(last.slice(1)).toEqual([D1, v.c1, "restore"]);
    expect(last[0]).toMatch(ISO_Z);
    const ups = (await v.calls()).filter(isUpProd);
    expect(hasWords(ups.at(-1) ?? "", "app"), `restore_prev поднимает app: ${ups.at(-1) ?? ""}`).toBe(true);
  });

  it("AC-34: провал restore_prev (прежний образ тоже не здоров) → 4 broken", async () => {
    const v = await vps("deployed");
    await makeBad(v, "up", [v.c2, v.c1]);
    expectResult(await deploy(v), 4, "broken");
  });

  it("AC-34: провал проверок после restore_prev → 4 broken", async () => {
    const v = await vps("deployed");
    await makeBad(v, "health", [v.c2, v.c1]);
    expectResult(await deploy(v), 4, "broken");
  });

  it("AC-34: docker pull прежнего образа в restore_prev не удался → 4 broken", async () => {
    const v = await vps("deployed");
    await makeBad(v, "up", [v.c2]);
    await v.setCfg("pull_fail", `chezz-app@${D1}\n`);
    expectResult(await deploy(v), 4, "broken");
  });

  it("A4: провал первой выкатки → 4, restore=no_prev", async () => {
    const v = await vps("fresh");
    await makeBad(v, "up", [v.c2]);
    const r = await deploy(v, { base: "bootstrap" });
    expectResult(r, 4, "broken");
    expect(lines(r.stdout)).toContain("restore=no_prev");
    expect(composeCalls(await v.calls()).some((c) => hasWords(c, "stop", "app")), "stop app").toBe(true);
    expect(existsSync(`${v.stateDir}/prod.image`), "state/prod.image удалён").toBe(false);
    expect(await v.head(), "клон на prod.repo.prev").toBe(v.c1);
    expect((await v.readState("prod.repo.prev"))?.trim()).toBe(v.c1);
  });

  it("A4: провал проверок первой выкатки (не up) → 4, restore=no_prev, prod.image удалён", async () => {
    const v = await vps("fresh");
    await makeBad(v, "health", [v.c2]);
    const r = await deploy(v, { base: "bootstrap" });
    expectResult(r, 4, "broken");
    expect(lines(r.stdout)).toContain("restore=no_prev");
    expect(existsSync(`${v.stateDir}/prod.image`)).toBe(false);
  });

  it("AC-35: prune только после успеха — при откате не вызывается", async () => {
    const v = await vps("deployed");
    await makeBad(v, "up", [v.c2]);
    expectResult(await deploy(v), 1, "rolled_back");
    expect((await v.calls()).some((c) => isPrune(c))).toBe(false);
  });
});
