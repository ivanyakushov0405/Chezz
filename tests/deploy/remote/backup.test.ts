// deploy/remote/backup.sh --reason daily|pre-deploy (E02 T-3; OPERATIONS §14.1; design П7): режим local,
// дамп через .partial, 3 последних файла, state/last-backup, BACKUP_REQUIRE_OFFSITE, заглушка offsite.
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ISO_Z, isPgDump, modeOf, tail, useVps, type Vps } from "../support/index.ts";

const vps = useVps();

const OLD = ["chezz-20200101T000000Z-daily.dump", "chezz-20200102T000000Z-pre-deploy.dump", "chezz-20200103T000000Z-daily.dump"];

async function listBackups(v: Vps): Promise<string[]> {
  return existsSync(v.backups) ? (await readdir(v.backups)).sort() : [];
}

async function seedOld(v: Vps): Promise<void> {
  await mkdir(v.backups, { recursive: true });
  for (const f of OLD) await writeFile(join(v.backups, f), `old ${f}`);
  await v.writeState("last-backup", "2020-01-03T00:00:00Z\n");
}

async function backup(v: Vps, reason: string, env: Record<string, string> = {}): ReturnType<Vps["script"]> {
  return await v.script("backup.sh", ["--reason", reason], env);
}

describe("backup.sh — режим local (AC-42)", { timeout: 60_000 }, () => {
  it("AC-42: daily → chezz-<UTC>-daily.dump с выводом pg_dump -Fc, state/last-backup обновлён", async () => {
    const v = await vps("deployed");
    await v.setCfg("dump", "PGDMP-daily-bytes");
    const r = await backup(v, "daily");
    expect(r.code, tail(r.stdout + r.stderr)).toBe(0);
    const files = await listBackups(v);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^chezz-\d{8}T\d{6}Z-daily\.dump$/);
    expect(await readFile(join(v.backups, files[0] ?? ""), "utf8")).toBe("PGDMP-daily-bytes");
    expect((await v.calls()).some(isPgDump), "docker compose … exec -T db pg_dump -U app -d chezz -Fc").toBe(true);
    expect(((await v.readState("last-backup")) ?? "").trim()).toMatch(ISO_Z);
  });

  it("AC-42: имя дампа — время UTC запуска (YYYYMMDDTHHMMSSZ)", async () => {
    const v = await vps("deployed");
    const t0 = Date.now();
    const r = await backup(v, "daily");
    expect(r.code, tail(r.stdout + r.stderr)).toBe(0);
    const m = /^chezz-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-/.exec((await listBackups(v))[0] ?? "");
    expect(m).not.toBeNull();
    const ts = Date.UTC(+m![1]!, +m![2]! - 1, +m![3]!, +m![4]!, +m![5]!, +m![6]!);
    expect(Math.abs(ts - t0)).toBeLessThan(120_000);
  });

  it("AC-42: --reason pre-deploy → chezz-<UTC>-pre-deploy.dump", async () => {
    const v = await vps("deployed");
    const r = await backup(v, "pre-deploy");
    expect(r.code, tail(r.stdout + r.stderr)).toBe(0);
    expect((await listBackups(v))[0]).toMatch(/^chezz-\d{8}T\d{6}Z-pre-deploy\.dump$/);
  });

  it("AC-42: на VPS остаются 3 новейших chezz-*.dump (daily и pre-deploy вместе)", async () => {
    const v = await vps("deployed");
    await seedOld(v);
    const r = await backup(v, "daily");
    expect(r.code, tail(r.stdout + r.stderr)).toBe(0);
    const files = await listBackups(v);
    expect(files).toHaveLength(3);
    expect(files.slice(0, 2)).toEqual([OLD[1], OLD[2]]);
    expect(files[2]).toMatch(/^chezz-\d{8}T\d{6}Z-daily\.dump$/);
  });

  it("AC-42: без deploy/backup.age.pub, но с B2_* в ops.env → режим local", async () => {
    const v = await vps("deployed");
    await v.writeEnv("ops.env", "B2_KEY_ID=key-id\nB2_APP_KEY=app-key\nB2_BUCKET=bucket\n");
    const r = await backup(v, "daily");
    expect(r.code, tail(r.stdout + r.stderr)).toBe(0);
    expect(await listBackups(v)).toHaveLength(1);
  });

  it.skipIf(process.platform === "win32")("AC-42: каталог бэкапов создаётся с правами 700", async () => {
    const v = await vps("deployed");
    const r = await backup(v, "daily");
    expect(r.code, tail(r.stdout + r.stderr)).toBe(0);
    expect((await modeOf(v.backups)).toString(8)).toBe("700");
  });
});

describe("backup.sh — BACKUP_REQUIRE_OFFSITE (AC-43, EC-19)", { timeout: 60_000 }, () => {
  it("AC-43/EC-19: BACKUP_REQUIRE_OFFSITE=true в окружении, режим local → ошибка, дамп не создаётся", async () => {
    const v = await vps("deployed");
    const r = await backup(v, "daily", { BACKUP_REQUIRE_OFFSITE: "true" });
    expect(r.code).not.toBe(0);
    expect((await listBackups(v)).filter((f) => f.startsWith("chezz-"))).toEqual([]);
    expect(await v.readState("last-backup")).toBeNull();
  });

  it("AC-43/EC-19: BACKUP_REQUIRE_OFFSITE=true в ops.env → ошибка, дамп не создаётся", async () => {
    const v = await vps("deployed");
    await v.writeEnv("ops.env", "BACKUP_REQUIRE_OFFSITE=true\n");
    const r = await backup(v, "daily");
    expect(r.code).not.toBe(0);
    expect((await listBackups(v)).filter((f) => f.startsWith("chezz-"))).toEqual([]);
  });

  it("П7: переменная окружения BACKUP_REQUIRE_OFFSITE перекрывает ops.env", async () => {
    const v = await vps("deployed");
    await v.writeEnv("ops.env", "BACKUP_REQUIRE_OFFSITE=true\n");
    const r = await backup(v, "daily", { BACKUP_REQUIRE_OFFSITE: "false" });
    expect(r.code, tail(r.stdout + r.stderr)).toBe(0);
    expect(await listBackups(v)).toHaveLength(1);
  });
});

describe("backup.sh — сбой pg_dump (AC-44)", { timeout: 60_000 }, () => {
  it("AC-44: pg_dump упал посередине → код ≠ 0, last-backup не обновлён, неполного файла нет, прежние 3 на месте", async () => {
    const v = await vps("deployed");
    await seedOld(v);
    await v.setCfg("dump", "PGDMP-partial-bytes");
    await v.setCfg("dump_code", "1");
    const r = await backup(v, "daily");
    expect(r.code).not.toBe(0);
    expect(await listBackups(v)).toEqual(OLD);
    expect(await v.readState("last-backup")).toBe("2020-01-03T00:00:00Z\n");
  });

  it("AC-44: pg_dump упал при пустом каталоге → нет ни .dump, ни .partial", async () => {
    const v = await vps("deployed");
    await v.setCfg("dump_code", "1");
    const r = await backup(v, "daily");
    expect(r.code).not.toBe(0);
    expect(await listBackups(v)).toEqual([]);
  });
});

describe("backup.sh — offsite до E20 (П7)", { timeout: 60_000 }, () => {
  it("П7: deploy/backup.age.pub есть и B2_KEY_ID не пуст → offsite: not implemented (E20), код 1, дампа нет", async () => {
    const v = await vps("deployed");
    await writeFile(join(v.repo, "deploy", "backup.age.pub"), "age1testkeyonlyforteststestkeyonlyforteststestkeyonlyfortest\n");
    await v.writeEnv("ops.env", "B2_KEY_ID=key-id\nB2_APP_KEY=app-key\nB2_BUCKET=bucket\n");
    const r = await backup(v, "daily");
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/offsite/);
    expect((await listBackups(v)).filter((f) => f.startsWith("chezz-"))).toEqual([]);
  });
});
