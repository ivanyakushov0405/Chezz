// staging up/down/load и таймер TTL (E02 T-3; OPERATIONS §9.6, §11; design П6, A3).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DA,
  DT,
  ISO_Z,
  REGISTRY,
  STAGING_SECRETS,
  composeCalls,
  expectResult,
  hasOpt,
  hasWords,
  isCompose,
  isPullOf,
  words,
  isMutating,
  isStagingRm,
  isoAgo,
  lines,
  secrets,
  useVps,
  type Vps,
} from "../support/index.ts";

const vps = useVps();

const UP = `up ${DA} ${DT}`;
const STAGING_RUNNING = ["edge", "db", "app", "app-staging", "db-staging"];
// Ключевые слова П2; прочие флаги (-T и т.п.) и их порядок не важны.
const isUpStaging = (c: string): boolean =>
  isCompose(c) && hasWords(c, "up", "app-staging", "db-staging") && words(c).some((w) => w.startsWith("--wait"));
const isSeed = (c: string): boolean =>
  isCompose(c) && hasWords(c, "run", "--rm", "tools-staging", "apps/server/scripts/seed.ts", "--demo");
const isLoadRun = (c: string): boolean =>
  isCompose(c) && hasWords(c, "run", "--rm", "tools-staging") && hasOpt(c, "-e", "LOAD_REPORT=/tmp/report.json");

async function up(v: Vps): ReturnType<Vps["entry"]> {
  return await v.entry("staging", UP, secrets(STAGING_SECRETS));
}

describe("staging up (AC-38, AC-39, EC-26, EC-27, A3)", { timeout: 60_000 }, () => {
  it("AC-38/EC-26: нет state/prod.image → 7 prod_missing, сервисы staging не запускались", async () => {
    const v = await vps("fresh");
    const before = await v.snapshot();
    expectResult(await up(v), 7, "prod_missing");
    expect((await v.calls()).filter(isMutating)).toEqual([]);
    expect(await v.snapshot()).toEqual(before);
  });

  it("AC-39: клон не меняется; rm -sfv до up; up app-staging db-staging; сид --demo после up; state/staging.started", async () => {
    const v = await vps("deployed");
    await v.setRunning(STAGING_RUNNING);
    const head = await v.head();
    expectResult(await up(v), 0, "ok");
    expect(await v.head(), "SHA клона до и после равны").toBe(head);
    const calls = await v.calls();
    const rm = calls.findIndex(isStagingRm);
    const upIdx = calls.findIndex(isUpStaging);
    const seed = calls.findIndex(isSeed);
    expect(rm, "rm -sfv app-staging db-staging").toBeGreaterThanOrEqual(0);
    expect(upIdx, "up … app-staging db-staging").toBeGreaterThan(rm);
    expect(seed, "run --rm tools-staging … seed.ts --demo").toBeGreaterThan(upIdx);
    expect(((await v.readState("staging.started")) ?? "").trim()).toMatch(ISO_Z);
  });

  it("AC-39: pull обоих образов из ghcr.io/<owner>/chezz-app-staging и chezz-tools-staging по digest", async () => {
    const v = await vps("deployed");
    expectResult(await up(v), 0, "ok");
    const calls = await v.calls();
    expect(calls.some((c) => isPullOf(c, `${REGISTRY}/chezz-app-staging@${DA}`))).toBe(true);
    expect(calls.some((c) => isPullOf(c, `${REGISTRY}/chezz-tools-staging@${DT}`))).toBe(true);
  });

  it("AC-39: up не трогает prod-сервисы (нет up edge/db/app, нет stop)", async () => {
    const v = await vps("deployed");
    expectResult(await up(v), 0, "ok");
    const calls = composeCalls(await v.calls());
    expect(calls.filter((c) => hasWords(c, "up") && !c.includes("app-staging"))).toEqual([]);
    expect(calls.filter((c) => hasWords(c, "stop"))).toEqual([]);
  });

  it("AC-39/EC-27: up staging не поднялся → 1 up_failed", async () => {
    const v = await vps("deployed");
    await v.setCfg("up_staging_code", "1");
    expectResult(await up(v), 1, "up_failed");
  });

  it("AC-39/EC-27: сид --demo упал → 1 up_failed", async () => {
    const v = await vps("deployed");
    await v.setCfg("seed_code", "1");
    expectResult(await up(v), 1, "up_failed");
  });

  it("A3: pull не удался (staging up, образ tools) → 8, ничего не изменено", async () => {
    const v = await vps("deployed");
    await v.setCfg("pull_fail", `chezz-tools-staging@${DT}\n`);
    const before = await v.snapshot();
    expectResult(await up(v), 8, "pull_failed");
    expect(await v.snapshot()).toEqual(before);
    expect((await v.calls()).filter(isMutating).filter((c) => !c.startsWith("docker pull"))).toEqual([]);
  });

  it("A3: pull не удался (staging up, образ app) → 8", async () => {
    const v = await vps("deployed");
    await v.setCfg("pull_fail", `chezz-app-staging@${DA}\n`);
    expectResult(await up(v), 8, "pull_failed");
    expect((await v.calls()).some(isUpStaging)).toBe(false);
  });
});

describe("staging down (AC-40)", { timeout: 60_000 }, () => {
  it("AC-40: down → --profile staging rm -sfv app-staging db-staging, код 0", async () => {
    const v = await vps("deployed");
    await v.setRunning(STAGING_RUNNING);
    expectResult(await v.entry("staging", "down"), 0, "ok");
    const rm = (await v.calls()).filter(isStagingRm);
    expect(rm.length).toBeGreaterThan(0);
    expect(rm[0]).toMatch(/--profile staging/);
  });

  it("AC-40: down при уже остановленном staging → код 0", async () => {
    const v = await vps("deployed");
    expectResult(await v.entry("staging", "down"), 0, "ok");
  });

  it("AC-40: down не трогает prod и клон", async () => {
    const v = await vps("deployed");
    await v.setRunning(STAGING_RUNNING);
    const head = await v.head();
    expectResult(await v.entry("staging", "down"), 0, "ok");
    expect(await v.head()).toBe(head);
    expect(composeCalls(await v.calls()).filter((c) => hasWords(c, "up") || hasWords(c, "stop"))).toEqual([]);
  });
});

describe("staging-ttl.sh (AC-41, EC-33)", { timeout: 60_000 }, () => {
  it("AC-41: staging.started старше 12 ч → down (rm -sfv) и удаление файла, код 0", async () => {
    const v = await vps("deployed");
    await v.setRunning(STAGING_RUNNING);
    await v.writeState("staging.started", `${isoAgo(13 * 3600)}\n`);
    const r = await v.script("staging-ttl.sh");
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect((await v.calls()).some(isStagingRm), "rm -sfv app-staging db-staging").toBe(true);
    expect(existsSync(join(v.stateDir, "staging.started"))).toBe(false);
  });

  it("AC-41/EC-33: staging.started моложе 12 ч → ничего, код 0", async () => {
    const v = await vps("deployed");
    await v.setRunning(STAGING_RUNNING);
    const started = `${isoAgo(3600)}\n`;
    await v.writeState("staging.started", started);
    const r = await v.script("staging-ttl.sh");
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect((await v.calls()).filter(isMutating)).toEqual([]);
    expect(await v.readState("staging.started")).toBe(started);
  });

  it("AC-41/EC-33: staging не запущен, файла staging.started нет → ничего, код 0", async () => {
    const v = await vps("deployed");
    const r = await v.script("staging-ttl.sh");
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect((await v.calls()).filter(isMutating)).toEqual([]);
  });
});

describe("staging load (EC-25, AC-63 на VPS)", { timeout: 60_000 }, () => {
  it("EC-25: games_active prod > 2 → 3 prod_busy, генератор не запускается", async () => {
    const v = await vps("deployed");
    await v.setRunning(STAGING_RUNNING);
    await v.setCfg("metrics_extra", "chezz_games_active 3\n");
    expectResult(await v.entry("staging", "load"), 3, "prod_busy");
    expect((await v.calls()).some(isLoadRun)).toBe(false);
  });

  it("EC-25: games_active prod = 2 → генератор запускается командой §11 п.2, отчёт между report_begin/report_end", async () => {
    const v = await vps("deployed");
    await v.setRunning(STAGING_RUNNING);
    await v.setCfg("metrics_extra", "chezz_games_active 2\n");
    await v.setCfg("report", '{"p95_ms":42,"ok":true}');
    const r = await v.entry("staging", "load");
    expectResult(r, 0, "ok");
    const run = (await v.calls()).find(isLoadRun);
    expect(run, "run --rm -e LOAD_REPORT=/tmp/report.json tools-staging sh -c …").toBeDefined();
    expect(run).toContain("seed.ts --load 150");
    expect(run).toContain("tests/load/run.ts");
    const out = lines(r.stdout);
    const b = out.indexOf("report_begin");
    const e = out.indexOf("report_end");
    expect(b, "report_begin").toBeGreaterThanOrEqual(0);
    expect(e).toBeGreaterThan(b);
    expect(out.slice(b + 1, e).join("\n")).toContain('{"p95_ms":42,"ok":true}');
  });

  it("EC-25: метрики prod недоступны → занятость 0, генератор запускается", async () => {
    const v = await vps("deployed");
    await v.setRunning(STAGING_RUNNING);
    await v.setCfg("metrics_down", "");
    expectResult(await v.entry("staging", "load"), 0, "ok");
    expect((await v.calls()).some(isLoadRun)).toBe(true);
  });

  it("AC-63: генератор завершился с кодом ≠ 0 → код 1", async () => {
    const v = await vps("deployed");
    await v.setRunning(STAGING_RUNNING);
    await v.setCfg("load_code", "1");
    expectResult(await v.entry("staging", "load"), 1, "up_failed");
  });

  it("AC-63: app-staging не запущен → код 2", async () => {
    const v = await vps("deployed");
    expectResult(await v.entry("staging", "load"), 2, "bad_command");
    expect((await v.calls()).some(isLoadRun)).toBe(false);
  });
});
