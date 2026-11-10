// deploy/systemd/*.{service,timer} — статический разбор юнитов (E02 T-4; OPERATIONS §5 п.8, §9.6, §14.1; design A1, A5, П10).
// `systemd-analyze verify` (AC-49) заменён разбором (design A1): синтаксис ini, допустимые секции, поля и значения П10.
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, readRepoFile } from "./support/index.ts";

type Unit = Map<string, Map<string, string[]>>;

/** Разбор юнита: секция → ключ → значения (повторы ключа сохраняются по порядку). Ошибка синтаксиса — исключение. */
function parseUnit(text: string, name: string): Unit {
  const unit: Unit = new Map();
  let section: Map<string, string[]> | null = null;
  text.split(/\r?\n/).forEach((raw, i) => {
    const l = raw.trim();
    if (l === "" || l.startsWith("#") || l.startsWith(";")) return;
    const sec = /^\[([A-Za-z]+)\]$/.exec(l);
    if (sec) {
      const s = sec[1] ?? "";
      if (unit.has(s)) throw new Error(`${name}:${i + 1}: секция [${s}] повторяется`);
      section = new Map();
      unit.set(s, section);
      return;
    }
    const kv = /^([A-Z][A-Za-z0-9]*)\s*=\s*(.*)$/.exec(l);
    if (!kv) throw new Error(`${name}:${i + 1}: не «Ключ=значение»: ${raw}`);
    if (section === null) throw new Error(`${name}:${i + 1}: ключ вне секции`);
    const cur: Map<string, string[]> = section;
    const k = kv[1] ?? "";
    cur.set(k, [...(cur.get(k) ?? []), (kv[2] ?? "").trim()]);
  });
  return unit;
}

const loadUnit = async (name: string): Promise<Unit> => parseUnit(await readRepoFile(`deploy/systemd/${name}`), name);
const values = (u: Unit, section: string, key: string): string[] => u.get(section)?.get(key) ?? [];

const BACKUP_EXEC = "/usr/bin/flock -w 900 /srv/chezz/state/lock /srv/chezz/repo/deploy/remote/backup.sh --reason daily";
const TTL_EXEC = "/usr/bin/flock -w 60 /srv/chezz/state/lock /srv/chezz/repo/deploy/remote/staging-ttl.sh";

const SERVICES: [string, string][] = [
  ["chezz-backup.service", BACKUP_EXEC],
  ["chezz-staging-ttl.service", TTL_EXEC],
];
const TIMERS: [string, string][] = [
  ["chezz-backup.timer", "*-*-* 03:30:00 UTC"],
  ["chezz-staging-ttl.timer", "*:0/30"],
];
const ALL = [...SERVICES, ...TIMERS].map(([n]) => n);

describe("deploy/systemd — состав (AC-49)", () => {
  it.each(ALL)("AC-49: deploy/systemd/%s есть", (name) => {
    expect(existsSync(join(REPO_ROOT, "deploy", "systemd", name)), `нет deploy/systemd/${name}`).toBe(true);
  });

  it("AC-49: chezz-watch.* в E02 нет", async () => {
    const dir = join(REPO_ROOT, "deploy", "systemd");
    expect(existsSync(dir), "нет deploy/systemd").toBe(true);
    expect((await readdir(dir)).filter((n) => n.startsWith("chezz-watch"))).toEqual([]);
  });
});

describe("deploy/systemd — синтаксис вместо systemd-analyze verify (AC-49, design A1)", () => {
  it.each(ALL)("AC-49: %s — только [Секция] и Ключ=значение, секции допустимы для типа", async (name) => {
    const u = await loadUnit(name);
    const allowed = name.endsWith(".timer") ? ["Unit", "Timer", "Install"] : ["Unit", "Service", "Install"];
    for (const s of u.keys()) expect(allowed, `секция [${s}] в ${name}`).toContain(s);
    expect(u.has(name.endsWith(".timer") ? "Timer" : "Service"), name).toBe(true);
  });
});

describe("deploy/systemd — сервисы (AC-49, A5, П10)", () => {
  it.each(SERVICES)("AC-49: %s — Type=oneshot, User=deploy, ExecStart с flock (A5)", async (name, exec) => {
    const u = await loadUnit(name);
    expect(values(u, "Service", "Type")).toEqual(["oneshot"]);
    expect(values(u, "Service", "User")).toEqual(["deploy"]);
    expect(values(u, "Service", "ExecStart")).toEqual([exec]);
  });

  // Бит x скриптов проверяет remote/syntax.test.ts (AC-45).
  it.each(SERVICES)("AC-49: %s — скрипт ExecStart есть в репозитории (путь клона /srv/chezz/repo)", (_name, exec) => {
    const script = exec.split(/\s+/).find((w) => w.startsWith("/srv/chezz/repo/")) ?? "";
    const rel = script.replace("/srv/chezz/repo/", "");
    expect(existsSync(join(REPO_ROOT, rel)), `нет ${rel}`).toBe(true);
  });
});

describe("deploy/systemd — таймеры (AC-49, EC-35)", () => {
  it.each(TIMERS)("AC-49: %s — OnCalendar=%s", async (name, calendar) => {
    const u = await loadUnit(name);
    expect(values(u, "Timer", "OnCalendar")).toEqual([calendar]);
  });

  it("AC-49: chezz-backup.timer — Persistent=true (пропущенный запуск выполняется после загрузки)", async () => {
    expect(values(await loadUnit("chezz-backup.timer"), "Timer", "Persistent")).toEqual(["true"]);
  });

  it.each(TIMERS)("AC-49: %s запускает одноимённый сервис (Unit= нет или совпадает)", async (name) => {
    const unit = values(await loadUnit(name), "Timer", "Unit");
    const service = name.replace(/\.timer$/, ".service");
    expect(unit.length === 0 || (unit.length === 1 && unit[0] === service), `Unit=${unit.join(",")}`).toBe(true);
  });

  it.each(TIMERS)("EC-35: %s — [Install] WantedBy=timers.target (enabled переживает перезагрузку)", async (name) => {
    const wanted = values(await loadUnit(name), "Install", "WantedBy").flatMap((v) => v.split(/\s+/));
    expect(wanted).toContain("timers.target");
  });
});

describe("deploy/systemd — нет данных среды (AC-47)", () => {
  it.each(ALL)("AC-47: %s — нет IP, e-mail, логина владельца, example.com", async (name) => {
    const text = await readRepoFile(`deploy/systemd/${name}`);
    expect(text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? [], "IPv4").toEqual([]);
    expect(text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g) ?? [], "e-mail").toEqual([]);
    expect(text.match(/(github\.com|ghcr\.io)[/:][A-Za-z0-9][A-Za-z0-9-]*/g) ?? [], "логин владельца").toEqual([]);
    expect(text.includes("example.com")).toBe(false);
  });
});
