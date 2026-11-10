// status prod и staging (E02 T-3; OPERATIONS §9.3; design П8, A9).
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { D1, DA, DT, REGISTRY, expectResult, isMutating, lines, useVps, type Vps } from "../support/index.ts";

const vps = useVps();

const PROD_KEYS = [
  "env",
  "image",
  "revision",
  "repo",
  "health",
  "restarts",
  "started_at",
  "players_online",
  "games_active",
  "backup_mode",
  "last_backup",
  "disk_used_pct",
  "staging",
];
const STAGING_KEYS = ["env", "image", "tools_image", "repo", "health", "restarts", "started_at", "staging"];

/** Строки `ключ=значение` вывода, кроме result=. */
function kv(stdout: string): Array<[string, string]> {
  return lines(stdout)
    .filter((l) => /^[a-z_]+=/.test(l) && !l.startsWith("result="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]);
}

async function status(v: Vps, env: "prod" | "staging"): Promise<Record<string, string>> {
  const before = await v.snapshot();
  const r = await v.entry(env, "status");
  expectResult(r, 0, "ok");
  expect(await v.snapshot(), "status только читает").toEqual(before);
  expect((await v.calls()).filter(isMutating)).toEqual([]);
  const pairs = kv(r.stdout);
  if (env === "prod") expect(pairs.map(([k]) => k), "ровно ключи §9.3 в этом порядке").toEqual(PROD_KEYS);
  else expect(pairs.map(([k]) => k).sort(), "ровно ключи A9").toEqual([...STAGING_KEYS].sort());
  return Object.fromEntries(pairs);
}

describe("status prod (AC-21, П8)", { timeout: 60_000 }, () => {
  it("AC-21: ровно ключи §9.3; метрик нет → players_online=0, games_active=0; бэкапов нет → last_backup=none", async () => {
    const v = await vps("deployed");
    const s = await status(v, "prod");
    expect(s).toEqual({
      env: "prod",
      image: D1,
      revision: v.c1,
      repo: v.c1,
      health: "healthy",
      restarts: "0",
      started_at: "2026-11-05T10:00:00Z",
      players_online: "0",
      games_active: "0",
      backup_mode: "local",
      last_backup: "none",
      disk_used_pct: "41",
      staging: "down",
    });
  });

  it("AC-21: метрики chezz_players_online/chezz_games_active, state/last-backup, staging запущен", async () => {
    const v = await vps("deployed");
    await v.setCfg("metrics_extra", "chezz_players_online 12\nchezz_games_active 3\n");
    await v.writeState("last-backup", "2026-11-05T03:30:12Z\n");
    await v.setRunning(["edge", "db", "app", "app-staging", "db-staging"]);
    const s = await status(v, "prod");
    expect(s["players_online"]).toBe("12");
    expect(s["games_active"]).toBe("3");
    expect(s["last_backup"]).toBe("2026-11-05T03:30:12Z");
    expect(s["staging"]).toBe("up");
  });

  it("AC-21: app не отвечает → players_online=0, games_active=0; контейнера нет → health=absent", async () => {
    const v = await vps("deployed");
    await v.setRunning(["edge", "db"]);
    const s = await status(v, "prod");
    expect(s["players_online"]).toBe("0");
    expect(s["games_active"]).toBe("0");
    expect(s["health"]).toBe("absent");
  });

  it("П8: без state/prod.image — image=none, revision=none", async () => {
    const v = await vps("fresh");
    const s = await status(v, "prod");
    expect(s["image"]).toBe("none");
    expect(s["revision"]).toBe("none");
    expect(s["repo"]).toBe(v.c1);
    expect(s["staging"]).toBe("down");
  });

  it("П8: backup_mode=offsite при deploy/backup.age.pub и B2_KEY_ID в ops.env", async () => {
    const v = await vps("deployed");
    await writeFile(join(v.repo, "deploy", "backup.age.pub"), "age1testkeyonlyforteststestkeyonlyforteststestkeyonlyfortest\n");
    await v.writeEnv("ops.env", "B2_KEY_ID=key-id\nB2_BUCKET=bucket\nB2_APP_KEY=app-key\n");
    const s = await status(v, "prod");
    expect(s["backup_mode"]).toBe("offsite");
  });
});

describe("status staging (A9)", { timeout: 60_000 }, () => {
  it("A9: status staging — staging запущен: image, tools_image, repo, health, restarts, started_at, staging=up", async () => {
    const v = await vps("deployed");
    await v.writeEnv(
      "compose.staging.env",
      `STAGING_APP_IMAGE=${REGISTRY}/chezz-app-staging@${DA}\nSTAGING_TOOLS_IMAGE=${REGISTRY}/chezz-tools-staging@${DT}\n`,
    );
    await v.writeState("staging.started", "2026-11-05T09:00:00Z\n");
    await v.setRunning(["edge", "db", "app", "app-staging", "db-staging"]);
    const s = await status(v, "staging");
    expect(s).toEqual({
      env: "staging",
      image: DA,
      tools_image: DT,
      repo: v.c1,
      health: "healthy",
      restarts: "0",
      started_at: "2026-11-05T09:00:00Z",
      staging: "up",
    });
  });

  it("A9: status staging — staging не поднимался: image=none, tools_image=none, health=absent, started_at=none, staging=down", async () => {
    const v = await vps("deployed");
    const s = await status(v, "staging");
    expect(s["env"]).toBe("staging");
    expect(s["image"]).toBe("none");
    expect(s["tools_image"]).toBe("none");
    expect(s["health"]).toBe("absent");
    expect(s["started_at"]).toBe("none");
    expect(s["staging"]).toBe("down");
    expect(s["repo"]).toBe(v.c1);
  });
});
