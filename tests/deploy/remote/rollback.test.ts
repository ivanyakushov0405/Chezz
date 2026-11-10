// prod rollback (E02 T-3; OPERATIONS §9.5; design П6): цель из prod.image.prev или prod.history,
// клон не меняется, бэкапа нет, проверки с revision цели.
import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  D0,
  D1,
  DX,
  ISO_Z,
  R0,
  REGISTRY,
  expectResult,
  hasWords,
  isPullOf,
  isMutating,
  isPgDump,
  isUpProd,
  lines,
  parseEnvFile,
  useVps,
  type Vps,
} from "../support/index.ts";

const vps = useVps();

const prodImage = async (v: Vps): Promise<string | undefined> => (await v.readState("prod.image"))?.trim();

describe("rollback (AC-36, AC-37, EC-22)", { timeout: 60_000 }, () => {
  it("AC-36: rollback без аргумента → цель prod.image.prev; текущий → prod.image.prev; строка rollback; клон не меняется; код 0", async () => {
    const v = await vps("deployed");
    const r = await v.entry("prod", "rollback");
    expectResult(r, 0, "ok");
    expect(await prodImage(v)).toBe(D0);
    expect((await v.readState("prod.image.prev"))?.trim()).toBe(D1);
    expect(await v.head()).toBe(v.c1);
    expect(parseEnvFile(await v.readEnv("compose.prod.env"))["PROD_APP_IMAGE"]).toBe(`${REGISTRY}/chezz-app@${D0}`);
    const hist = lines((await v.readState("prod.history")) ?? "");
    const rb = hist.map((l) => l.split(" ")).find((p) => p[3] === "rollback");
    expect(rb, hist.join("\n")).toBeDefined();
    expect(rb?.slice(1)).toEqual([D0, R0, "rollback"]);
    expect(rb?.[0]).toMatch(ISO_Z);
  });

  it("AC-36: rollback — pull цели, up app, без бэкапа", async () => {
    const v = await vps("deployed");
    expectResult(await v.entry("prod", "rollback"), 0, "ok");
    const calls = await v.calls();
    expect(calls.some((c) => isPullOf(c, `${REGISTRY}/chezz-app@${D0}`))).toBe(true);
    expect(hasWords(calls.filter(isUpProd).at(-1) ?? "", "app"), "up app").toBe(true);
    expect(calls.some(isPgDump), "бэкап не делается").toBe(false);
    const dumps = existsSync(v.backups) ? await readdir(v.backups) : [];
    expect(dumps).toEqual([]);
  });

  it("AC-36: rollback — проверки п.8 с revision цели (метрики сообщают revision D0)", async () => {
    const v = await vps("deployed");
    expectResult(await v.entry("prod", "rollback"), 0, "ok");
    const calls = await v.calls();
    expect(calls.some((c) => c.startsWith("curl ") && c.includes("127.0.0.1:9464/metrics"))).toBe(true);
    expect(calls.some((c) => /^sleep 60s?(\s|$)/.test(c))).toBe(true);
  });

  it("AC-36: rollback <digest> из prod.history → цель этот digest, код 0", async () => {
    const v = await vps("deployed");
    expectResult(await v.entry("prod", `rollback ${D0}`), 0, "ok");
    expect(await prodImage(v)).toBe(D0);
  });

  it("AC-36: проверки после rollback не прошли → 4 broken", async () => {
    const v = await vps("deployed");
    await v.setCfg("bad_versions", `${R0}\n`);
    await v.setCfg("bad_mode", "health");
    expectResult(await v.entry("prod", "rollback"), 4, "broken");
  });

  it("AC-36: docker pull цели не удался → 4 broken", async () => {
    const v = await vps("deployed");
    await v.setCfg("pull_fail", `chezz-app@${D0}\n`);
    expectResult(await v.entry("prod", "rollback"), 4, "broken");
  });

  it("AC-37/EC-22: rollback <digest>, которого нет в prod.history → 2, ничего не изменено", async () => {
    const v = await vps("deployed");
    const before = await v.snapshot();
    expectResult(await v.entry("prod", `rollback ${DX}`), 2, "bad_command");
    expect(await v.snapshot()).toEqual(before);
    expect((await v.calls()).filter(isMutating)).toEqual([]);
  });

  it("AC-37/EC-22: rollback без аргумента, prod.image.prev нет → 2, ничего не изменено", async () => {
    const v = await vps("deployed");
    await rm(join(v.stateDir, "prod.image.prev"));
    const before = await v.snapshot();
    expectResult(await v.entry("prod", "rollback"), 2, "bad_command");
    expect(await v.snapshot()).toEqual(before);
    expect((await v.calls()).filter(isMutating)).toEqual([]);
  });
});
