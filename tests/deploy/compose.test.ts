// deploy/compose.yml (E02 T-2; OPERATIONS §6.1; design П9): `docker compose config` с тестовыми env-файлами
// и разбор исходного YAML. Нужен Docker CLI (демон не нужен).
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { makeTempDir, readRepoFile, runCmd, tail, type CmdResult } from "./support/index.ts";

const PROD_SERVICES = ["edge", "app", "db"];
const STAGING_SERVICES = ["app-staging", "db-staging", "tools-staging"];
const ALL_SERVICES = [...PROD_SERVICES, ...STAGING_SERVICES];

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;
const DIGEST_C = `sha256:${"c".repeat(64)}`;
const PROD_IMAGE = `ghcr.io/test-owner/chezz-app@${DIGEST_A}`;
const STAGING_APP_IMAGE = `ghcr.io/test-owner/chezz-app-staging@${DIGEST_B}`;
const STAGING_TOOLS_IMAGE = `ghcr.io/test-owner/chezz-tools-staging@${DIGEST_C}`;

const COMPOSE_PROD = [
  `PROD_APP_IMAGE=${PROD_IMAGE}`,
  "APP_DOMAIN=chezz.test",
  "ACME_EMAIL=ops@chezz.test",
  "SENTRY_INGEST=o0.ingest.sentry.io",
];
const COMPOSE_STAGING = [`STAGING_APP_IMAGE=${STAGING_APP_IMAGE}`, `STAGING_TOOLS_IMAGE=${STAGING_TOOLS_IMAGE}`];
const PROD_ENV = [
  "APP_ENV=prod",
  "APP_ORIGIN=https://chezz.test",
  "DATABASE_URL=postgres://app:prod-pw-sentinel@db:5432/chezz",
  "POSTGRES_PASSWORD=prod-pw-sentinel",
];
const STAGING_ENV = [
  "APP_ENV=staging",
  "APP_ORIGIN=https://staging.chezz.test",
  "DATABASE_URL=postgres://app:staging-pw-sentinel@db-staging:5432/chezz",
  "POSTGRES_PASSWORD=staging-pw-sentinel",
  "SEED_TOKEN_SECRET=seed-sentinel",
];

interface Port {
  host_ip?: string;
  target: number;
  published?: string;
  protocol?: string;
}
interface Volume {
  type: string;
  source?: string;
  target: string;
  read_only?: boolean;
}
interface Service {
  image?: string;
  user?: string;
  cap_drop?: string[];
  security_opt?: string[];
  read_only?: boolean;
  tmpfs?: string[];
  mem_limit?: string | number;
  cpus?: number | string;
  pids_limit?: number;
  ports?: Port[];
  networks?: Record<string, unknown>;
  volumes?: Volume[];
  privileged?: boolean;
  restart?: string;
  logging?: { driver?: string; options?: Record<string, string> };
  depends_on?: Record<string, { condition?: string }>;
  healthcheck?: { test?: string[] | string; interval?: string; start_period?: string };
  environment?: Record<string, string | null>;
  command?: string[] | string | null;
  profiles?: string[];
}
interface ComposeConfig {
  services: Record<string, Service>;
  networks?: Record<string, { internal?: boolean; name?: string }>;
  volumes?: Record<string, unknown>;
}

interface ConfigOpts {
  profile?: boolean;
  composeStaging?: string[];
  composeProd?: string[];
  quiet?: boolean;
}

/** Каждый вызов — свой CHEZZ_ROOT в mkdtemp с env-файлами (TESTING §1: тесты независимы). */
async function compose(opts: ConfigOpts = {}): Promise<{ res: CmdResult; root: string }> {
  const { dir, cleanup } = await makeTempDir("chezz-compose-");
  try {
    const envDir = join(dir, "env");
    await mkdir(envDir, { recursive: true });
    const w = (name: string, lines: string[]): Promise<void> => writeFile(join(envDir, name), `${lines.join("\n")}\n`);
    await w("compose.staging.env", opts.composeStaging ?? COMPOSE_STAGING);
    await w("compose.prod.env", opts.composeProd ?? COMPOSE_PROD);
    await w("prod.env", PROD_ENV);
    await w("staging.env", STAGING_ENV);
    const args = [
      "compose",
      "-p",
      "chezz",
      "-f",
      "deploy/compose.yml",
      "--env-file",
      join(envDir, "compose.staging.env"),
      "--env-file",
      join(envDir, "compose.prod.env"),
      ...(opts.profile ? ["--profile", "staging"] : []),
      "config",
      ...(opts.quiet ? ["-q"] : ["--format", "json"]),
    ];
    const res = await runCmd("docker", args, { env: { CHEZZ_ROOT: dir } });
    return { res, root: dir };
  } finally {
    await cleanup();
  }
}

async function config(opts: ConfigOpts = {}): Promise<ComposeConfig> {
  await readRepoFile("deploy/compose.yml");
  const { res } = await compose(opts);
  expect(res.code, `docker compose config:\n${tail(res.stderr)}`).toBe(0);
  return JSON.parse(res.stdout) as ComposeConfig;
}

const fullConfig = (): Promise<ComposeConfig> => config({ profile: true });

function svc(cfg: ComposeConfig, name: string): Service {
  const s = cfg.services[name];
  if (!s) throw new Error(`нет сервиса ${name}`);
  return s;
}

/** Исходный YAML — для того, что `config` нормализует (env_file, литералы). */
async function rawCompose(): Promise<{ services: Record<string, Record<string, unknown>> }> {
  return parse(await readRepoFile("deploy/compose.yml")) as { services: Record<string, Record<string, unknown>> };
}

function bytes(v: string | number | undefined): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "number") return v;
  const m = /^(\d+(?:\.\d+)?)\s*([kmg]?)b?$/i.exec(v.trim());
  if (!m) return Number(v);
  const mult = { "": 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[m[2]!.toLowerCase() as "" | "k" | "m" | "g"];
  return Number(m[1]) * mult;
}

/** Длительность Go/compose (`10s`, `1m0s`, `60s`) → секунды. */
function seconds(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  let total = 0;
  for (const m of v.matchAll(/(\d+(?:\.\d+)?)(h|ms|m|s)/g)) {
    const n = Number(m[1]);
    total += m[2] === "h" ? n * 3600 : m[2] === "m" ? n * 60 : m[2] === "s" ? n : n / 1000;
  }
  return total;
}

/** Цели tmpfs (ключ `tmpfs` и тома `type: tmpfs`), без опций. */
function tmpfsTargets(s: Service): string[] {
  const fromKey = (s.tmpfs ?? []).map((t) => t.split(":")[0]!);
  const fromVolumes = (s.volumes ?? []).filter((v) => v.type === "tmpfs").map((v) => v.target);
  return [...fromKey, ...fromVolumes];
}

function tmpfsSpec(s: Service, target: string): string {
  return (s.tmpfs ?? []).find((t) => t.split(":")[0] === target) ?? "";
}

const portKey = (p: Port): string => `${p.host_ip ?? ""}|${p.published ?? ""}/${p.protocol ?? "tcp"}`;
const healthText = (h: Service["healthcheck"]): string =>
  Array.isArray(h?.test) ? h.test.join(" ") : (h?.test ?? "");

describe("deploy/compose.yml", () => {
  it("AC-7: `config -q` с двумя --env-file проходит (с профилем staging и без)", async () => {
    await readRepoFile("deploy/compose.yml");
    for (const profile of [false, true]) {
      const { res } = await compose({ profile, quiet: true });
      expect(res.code, `profile=${String(profile)}:\n${tail(res.stderr)}`).toBe(0);
    }
  });

  it("AC-7: без профиля — только edge, app, db; с --profile staging — ещё app-staging, db-staging, tools-staging", async () => {
    const base = await config();
    expect(Object.keys(base.services).sort()).toEqual([...PROD_SERVICES].sort());
    const full = await fullConfig();
    expect(Object.keys(full.services).sort()).toEqual([...ALL_SERVICES].sort());
  });

  it("AC-7 (§6.1): образы сервисов — caddy:2, PROD_APP_IMAGE, STAGING_APP_IMAGE, STAGING_TOOLS_IMAGE", async () => {
    const cfg = await fullConfig();
    expect(svc(cfg, "edge").image).toBe("caddy:2");
    expect(svc(cfg, "app").image).toBe(PROD_IMAGE);
    expect(svc(cfg, "app-staging").image).toBe(STAGING_APP_IMAGE);
    expect(svc(cfg, "tools-staging").image).toBe(STAGING_TOOLS_IMAGE);
  });

  it("AC-8: порты на хосте — edge 80, 443, 443/udp; app только 127.0.0.1:9464; app-staging только 127.0.0.1:9465", async () => {
    const cfg = await fullConfig();
    const edge = (svc(cfg, "edge").ports ?? []).map((p) => `${p.published ?? ""}/${p.protocol ?? "tcp"}`).sort();
    expect(edge).toEqual(["443/tcp", "443/udp", "80/tcp"]);
    for (const p of svc(cfg, "edge").ports ?? []) expect(["", "0.0.0.0"]).toContain(p.host_ip ?? "");
    expect((svc(cfg, "app").ports ?? []).map(portKey)).toEqual(["127.0.0.1|9464/tcp"]);
    expect((svc(cfg, "app").ports ?? [])[0]?.target).toBe(9464);
    expect((svc(cfg, "app-staging").ports ?? []).map(portKey)).toEqual(["127.0.0.1|9465/tcp"]);
    expect((svc(cfg, "app-staging").ports ?? [])[0]?.target).toBe(9464);
  });

  it("AC-8: у db, db-staging, tools-staging портов на хосте нет", async () => {
    const cfg = await fullConfig();
    for (const name of ["db", "db-staging", "tools-staging"]) expect(svc(cfg, name).ports ?? [], name).toEqual([]);
  });

  it("AC-9: сети prod и staging — internal: true", async () => {
    const cfg = await fullConfig();
    expect(cfg.networks?.["prod"]?.internal).toBe(true);
    expect(cfg.networks?.["staging"]?.internal).toBe(true);
    expect(Object.keys(cfg.networks ?? {}).sort()).toEqual(["edge-prod", "edge-staging", "prod", "staging"]);
  });

  it("AC-9: сети сервисов по таблице §6.1; staging-сервисы не в prod и edge-prod; db — только prod", async () => {
    const cfg = await fullConfig();
    const nets = (name: string): string[] => Object.keys(svc(cfg, name).networks ?? {}).sort();
    expect(nets("edge")).toEqual(["edge-prod", "edge-staging"]);
    expect(nets("app")).toEqual(["edge-prod", "prod"]);
    expect(nets("db")).toEqual(["prod"]);
    expect(nets("app-staging")).toEqual(["edge-staging", "staging"]);
    expect(nets("db-staging")).toEqual(["staging"]);
    expect(nets("tools-staging")).toEqual(["edge-staging", "staging"]);
    for (const name of STAGING_SERVICES) {
      expect(nets(name), name).not.toContain("prod");
      expect(nets(name), name).not.toContain("edge-prod");
    }
  });

  it("AC-10: app, app-staging, tools-staging — user 1000:1000, cap_drop ALL, no-new-privileges, read_only, tmpfs /tmp", async () => {
    const cfg = await fullConfig();
    for (const name of ["app", "app-staging", "tools-staging"]) {
      const s = svc(cfg, name);
      expect(s.user, name).toBe("1000:1000");
      expect(s.cap_drop, name).toEqual(["ALL"]);
      expect(s.security_opt ?? [], name).toContain("no-new-privileges:true");
      expect(s.read_only, name).toBe(true);
      expect(tmpfsTargets(s), name).toContain("/tmp");
    }
  });

  it("AC-10: лимиты app 400m/1.5/512, app-staging 400m/1.0/256, tools-staging 512m/1.0/256", async () => {
    const cfg = await fullConfig();
    const limits = (name: string): [number | undefined, number, number | undefined] => {
      const s = svc(cfg, name);
      return [bytes(s.mem_limit), Number(s.cpus), s.pids_limit];
    };
    expect(limits("app")).toEqual([400 * 1024 ** 2, 1.5, 512]);
    expect(limits("app-staging")).toEqual([400 * 1024 ** 2, 1, 256]);
    expect(limits("tools-staging")).toEqual([512 * 1024 ** 2, 1, 256]);
  });

  it("AC-10 (таблица §6.1): db 768m, shared_buffers=128MB, max_connections=50; db-staging 512m/0.5/256", async () => {
    const cfg = await fullConfig();
    const db = svc(cfg, "db");
    expect(bytes(db.mem_limit)).toBe(768 * 1024 ** 2);
    const cmd = Array.isArray(db.command) ? db.command.join(" ") : (db.command ?? "");
    expect(cmd).toMatch(/shared_buffers=128MB/);
    expect(cmd).toMatch(/max_connections=50/);
    const st = svc(cfg, "db-staging");
    expect([bytes(st.mem_limit), Number(st.cpus), st.pids_limit]).toEqual([512 * 1024 ** 2, 0.5, 256]);
  });

  it("AC-11: нет privileged и docker.sock ни у одного сервиса", async () => {
    const cfg = await fullConfig();
    for (const [name, s] of Object.entries(cfg.services)) {
      expect(s.privileged ?? false, name).toBe(false);
      for (const v of s.volumes ?? []) expect(v.source ?? "", name).not.toMatch(/docker\.sock/);
    }
    expect(await readRepoFile("deploy/compose.yml")).not.toMatch(/docker\.sock|privileged:\s*true/);
  });

  it("AC-11: bind-mount только у edge — Caddyfile → /etc/caddy/Caddyfile, только чтение", async () => {
    const cfg = await fullConfig();
    for (const [name, s] of Object.entries(cfg.services)) {
      const binds = (s.volumes ?? []).filter((v) => v.type === "bind");
      if (name !== "edge") {
        expect(binds, name).toEqual([]);
        continue;
      }
      expect(binds).toHaveLength(1);
      expect(binds[0]!.target).toBe("/etc/caddy/Caddyfile");
      expect(binds[0]!.read_only).toBe(true);
      expect(binds[0]!.source ?? "").toMatch(/[\\/]deploy[\\/]Caddyfile$/);
    }
  });

  it("AC-11 (§6.1): тома edge — caddy_data, caddy_config; app — screenshots → /data/screenshots", async () => {
    const cfg = await fullConfig();
    const named = (name: string): string[] =>
      (svc(cfg, name).volumes ?? []).filter((v) => v.type === "volume").map((v) => `${v.source ?? ""}:${v.target}`);
    const edgeSources = (svc(cfg, "edge").volumes ?? []).filter((v) => v.type === "volume").map((v) => v.source);
    expect(edgeSources.sort()).toEqual(["caddy_config", "caddy_data"]);
    expect(named("app")).toEqual(["screenshots:/data/screenshots"]);
    expect(Object.keys(cfg.volumes ?? {}).sort()).toEqual(["caddy_config", "caddy_data", "pgdata", "screenshots"]);
    const shot = svc(cfg, "app-staging");
    expect(tmpfsTargets(shot)).toContain("/data/screenshots");
    const spec = tmpfsSpec(shot, "/data/screenshots");
    if (spec !== "") {
      expect(spec).toMatch(/uid=1000/);
      expect(spec).toMatch(/gid=1000/);
      expect(spec).toMatch(/mode=0?700/);
    }
  });

  it("AC-12: app — depends_on db service_healthy, healthcheck /api/health раз в 10 с, start_period 60s", async () => {
    const cfg = await fullConfig();
    const app = svc(cfg, "app");
    expect(app.depends_on?.["db"]?.condition).toBe("service_healthy");
    expect(healthText(app.healthcheck)).toMatch(/fetch\(['"]http:\/\/127\.0\.0\.1:3000\/api\/health['"]\)/);
    expect(seconds(app.healthcheck?.interval)).toBe(10);
    expect(seconds(app.healthcheck?.start_period)).toBe(60);
  });

  it("AC-12: db — healthcheck pg_isready -U app -d chezz", async () => {
    const cfg = await fullConfig();
    expect(healthText(svc(cfg, "db").healthcheck)).toMatch(/pg_isready\s+-U\s+app\s+-d\s+chezz/);
  });

  it("AC-12: restart unless-stopped у всех, кроме tools-staging", async () => {
    const cfg = await fullConfig();
    for (const name of ALL_SERVICES.filter((n) => n !== "tools-staging")) {
      expect(svc(cfg, name).restart, name).toBe("unless-stopped");
    }
    expect(["", "no"]).toContain(svc(cfg, "tools-staging").restart ?? "");
  });

  it("AC-12: у всех сервисов logging.driver journald с tag", async () => {
    const cfg = await fullConfig();
    for (const name of ALL_SERVICES) {
      const l = svc(cfg, name).logging;
      expect(l?.driver, name).toBe("journald");
      expect(l?.options?.["tag"], name).toBe("{{.Name}}");
    }
  });

  it("AC-13: db и db-staging — postgres:18, POSTGRES_USER=app, POSTGRES_DB=chezz", async () => {
    const cfg = await fullConfig();
    for (const name of ["db", "db-staging"]) {
      const s = svc(cfg, name);
      expect(s.image, name).toBe("postgres:18");
      expect(s.environment?.["POSTGRES_USER"], name).toBe("app");
      expect(s.environment?.["POSTGRES_DB"], name).toBe("chezz");
    }
  });

  it("AC-13: db — том pgdata → /var/lib/postgresql; db-staging — tmpfs /var/lib/postgresql (256 МБ), без томов", async () => {
    const cfg = await fullConfig();
    const db = (svc(cfg, "db").volumes ?? []).map((v) => `${v.type}:${v.source ?? ""}:${v.target}`);
    expect(db).toEqual(["volume:pgdata:/var/lib/postgresql"]);
    const st = svc(cfg, "db-staging");
    expect(tmpfsTargets(st)).toContain("/var/lib/postgresql");
    expect((st.volumes ?? []).filter((v) => v.type !== "tmpfs")).toEqual([]);
    const spec = tmpfsSpec(st, "/var/lib/postgresql");
    if (spec !== "") expect(spec).toMatch(/size=(256m|268435456)/i);
  });

  it("AC-13: пароли БД — только из env_file (prod.env / staging.env), в compose.yml литерала нет", async () => {
    const raw = await rawCompose();
    const text = await readRepoFile("deploy/compose.yml");
    expect(text).not.toMatch(/POSTGRES_PASSWORD\s*[:=]/);
    expect(text).not.toMatch(/DATABASE_URL\s*[:=]/);
    const envFiles = (name: string): string[] => {
      const v = raw.services[name]?.["env_file"];
      const list = Array.isArray(v) ? v : v === undefined ? [] : [v];
      return list.map((e) => (typeof e === "string" ? e : String((e as { path?: string }).path)));
    };
    for (const name of ["app", "db"]) expect(envFiles(name), name).toEqual(["${CHEZZ_ROOT:-/srv/chezz}/env/prod.env"]);
    for (const name of STAGING_SERVICES) {
      expect(envFiles(name), name).toEqual(["${CHEZZ_ROOT:-/srv/chezz}/env/staging.env"]);
    }
    const cfg = await fullConfig();
    expect(svc(cfg, "db").environment?.["POSTGRES_PASSWORD"]).toBe("prod-pw-sentinel");
    expect(svc(cfg, "db-staging").environment?.["POSTGRES_PASSWORD"]).toBe("staging-pw-sentinel");
  });

  it("AC-13 (§6.1): staging-сервисы не получают секретов prod.env, prod-сервисы — staging.env", async () => {
    const cfg = await fullConfig();
    for (const name of STAGING_SERVICES) {
      expect(JSON.stringify(svc(cfg, name).environment ?? {}), name).not.toMatch(/prod-pw-sentinel/);
    }
    for (const name of PROD_SERVICES) {
      expect(JSON.stringify(svc(cfg, name).environment ?? {}), name).not.toMatch(/staging-pw-sentinel|seed-sentinel/);
    }
  });

  it("AC-13 (§6.1): edge получает APP_DOMAIN, ACME_EMAIL, SENTRY_INGEST из compose.prod.env", async () => {
    const cfg = await fullConfig();
    const env = svc(cfg, "edge").environment ?? {};
    expect(env["APP_DOMAIN"]).toBe("chezz.test");
    expect(env["ACME_EMAIL"]).toBe("ops@chezz.test");
    expect(env["SENTRY_INGEST"]).toBe("o0.ingest.sentry.io");
  });

  it("EC-35: после перезагрузки поднимаются все сервисы, кроме tools-staging (restart: unless-stopped)", async () => {
    const cfg = await fullConfig();
    const autostart = Object.entries(cfg.services)
      .filter(([, s]) => s.restart === "unless-stopped")
      .map(([n]) => n)
      .sort();
    expect(autostart).toEqual(["app", "app-staging", "db", "db-staging", "edge"]);
  });

  it("EC-38: ключ и в compose.staging.env, и в compose.prod.env — побеждает prod (передаётся последним)", async () => {
    const cfg = await config({
      profile: true,
      composeStaging: [
        ...COMPOSE_STAGING,
        "APP_DOMAIN=staging-wins.test",
        `PROD_APP_IMAGE=ghcr.io/evil/chezz-app@${DIGEST_B}`,
      ],
    });
    expect(svc(cfg, "edge").environment?.["APP_DOMAIN"]).toBe("chezz.test");
    expect(svc(cfg, "app").image).toBe(PROD_IMAGE);
    expect(svc(cfg, "app-staging").image).toBe(STAGING_APP_IMAGE);
  });

  it("EC-39: app-staging и tools-staging пишут только в /tmp и тома — read_only: true, tmpfs /tmp", async () => {
    const cfg = await fullConfig();
    for (const name of ["app-staging", "tools-staging"]) {
      const s = svc(cfg, name);
      expect(s.read_only, name).toBe(true);
      expect(tmpfsTargets(s), name).toContain("/tmp");
      // Записываемое — только tmpfs: именованных томов и bind у staging-сервисов нет.
      expect((s.volumes ?? []).filter((v) => v.type === "volume" || v.type === "bind"), name).toEqual([]);
    }
  });

  it("AC-7 (§6.1): профиль staging — ровно у трёх staging-сервисов", async () => {
    const raw = await rawCompose();
    for (const name of STAGING_SERVICES) expect(raw.services[name]?.["profiles"], name).toEqual(["staging"]);
    for (const name of PROD_SERVICES) expect(raw.services[name]?.["profiles"], name).toBeUndefined();
  });
});
