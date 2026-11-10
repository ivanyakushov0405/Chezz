// deploy/bootstrap.sh — первичная настройка VPS (E02 T-4; OPERATIONS §5; design A7, П10, R-c, R-e; ADR-0011 п.4).
// Скрипт запускается как у Ivan: `bash -s -- <аргументы>` с текстом скрипта в stdin, все пути файлов — с префиксом
// BOOTSTRAP_ROOT, системные команды П10 (и docker, openssl, sudo, …) подменены через PATH (support/fakes/boot/).
// Подмены ведут состояние пользователей, групп и swap в cfg/, как настоящие команды: повторный useradd → 9,
// повторный swapon → 255, git clone в непустой каталог → 128.
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  REPO_ROOT,
  bashExecutable,
  hasFlag,
  hasWords,
  lines,
  makeTempDir,
  readRepoFile,
  runCmd,
  runScript,
  tail,
  toBashPath,
  words,
  writeFake,
  type RunResult,
} from "./support/index.ts";

// --- Аргументы (A7): открытые ключи и хэш — тестовые, не настоящие. ---
const REPO_URL = "https://github.com/test-owner/chezz.git";
const key = (c: string, comment?: string): string =>
  `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI${c.repeat(43)}${comment === undefined ? "" : ` ${comment}`}`;
const OPS_KEY = key("p", "ops-test");
const CI_PROD_KEY = key("q", "ci-prod");
const CI_STAGING_KEY = key("r");
const CI_PROD_KEY_2 = key("s", "ci-prod-2");
const CI_STAGING_KEY_2 = key("t", "ci-staging-2");
const OPS_KEY_2 = key("u", "ops-other");
const PW_HASH = `$6$testsalttestsalt$${"a".repeat(86)}`;

interface Args {
  repoUrl?: string;
  opsKey?: string;
  ciProdKey?: string;
  ciStagingKey?: string;
  hash?: string;
}

const VALID: Required<Args> = {
  repoUrl: REPO_URL,
  opsKey: OPS_KEY,
  ciProdKey: CI_PROD_KEY,
  ciStagingKey: CI_STAGING_KEY,
  hash: PW_HASH,
};

function argv(a: Args): string[] {
  const out: string[] = [];
  if (a.repoUrl !== undefined) out.push("--repo-url", a.repoUrl);
  if (a.opsKey !== undefined) out.push("--ops-key", a.opsKey);
  if (a.ciProdKey !== undefined) out.push("--ci-prod-key", a.ciProdKey);
  if (a.ciStagingKey !== undefined) out.push("--ci-staging-key", a.ciStagingKey);
  if (a.hash !== undefined) out.push("--ops-password-hash", a.hash);
  return out;
}

// --- Подменный VPS. ---
const FAKES_DIR = join(REPO_ROOT, "tests", "deploy", "support", "fakes", "boot");
/** Команды, которые только пишут argv в журнал (код 0). */
const LOG_ONLY = [
  "systemctl",
  "ufw",
  "openssl",
  "swapoff",
  "visudo",
  "timedatectl",
  "sysctl",
  "dpkg-reconfigure",
  "passwd",
  "chattr",
  "loginctl",
  "hostnamectl",
  "locale-gen",
];

const SEED: Record<string, string> = {
  "etc/fstab": "UUID=0000-test / ext4 errors=remount-ro 0 1\n",
  "etc/ssh/sshd_config": "Include /etc/ssh/sshd_config.d/*.conf\nKbdInteractiveAuthentication no\nUsePAM yes\n",
  "etc/os-release": 'ID=ubuntu\nVERSION_ID="24.04"\nVERSION_CODENAME=noble\nUBUNTU_CODENAME=noble\n',
};

interface Boot {
  dir: string;
  root: string;
  /** BOOTSTRAP_ROOT в виде пути bash. */
  rootBash: string;
  cfg: string;
  run: (args: string[]) => Promise<RunResult>;
  calls: () => Promise<string[]>;
  clearCalls: () => Promise<void>;
  /** Файл под BOOTSTRAP_ROOT (путь без ведущего «/»), null — нет. */
  file: (rel: string) => Promise<string | null>;
  path: (rel: string) => string;
  cfgLines: (name: string) => Promise<string[]>;
  setCfg: (name: string, content: string) => Promise<void>;
  cleanup: () => Promise<void>;
}

function splitSections(text: string): Map<string, string> {
  const out = new Map<string, string>();
  let name: string | null = null;
  let body: string[] = [];
  for (const l of text.split(/\r?\n/)) {
    const m = /^#@@ (\S+)$/.exec(l);
    if (m) {
      if (name !== null) out.set(name, body.join("\n"));
      name = m[1] ?? null;
      body = [];
    } else if (name !== null) body.push(l);
  }
  if (name !== null) out.set(name, body.join("\n"));
  return out;
}

async function newBoot(): Promise<Boot> {
  const { dir, cleanup } = await makeTempDir("chezz-boot-");
  const root = join(dir, "root");
  const bin = join(dir, "bin");
  const cfg = join(dir, "cfg");
  const log = join(dir, "calls.log");
  await mkdir(root, { recursive: true });
  await mkdir(cfg, { recursive: true });
  for (const [rel, content] of Object.entries(SEED)) {
    await mkdir(join(root, rel, ".."), { recursive: true });
    await writeFile(join(root, rel), content);
  }
  await mkdir(join(root, "etc", "ssh", "sshd_config.d"), { recursive: true });
  await writeFile(log, "");
  await writeFile(join(cfg, "users"), "root\n");
  await writeFile(join(cfg, "groups"), "root\nsudo\nadm\n");
  await writeFile(join(cfg, "primary"), "root root\n");
  await writeFile(join(cfg, "members"), "");
  await writeFile(join(cfg, "swaps"), "");

  const libFile = join(cfg, "lib.sh");
  const lib = (await readFile(join(FAKES_DIR, "lib.sh"), "utf8"))
    .replaceAll("@@CFG@@", toBashPath(cfg))
    .replaceAll("@@ROOT@@", toBashPath(root))
    .replaceAll("@@LOG@@", toBashPath(log))
    .replaceAll("@@REPO@@", toBashPath(REPO_ROOT.replace(/[\\/]$/, "")));
  await writeFile(libFile, lib);
  const head = (name: string): string => `. '${toBashPath(libFile)}'\nprintf '%s\\n' "${name} $*" >> "$LOG"\n`;
  const sections = splitSections(await readFile(join(FAKES_DIR, "fakes.sh"), "utf8"));
  for (const [name, body] of sections) await writeFake(bin, name, head(name) + body);
  for (const name of LOG_ONLY) await writeFake(bin, name, `${head(name)}exit 0`);

  // Git Bash ставит /mingw64/bin и /usr/bin первыми в PATH — BASH_ENV возвращает подмены вперёд (как support/vps.ts).
  const bashEnv = join(cfg, "bash_env.sh");
  await writeFile(bashEnv, `PATH='${toBashPath(bin)}':"$PATH"\n`);

  return {
    dir,
    root,
    rootBash: toBashPath(root),
    cfg,
    run: async (args) => {
      const src = await readRepoFile("deploy/bootstrap.sh");
      return await runScript("-s", {
        args: ["--", ...args],
        stdin: src,
        env: { BOOTSTRAP_ROOT: root, BASH_ENV: bashEnv },
        fakeBin: bin,
        cwd: dir,
        timeoutMs: 150_000,
      });
    },
    calls: async () => lines(await readFile(log, "utf8")),
    clearCalls: async () => await writeFile(log, ""),
    file: async (rel) => (existsSync(join(root, rel)) ? await readFile(join(root, rel), "utf8") : null),
    path: (rel) => join(root, rel),
    cfgLines: async (name) => lines(await readFile(join(cfg, name), "utf8")),
    setCfg: async (name, content) => await writeFile(join(cfg, name), content),
    cleanup: async () => await cleanup().catch(() => undefined),
  };
}

/** Все файлы и каталоги под корнем: путь → содержимое (каталог — "<dir>"). */
async function tree(dir: string, prefix = "", out: Record<string, string> = {}): Promise<Record<string, string>> {
  if (!existsSync(dir)) return out;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix === "" ? e.name : `${prefix}/${e.name}`;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      out[rel] = "<dir>";
      await tree(p, rel, out);
    } else out[rel] = await readFile(p, "utf8");
  }
  return out;
}

const ok = (r: RunResult): void => expect(r.code, tail(r.stdout + r.stderr)).toBe(0);
const fileLines = (text: string | null): string[] => lines(text ?? "").map((l) => l.trim());
const norm = (l: string): string => l.trim().replace(/\s+/g, " ");
const cmd = (calls: string[], name: string): string[] => calls.filter((c) => c === name || c.startsWith(`${name} `));
/** Значение директивы sshd_config / journald (`Key value` или `Key=value`). */
const directives = (text: string | null, k: string): string[] =>
  fileLines(text)
    .filter((l) => !l.startsWith("#"))
    .map((l) => /^(\S+?)(?:\s*=\s*|\s+)(.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null && m[1]?.toLowerCase() === k.toLowerCase())
    .map((m) => (m[2] ?? "").trim());
const isSshRestart = (c: string): boolean =>
  /^systemctl\s+(restart|reload|reload-or-restart|try-restart|try-reload-or-restart)\s(.*\s)?sshd?(\.service|\.socket)?(\s|$)/.test(c);
const groupsOf = async (b: Boot, user: string): Promise<string[]> => [
  ...(await b.cfgLines("primary")).filter((l) => l.split(" ")[0] === user).map((l) => l.split(" ")[1] ?? ""),
  ...(await b.cfgLines("members")).filter((l) => l.split(" ")[0] === user).map((l) => l.split(" ")[1] ?? ""),
];
const ufwAllows = (calls: string[]): string[] =>
  cmd(calls, "ufw")
    .filter((c) => words(c).includes("allow"))
    .map((c) => words(c).slice(words(c).indexOf("allow") + 1).join(" "));

const DEPLOY_KEYS = "home/deploy/.ssh/authorized_keys";
const OPS_KEYS = "home/ops/.ssh/authorized_keys";
const SSHD_DROPIN = "etc/ssh/sshd_config.d/00-chezz.conf";
const ENV_DIR = "srv/chezz/env";
const UNITS = ["chezz-backup.service", "chezz-backup.timer", "chezz-staging-ttl.service", "chezz-staging-ttl.timer"];
const TIMERS = ["chezz-backup.timer", "chezz-staging-ttl.timer"];
const deployKeyLines = (prod: string, staging: string): string[] => [
  `command="/srv/chezz/repo/deploy/remote/entry.sh prod",restrict ${prod}`,
  `command="/srv/chezz/repo/deploy/remote/entry.sh staging",restrict ${staging}`,
];

const RUN_TIMEOUT = 180_000;

describe("bootstrap.sh — синтаксис (AC-45)", () => {
  it("AC-45: bash -n deploy/bootstrap.sh без ошибок", async () => {
    const file = join(REPO_ROOT, "deploy", "bootstrap.sh");
    expect(existsSync(file), "нет deploy/bootstrap.sh").toBe(true);
    const r = await runCmd(bashExecutable(), ["-n", toBashPath(file)]);
    expect(r.code, tail(r.stdout + r.stderr)).toBe(0);
  });

  it("AC-45: в рабочей копии bootstrap.sh нет \\r (Ivan запускает `bash -s < deploy/bootstrap.sh` с Windows)", async () => {
    const text = await readRepoFile("deploy/bootstrap.sh");
    expect(text.includes("\r"), "CRLF ломает bash -s").toBe(false);
  });
});

describe("bootstrap.sh — в файлах нет данных среды (AC-47)", () => {
  it("AC-47: в bootstrap.sh нет IP, ключа хоста, логина владельца, e-mail, example.com", async () => {
    const text = await readRepoFile("deploy/bootstrap.sh");
    const ips = (text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? []).filter((ip) => ip !== "0.0.0.0" && ip !== "127.0.0.1");
    expect(ips, "IPv4").toEqual([]);
    expect(text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g) ?? [], "e-mail").toEqual([]);
    expect(text.match(/(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp\d+)\s+AAAA[A-Za-z0-9+/]{16,}/g) ?? [], "ключ").toEqual([]);
    expect(text.match(/(github\.com|ghcr\.io)[/:][A-Za-z0-9][A-Za-z0-9-]*/g) ?? [], "логин владельца").toEqual([]);
    expect(text.includes("example.com"), "example.com").toBe(false);
  });
});

describe("bootstrap.sh — аргументы (A7): неверный или нет → код 2, система не меняется", { timeout: 60_000 }, () => {
  const cases: [string, Args | string[]][] = [
    ["нет аргументов", []],
    ["нет --repo-url", { ...VALID, repoUrl: undefined }],
    ["нет --ops-key", { ...VALID, opsKey: undefined }],
    ["нет --ci-prod-key", { ...VALID, ciProdKey: undefined }],
    ["нет --ci-staging-key", { ...VALID, ciStagingKey: undefined }],
    ["нет --ops-password-hash", { ...VALID, hash: undefined }],
    ["--repo-url по http://", { ...VALID, repoUrl: "http://github.com/test-owner/chezz.git" }],
    ["--repo-url без .git", { ...VALID, repoUrl: "https://github.com/test-owner/chezz" }],
    ["--repo-url не github.com", { ...VALID, repoUrl: "https://gitlab.com/test-owner/chezz.git" }],
    ["--repo-url с хвостом команды", { ...VALID, repoUrl: "https://github.com/test-owner/chezz.git;touch x" }],
    ["--ops-key ssh-rsa", { ...VALID, opsKey: `ssh-rsa AAAAB3NzaC1yc2E${"A".repeat(40)} ops-test` }],
    ["--ops-key с опциями authorized_keys", { ...VALID, opsKey: `command="/bin/sh" ${OPS_KEY}` }],
    ["--ci-prod-key с переводом строки и вторым ключом", { ...VALID, ciProdKey: `${CI_PROD_KEY}\n${OPS_KEY}` }],
    ["--ci-staging-key с пробелом в комментарии", { ...VALID, ciStagingKey: `${CI_STAGING_KEY} two words` }],
    ["--ci-staging-key с кавычкой в комментарии", { ...VALID, ciStagingKey: key("r", 'ci",no-restrict') }],
    ["--ci-prod-key пустой", { ...VALID, ciProdKey: "" }],
    ["--ops-password-hash не $6$", { ...VALID, hash: "$1$abcd$efgh" }],
    ["--ops-password-hash пустой", { ...VALID, hash: "" }],
    ["неизвестный аргумент", [...argv(VALID), "--force"]],
    ["последний аргумент без значения", [...argv({ ...VALID, hash: undefined }), "--ops-password-hash"]],
  ];

  it.each(cases)("A7: %s → 2, ни файлов, ни изменяющих вызовов", async (_name, a) => {
    const b = await newBoot();
    try {
      const before = await tree(b.root);
      const r = await b.run(Array.isArray(a) ? a : argv(a));
      expect(r.code, tail(r.stdout + r.stderr)).toBe(2);
      expect(await tree(b.root), "файлы под BOOTSTRAP_ROOT не изменились").toEqual(before);
      const mutating = (await b.calls()).filter((c) => !/^(getent|id|dpkg --print-architecture|lsb_release)(\s|$)/.test(c));
      expect(mutating, "до проверки аргументов — только чтение").toEqual([]);
    } finally {
      await b.cleanup();
    }
  });
});

describe("bootstrap.sh — первый запуск (AC-46, AC-49, EC-35, R-e)", () => {
  let b: Boot;
  let r: RunResult;
  let calls: string[];

  beforeAll(async () => {
    b = await newBoot();
    r = await b.run(argv(VALID));
    calls = await b.calls();
  }, RUN_TIMEOUT);
  afterAll(async () => await b.cleanup());

  it("AC-46: верные аргументы → код 0", () => {
    ok(r);
  });

  it("AC-46: authorized_keys deploy — ровно две строки command=…entry.sh prod|staging,restrict", async () => {
    expect(fileLines(await b.file(DEPLOY_KEYS))).toEqual(deployKeyLines(CI_PROD_KEY, CI_STAGING_KEY));
  });

  it("AC-46: authorized_keys ops — ключ --ops-key", async () => {
    expect(fileLines(await b.file(OPS_KEYS))).toEqual([OPS_KEY]);
  });

  it("AC-46: пользователи ops (группы sudo, docker, ops) и deploy (docker, ops, без sudo)", async () => {
    const users = await b.cfgLines("users");
    expect(users).toEqual(expect.arrayContaining(["ops", "deploy"]));
    expect(await b.cfgLines("groups")).toEqual(expect.arrayContaining(["ops", "docker"]));
    expect(await groupsOf(b, "ops")).toEqual(expect.arrayContaining(["sudo", "docker", "ops"]));
    const dg = await groupsOf(b, "deploy");
    expect(dg).toEqual(expect.arrayContaining(["docker", "ops"]));
    expect(dg).not.toContain("sudo");
  });

  it("AC-46: sudo у ops — с паролем: хэш --ops-password-hash задан ops, NOPASSWD и правил для deploy нет", async () => {
    const setsHash = calls.some(
      (c) =>
        c.includes(PW_HASH) &&
        ((/^(usermod|useradd) /.test(c) && words(c).includes("ops")) || c.startsWith(`chpasswd-stdin ops:${PW_HASH}`)),
    );
    expect(setsHash, `хэш передан usermod/useradd -p … ops или chpasswd -e:\n${calls.join("\n")}`).toBe(true);
    const sudoers = await tree(b.path("etc/sudoers.d"));
    for (const [name, text] of Object.entries(sudoers)) {
      expect(text, `etc/sudoers.d/${name}`).not.toMatch(/NOPASSWD/);
      expect(text, `etc/sudoers.d/${name}`).not.toMatch(/\bdeploy\b/);
    }
  });

  it("AC-46: sshd — PasswordAuthentication no, PermitRootLogin no, AllowUsers ops deploy в 00-chezz.conf", async () => {
    const text = await b.file(SSHD_DROPIN);
    expect(text, `нет ${SSHD_DROPIN}`).not.toBeNull();
    expect(directives(text, "PasswordAuthentication")).toEqual(["no"]);
    expect(directives(text, "PermitRootLogin")).toEqual(["no"]);
    expect(directives(text, "AllowUsers").map(norm)).toEqual(["ops deploy"]);
  });

  it("AC-46: sshd перезапускается только после успешного sshd -t (R-c)", () => {
    const t = calls.findIndex((c) => /^sshd(\s.*)?\s-t(\s|$)/.test(c));
    const restart = calls.findIndex(isSshRestart);
    expect(t, "вызов sshd -t").toBeGreaterThanOrEqual(0);
    expect(restart, "systemctl restart|reload ssh").toBeGreaterThan(t);
  });

  it("AC-46: ufw — deny incoming, allow только 22/tcp, 80/tcp, 443/tcp, 443/udp, --force enable после allow 22/tcp", () => {
    const ufw = cmd(calls, "ufw");
    expect(ufw.some((c) => norm(c) === "ufw default deny incoming"), ufw.join("\n")).toBe(true);
    expect(ufw.some((c) => /^ufw default allow incoming/.test(norm(c)))).toBe(false);
    expect([...new Set(ufwAllows(calls))].sort()).toEqual(["22/tcp", "443/tcp", "443/udp", "80/tcp"]);
    const enable = ufw.findIndex((c) => hasWords(c, "--force", "enable"));
    const ssh = ufw.findIndex((c) => norm(c) === "ufw allow 22/tcp");
    expect(enable, "ufw --force enable").toBeGreaterThan(ssh);
    expect(ssh).toBeGreaterThanOrEqual(0);
  });

  it("AC-46: swap 2 ГБ — fallocate 2G, mkswap, swapon /swapfile; строка fstab одна", async () => {
    const sw = `${b.rootBash}/swapfile`;
    const fa = cmd(calls, "fallocate");
    expect(
      fa.some((c) => words(c).at(-1) === sw && /(^|\s)(-l\s*|--length[=\s])(2G|2GiB|2048M|2048MiB|2147483648)(\s|$)/.test(c)),
      fa.join("\n"),
    ).toBe(true);
    expect(cmd(calls, "mkswap").some((c) => words(c).at(-1) === sw)).toBe(true);
    expect(await b.cfgLines("swaps"), "swapon <BOOTSTRAP_ROOT>/swapfile").toEqual([sw]);
    const fstab = fileLines(await b.file("etc/fstab")).map(norm);
    expect(fstab.filter((l) => l === "/swapfile none swap sw 0 0")).toHaveLength(1);
    expect(fstab, "прежние строки fstab сохранены").toContain(norm(SEED["etc/fstab"] ?? ""));
  });

  it("AC-46: unattended-upgrades — только security, Automatic-Reboot \"false\"", async () => {
    const text = await b.file("etc/apt/apt.conf.d/52chezz-unattended");
    expect(text, "нет etc/apt/apt.conf.d/52chezz-unattended").not.toBeNull();
    expect(text).toMatch(/Unattended-Upgrade::Automatic-Reboot\s+"false"\s*;/);
    const blocks = [...(text ?? "").matchAll(/Unattended-Upgrade::(?:Allowed-Origins|Origins-Pattern)\s*\{([\s\S]*?)\}\s*;/g)];
    expect(blocks.length, "Allowed-Origins или Origins-Pattern").toBeGreaterThan(0);
    const origins = blocks.flatMap((m) =>
      [...(m[1] ?? "").replace(/\/\/.*$/gm, "").matchAll(/"([^"]*)"/g)].map((x) => x[1] ?? ""),
    );
    expect(origins.length).toBeGreaterThan(0);
    for (const o of origins) expect(o, "только security").toMatch(/security/i);
  });

  it("AC-46: /etc/docker/daemon.json = {\"log-driver\":\"journald\",\"live-restore\":true}", async () => {
    const text = await b.file("etc/docker/daemon.json");
    expect(text, "нет etc/docker/daemon.json").not.toBeNull();
    expect(JSON.parse(text ?? "null")).toEqual({ "log-driver": "journald", "live-restore": true });
  });

  it("AC-46: journald — MaxRetentionSec=14day, SystemMaxUse=1G в [Journal]", async () => {
    const text = await b.file("etc/systemd/journald.conf.d/chezz.conf");
    expect(text, "нет etc/systemd/journald.conf.d/chezz.conf").not.toBeNull();
    expect(fileLines(text)).toContain("[Journal]");
    expect(directives(text, "MaxRetentionSec")).toEqual(["14day"]);
    expect(directives(text, "SystemMaxUse")).toEqual(["1G"]);
  });

  it("AC-46: apt-get install -y — age, rclone, curl, jq, git, unattended-upgrades, docker-ce, docker-compose-plugin", () => {
    const installs = cmd(calls, "apt-get").filter((c) => words(c).includes("install"));
    expect(installs.length, "apt-get install").toBeGreaterThan(0);
    for (const c of installs) {
      expect(hasFlag(c, "y", "--yes") || words(c).includes("--assume-yes"), `без -y apt-get читает stdin (bash -s): ${c}`).toBe(true);
    }
    const pkgs = new Set(installs.flatMap(words));
    for (const p of ["age", "rclone", "curl", "jq", "git", "unattended-upgrades", "docker-ce", "docker-compose-plugin"]) {
      expect(pkgs.has(p), `пакет ${p}`).toBe(true);
    }
  });

  it("AC-46: каталоги OPERATIONS §5 п.7 созданы; compose.prod.env и compose.staging.env — пустые", async () => {
    for (const d of ["srv/chezz/repo", "srv/chezz/env", "srv/chezz/state", "var/lib/chezz", "var/backups/chezz"]) {
      expect(existsSync(b.path(d)) && (await stat(b.path(d))).isDirectory(), `каталог /${d}`).toBe(true);
    }
    expect(await b.file(`${ENV_DIR}/compose.prod.env`)).toBe("");
    expect(await b.file(`${ENV_DIR}/compose.staging.env`)).toBe("");
  });

  it("R-e: созданы пустые prod.env и staging.env (на них ссылается env_file compose)", async () => {
    expect(await b.file(`${ENV_DIR}/prod.env`), "env/prod.env").toBe("");
    expect(await b.file(`${ENV_DIR}/staging.env`), "env/staging.env").toBe("");
  });

  it.skipIf(process.platform === "win32")("R-e: права prod.env и staging.env — 600 (П4)", async () => {
    const mode = async (rel: string): Promise<string> => ((await stat(b.path(rel))).mode & 0o7777).toString(8);
    expect(await mode(`${ENV_DIR}/prod.env`)).toBe("600");
    expect(await mode(`${ENV_DIR}/staging.env`)).toBe("600");
  });

  it.skipIf(process.platform === "win32")(
    "AC-46: права — repo 755, env и state 2750 (setgid), /var/lib/chezz 770, /var/backups/chezz 700, compose.*.env 640",
    async () => {
      const mode = async (rel: string): Promise<string> => ((await stat(b.path(rel))).mode & 0o7777).toString(8);
      expect(await mode("srv/chezz/repo")).toBe("755");
      expect(await mode("srv/chezz/env")).toBe("2750");
      expect(await mode("srv/chezz/state")).toBe("2750");
      expect(((await stat(b.path("var/lib/chezz"))).mode & 0o777).toString(8)).toBe("770");
      expect(await mode("var/backups/chezz")).toBe("700");
      expect(await mode(`${ENV_DIR}/compose.prod.env`)).toBe("640");
      expect(await mode(`${ENV_DIR}/compose.staging.env`)).toBe("640");
    },
  );

  it("A7: клон — git clone --branch main <repo-url> в /srv/chezz/repo", () => {
    const clones = cmd(calls, "git").filter((c) => words(c).includes("clone"));
    expect(clones, calls.join("\n")).toHaveLength(1);
    const c = clones[0] ?? "";
    expect(hasWords(c, "--branch", "main") || hasWords(c, "-b", "main") || words(c).includes("--branch=main"), c).toBe(true);
    expect(words(c)).toContain(REPO_URL);
    expect(words(c).at(-1)?.replace(/\/$/, "")).toBe(`${b.rootBash}/srv/chezz/repo`);
  });

  it("AC-49: юниты deploy/systemd скопированы в /etc/systemd/system без изменений; chezz-watch.* нет", async () => {
    for (const u of UNITS) {
      expect(await b.file(`etc/systemd/system/${u}`), u).toBe(await readRepoFile(`deploy/systemd/${u}`));
    }
    const installed = existsSync(b.path("etc/systemd/system")) ? await readdir(b.path("etc/systemd/system")) : [];
    expect(installed.filter((n) => n.startsWith("chezz-watch"))).toEqual([]);
  });

  it("EC-35: systemctl enable --now chezz-backup.timer chezz-staging-ttl.timer", () => {
    const sc = cmd(calls, "systemctl");
    for (const t of TIMERS) expect(sc.some((c) => hasWords(c, "enable", "--now", t)), `${t}:\n${sc.join("\n")}`).toBe(true);
    expect(calls.some((c) => c.includes("chezz-watch"))).toBe(false);
  });

  it("R-e: к первому вызову docker compose файлы env/prod.env, staging.env, compose.*.env уже есть", () => {
    expect(calls.filter((c) => c.startsWith("R-E-MISSING"))).toEqual([]);
  });

  it("П10: все пути команд — под BOOTSTRAP_ROOT, в записанных файлах префикса нет", async () => {
    const pathArgs = calls
      .filter((c) => /^(chown|fallocate|mkswap|swapon|swapoff) /.test(c) || (c.startsWith("git ") && words(c).includes("clone")))
      .flatMap((c) => words(c).slice(1).filter((w) => w.startsWith("/")));
    for (const p of pathArgs) expect(p.startsWith(`${b.rootBash}/`), `путь без префикса: ${p}`).toBe(true);
    const written = Object.entries(await tree(b.root)).filter(
      ([rel, v]) => v !== "<dir>" && !rel.startsWith("srv/chezz/repo/") && rel !== "swapfile",
    );
    expect(written.length).toBeGreaterThan(0);
    for (const [rel, text] of written) {
      expect(text.includes(b.rootBash) || text.includes(b.root), `префикс в ${rel}`).toBe(false);
    }
  });
});

describe("bootstrap.sh — повторный запуск идемпотентен (AC-48, EC-36)", () => {
  let b: Boot;
  let r1: RunResult;
  let r2: RunResult;
  let first: Record<string, string>;
  let calls2: string[];
  let opsKeysBefore: string | null;
  const ENV_FILES: Record<string, string> = {
    "compose.prod.env": "PROD_APP_IMAGE=ghcr.io/test-owner/chezz-app@sha256:1\nAPP_DOMAIN=chezz.test\n",
    "compose.staging.env": "STAGING_APP_IMAGE=ghcr.io/test-owner/chezz-app-staging@sha256:a\n",
    "prod.env": "APP_ENV=prod\nPOSTGRES_PASSWORD=old-prod-pw\n",
    "ops.env": "TELEGRAM_CHAT_ID=old-chat\n",
    "staging.env": "APP_ENV=staging\nPOSTGRES_PASSWORD=old-staging-pw\n",
  };

  beforeAll(async () => {
    b = await newBoot();
    r1 = await b.run(argv(VALID));
    if (r1.code !== 0) return;
    for (const [name, text] of Object.entries(ENV_FILES)) await writeFile(b.path(`${ENV_DIR}/${name}`), text);
    await appendFile(b.path(OPS_KEYS), `${OPS_KEY_2}\n`);
    await writeFile(b.path("srv/chezz/repo/MARKER"), "клон до повтора\n");
    opsKeysBefore = await b.file(OPS_KEYS);
    first = await tree(b.root);
    await b.clearCalls();
    r2 = await b.run(argv({ ...VALID, ciProdKey: CI_PROD_KEY_2, ciStagingKey: CI_STAGING_KEY_2, opsKey: OPS_KEY_2 }));
    calls2 = await b.calls();
  }, 2 * RUN_TIMEOUT);
  afterAll(async () => await b.cleanup());

  it("EC-36: оба запуска → код 0 (пользователи и группы не создаются повторно)", async () => {
    ok(r1);
    ok(r2);
    const users = await b.cfgLines("users");
    expect(users.filter((u) => u === "ops" || u === "deploy").sort()).toEqual(["deploy", "ops"]);
  });

  it("AC-48: authorized_keys deploy пересобран ровно из двух строк с новыми ключами CI", async () => {
    expect(fileLines(await b.file(DEPLOY_KEYS))).toEqual(deployKeyLines(CI_PROD_KEY_2, CI_STAGING_KEY_2));
  });

  it("AC-48: authorized_keys ops не перезаписан и не дополнен", async () => {
    expect(opsKeysBefore).not.toBeNull();
    expect(await b.file(OPS_KEYS)).toBe(opsKeysBefore);
  });

  it("AC-48: sshd_config и 00-chezz.conf — без повторов строк", async () => {
    for (const rel of ["etc/ssh/sshd_config", SSHD_DROPIN]) expect(await b.file(rel), rel).toBe(first[rel] ?? null);
    const text = await b.file(SSHD_DROPIN);
    for (const k of ["PasswordAuthentication", "PermitRootLogin", "AllowUsers"]) expect(directives(text, k)).toHaveLength(1);
  });

  it("AC-48: fstab — строка swap одна, swap-файл не пересоздаётся", async () => {
    expect(await b.file("etc/fstab")).toBe(first["etc/fstab"]);
    expect(fileLines(await b.file("etc/fstab")).map(norm).filter((l) => l === "/swapfile none swap sw 0 0")).toHaveLength(1);
    expect(cmd(calls2, "fallocate")).toEqual([]);
    expect(cmd(calls2, "mkswap")).toEqual([]);
  });

  it("AC-48: правила ufw те же — только 22/tcp, 80/tcp, 443/tcp, 443/udp", () => {
    expect([...new Set(ufwAllows(calls2))].sort()).toEqual(["22/tcp", "443/tcp", "443/udp", "80/tcp"]);
  });

  it("AC-48: существующие файлы /srv/chezz/env не перезаписаны", async () => {
    for (const [name, text] of Object.entries(ENV_FILES)) expect(await b.file(`${ENV_DIR}/${name}`), name).toBe(text);
  });

  it("EC-36: существующий клон не трогается — ни clone, ни fetch/checkout/reset/pull", async () => {
    const git = cmd(calls2, "git").filter((c) => ["clone", "fetch", "checkout", "reset", "pull", "switch"].some((w) => words(c).includes(w)));
    expect(git).toEqual([]);
    expect(await b.file("srv/chezz/repo/MARKER")).toBe("клон до повтора\n");
  });

  it("EC-36: таймеры снова enable --now, конфиги совпадают с первым запуском", async () => {
    for (const t of TIMERS) expect(cmd(calls2, "systemctl").some((c) => hasWords(c, "enable", "--now", t)), t).toBe(true);
    for (const rel of [
      "etc/docker/daemon.json",
      "etc/systemd/journald.conf.d/chezz.conf",
      "etc/apt/apt.conf.d/52chezz-unattended",
      ...UNITS.map((u) => `etc/systemd/system/${u}`),
    ]) {
      expect(await b.file(rel), rel).toBe(first[rel] ?? null);
    }
  });
});

describe("bootstrap.sh — sshd -t не прошёл (R-c)", () => {
  it("R-c: sshd -t → ошибка: sshd не перезапускается, код ≠ 0", async () => {
    const b = await newBoot();
    try {
      await b.setCfg("sshd_bad", "");
      const r = await b.run(argv(VALID));
      const calls = await b.calls();
      expect(calls.some((c) => /^sshd(\s.*)?\s-t(\s|$)/.test(c)), "вызов sshd -t").toBe(true);
      expect(calls.filter(isSshRestart), "restart/reload ssh при неверном конфиге").toEqual([]);
      expect(r.code, tail(r.stdout + r.stderr)).not.toBe(0);
    } finally {
      await b.cleanup();
    }
  }, RUN_TIMEOUT);
});
