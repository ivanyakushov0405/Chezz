// deploy.yml, job plan: шаги validate, base, diff, prs выполняются дословно (E02 T-5; OPERATIONS §9.2, §9.2а;
// design П11, A10). Временный git-репозиторий, подмена gh: фильтр -q применяет настоящий jq к JSON-фикстуре.
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  execStep,
  loadWorkflow,
  makeTempDir,
  prepareBin,
  runOf,
  writeFake,
  type StepRun,
  type Workflow,
} from "../support/index.ts";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const DIGEST = `sha256:${"c".repeat(64)}`;

let wf: Workflow;
let tmp: { dir: string; cleanup: () => Promise<void> };
let bin: string;

beforeAll(async () => {
  wf = await loadWorkflow(".github/workflows/deploy.yml");
  tmp = await makeTempDir("chezz-wf-plan-");
  bin = join(tmp.dir, "bin");
  await prepareBin(bin);
  await writeFake(
    bin,
    "gh",
    [
      `printf '%s\\n' "gh $*" >> "$GH_LOG"`,
      `q=""; prev=""; for a in "$@"; do [ "$prev" = "-q" ] && q="$a"; prev="$a"; done`,
      `case "$1 $2" in`,
      `  "run list") cat "$GH_FIX/runs.json" ;;`,
      `  "pr view") jq -r "$q" < "$GH_FIX/pr/$3.json" ;;`,
      `  *) if [ "$1" = api ]; then`,
      `       c="\${2##*/commits/}"; c="\${c%/pulls}"; f="$GH_FIX/pulls/$c.json"`,
      `       [ -f "$f" ] || f="$GH_FIX/empty.json"`,
      `       jq -r "$q" < "$f"`,
      `     else echo "unexpected: gh $*" >&2; exit 99; fi ;;`,
      `esac`,
    ].join("\n"),
  );
});

afterAll(async () => {
  await tmp?.cleanup();
});

let n = 0;
/** Новый каталог сценария: фикстуры gh, лог вызовов. */
async function scenario(fix: { runs?: unknown[]; pulls?: Record<string, unknown[]>; prs?: Record<string, unknown> } = {}) {
  const dir = join(tmp.dir, `s${++n}`);
  const ghFix = join(dir, "gh");
  await mkdir(join(ghFix, "pulls"), { recursive: true });
  await mkdir(join(ghFix, "pr"), { recursive: true });
  await writeFile(join(ghFix, "runs.json"), JSON.stringify(fix.runs ?? []));
  await writeFile(join(ghFix, "empty.json"), "[]");
  for (const [c, v] of Object.entries(fix.pulls ?? {})) await writeFile(join(ghFix, "pulls", `${c}.json`), JSON.stringify(v));
  for (const [p, v] of Object.entries(fix.prs ?? {})) await writeFile(join(ghFix, "pr", `${p}.json`), JSON.stringify(v));
  const log = join(dir, "gh.log");
  await writeFile(log, "");
  return {
    dir,
    env: { GH_FIX: ghFix, GH_LOG: log, GH_TOKEN: "test-token", GITHUB_REPOSITORY: "Test-Owner/chezz" },
    ghCalls: async () => (await readFile(log, "utf8")).split(/\r?\n/).filter((l) => l !== ""),
  };
}

async function run(id: string, env: Record<string, string>, s?: Awaited<ReturnType<typeof scenario>>, cwd?: string): Promise<StepRun> {
  const sc = s ?? (await scenario());
  return await execStep(runOf(wf, "plan", id), { dir: sc.dir, cwd, fakeBin: bin, env: { ...sc.env, ...env } });
}

// --- validate ---------------------------------------------------------------------------------

interface Inputs {
  env: string;
  action: string;
  image?: string;
  force?: boolean;
  bootstrap?: boolean;
  ref?: string;
}
const validate = async (i: Inputs) =>
  await run("validate", {
    IN_ENV: i.env,
    IN_ACTION: i.action,
    IN_IMAGE: i.image ?? "",
    IN_FORCE: String(i.force ?? false),
    IN_BOOTSTRAP: String(i.bootstrap ?? false),
    GIT_REF: i.ref ?? "refs/heads/main",
  });

describe("deploy.yml plan.validate", () => {
  it.each<[string, Inputs]>([
    ["staging deploy из ветки", { env: "staging", action: "deploy", ref: "refs/heads/feature/x" }],
    ["staging down", { env: "staging", action: "down", ref: "refs/heads/feature/x" }],
    ["prod deploy с main", { env: "prod", action: "deploy" }],
    ["prod deploy force", { env: "prod", action: "deploy", force: true }],
    ["prod deploy bootstrap", { env: "prod", action: "deploy", bootstrap: true }],
    ["prod rollback", { env: "prod", action: "rollback" }],
    ["prod rollback с digest", { env: "prod", action: "rollback", image: DIGEST }],
  ])("К-53: допустимое сочетание — %s → код 0", async (_, i) => {
    const r = await validate(i);
    expect(r.code, r.stdout + r.stderr).toBe(0);
  });

  it.each<[string, Inputs]>([
    ["prod + down", { env: "prod", action: "down" }],
    ["staging + rollback", { env: "staging", action: "rollback" }],
    ["prod deploy не с main", { env: "prod", action: "deploy", ref: "refs/heads/feature/x" }],
    ["prod rollback не с main", { env: "prod", action: "rollback", ref: "refs/tags/v1" }],
    ["bootstrap при staging", { env: "staging", action: "deploy", bootstrap: true }],
    ["bootstrap при rollback", { env: "prod", action: "rollback", bootstrap: true }],
    ["image при deploy", { env: "prod", action: "deploy", image: DIGEST }],
    ["image при staging deploy", { env: "staging", action: "deploy", image: DIGEST }],
    ["image не digest", { env: "prod", action: "rollback", image: "sha-abc" }],
    ["image с заглавными", { env: "prod", action: "rollback", image: `sha256:${"C".repeat(64)}` }],
    ["image короткий", { env: "prod", action: "rollback", image: `sha256:${"c".repeat(63)}` }],
    ["image с хвостом", { env: "prod", action: "rollback", image: `${DIGEST} x` }],
  ])("К-53 EC-1: %s → отказ plan", async (_, i) => {
    const r = await validate(i);
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/::error::/);
  });

  it.each<[string, Inputs]>([
    ["force при staging", { env: "staging", action: "deploy", force: true }],
    ["force при rollback", { env: "prod", action: "rollback", force: true }],
    ["force при down", { env: "staging", action: "down", force: true }],
  ])("К-53 A10: %s → отказ plan", async (_, i) => {
    const r = await validate(i);
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/force/);
  });
});

// --- base -------------------------------------------------------------------------------------

const GH_RUN_LIST =
  "gh run list --workflow deploy.yml --branch main --event workflow_dispatch --json displayTitle,headSha,conclusion -L 200";

describe("deploy.yml plan.base", () => {
  it.each([
    ["staging", "deploy"],
    ["staging", "down"],
    ["prod", "rollback"],
  ])("К-53: %s %s — base пустой, gh не вызывается", async (env, action) => {
    const s = await scenario({ runs: [{ displayTitle: "prod deploy", headSha: SHA_A, conclusion: "success" }] });
    const r = await run("base", { IN_ENV: env, IN_ACTION: action, IN_BOOTSTRAP: "false" }, s);
    expect(r.code, r.stderr).toBe(0);
    expect(r.outputs).toEqual({ base: "", list_base: "" });
    expect(await s.ghCalls()).toEqual([]);
  });

  it("К-53: base — headSha последнего успешного prod deploy, вызов gh run list дословно", async () => {
    const s = await scenario({
      runs: [
        { displayTitle: "prod deploy", headSha: "1".repeat(40), conclusion: "failure" },
        { displayTitle: "staging deploy", headSha: "2".repeat(40), conclusion: "success" },
        { displayTitle: "prod rollback", headSha: "3".repeat(40), conclusion: "success" },
        { displayTitle: "prod deploy", headSha: SHA_A, conclusion: "success" },
        { displayTitle: "prod deploy", headSha: SHA_B, conclusion: "success" },
      ],
    });
    const r = await run("base", { IN_ENV: "prod", IN_ACTION: "deploy", IN_BOOTSTRAP: "false" }, s);
    expect(r.code, r.stderr).toBe(0);
    expect(r.outputs).toEqual({ base: SHA_A, list_base: SHA_A });
    expect(await s.ghCalls()).toEqual([GH_RUN_LIST]);
  });

  it("К-53 EC-2: успешного prod deploy нет, без bootstrap → отказ с «bootstrap=true»", async () => {
    const s = await scenario({ runs: [{ displayTitle: "prod deploy", headSha: SHA_A, conclusion: "failure" }] });
    const r = await run("base", { IN_ENV: "prod", IN_ACTION: "deploy", IN_BOOTSTRAP: "false" }, s);
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toContain("bootstrap=true");
    expect(r.outputs["base"]).toBeUndefined();
  });

  it("К-56: bootstrap без успешного prod deploy — base=bootstrap, list_base пустой, без ошибки", async () => {
    const s = await scenario({ runs: [] });
    const r = await run("base", { IN_ENV: "prod", IN_ACTION: "deploy", IN_BOOTSTRAP: "true" }, s);
    expect(r.code, r.stderr).toBe(0);
    expect(r.outputs).toEqual({ base: "bootstrap", list_base: "" });
  });

  it("К-56 EC-3: bootstrap с успешным prod deploy в истории — list_base = его headSha", async () => {
    const s = await scenario({ runs: [{ displayTitle: "prod deploy", headSha: SHA_B, conclusion: "success" }] });
    const r = await run("base", { IN_ENV: "prod", IN_ACTION: "deploy", IN_BOOTSTRAP: "true" }, s);
    expect(r.code, r.stderr).toBe(0);
    expect(r.outputs).toEqual({ base: "bootstrap", list_base: SHA_B });
  });
});

// --- diff и prs на тестовой истории -------------------------------------------------------------

/** История: base → A, B (PR 5, rebase) → C (вне PR) → M (merge-коммит PR 7 из ветки с двумя коммитами). */
interface History {
  repo: string;
  base: string;
  a: string;
  b: string;
  c: string;
  m: string;
  side: string[];
}

let hist: History;

function git(repo: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args], {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test Dev",
      GIT_AUTHOR_EMAIL: "dev@chezz.test",
      GIT_COMMITTER_NAME: "Test Dev",
      GIT_COMMITTER_EMAIL: "dev@chezz.test",
    },
  }).trim();
}

async function commit(repo: string, file: string, msg: string): Promise<string> {
  await mkdir(join(repo, file, ".."), { recursive: true });
  await writeFile(join(repo, file), `${msg}\n`, { flag: "a" });
  git(repo, "add", "--", file);
  git(repo, "commit", "-q", "-m", msg);
  return git(repo, "rev-parse", "HEAD");
}

beforeAll(async () => {
  const repo = join(tmp.dir, "repo");
  await mkdir(repo, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  await commit(repo, ".github/workflows/ci.yml", "ci");
  const base = await commit(repo, "deploy/compose.yml", "base");
  const a = await commit(repo, "deploy/remote/deploy.sh", "PR5 part 1");
  const b = await commit(repo, "apps/web/src/x.ts", "PR5 part 2");
  const c = await commit(repo, "scripts/ops/x.sh", "direct | push <!-- `x` >");
  git(repo, "switch", "-q", "-c", "side");
  const s1 = await commit(repo, "apps/server/migrations/0001.sql", "side 1");
  const s2 = await commit(repo, "apps/server/src/y.ts", "side 2");
  git(repo, "switch", "-q", "main");
  git(repo, "merge", "-q", "--no-ff", "-m", "Merge pull request #7", "side");
  const m = git(repo, "rev-parse", "HEAD");
  hist = { repo, base, a, b, c, m, side: [s1, s2] };
});

const pr = (num: number, title: string, oid: string, mergedAt: string) => ({
  number: num,
  title,
  author: { login: "test-dev" },
  mergedBy: { login: "test-owner" },
  mergedAt,
  mergeCommit: { oid },
});

function prFixture() {
  return {
    pulls: {
      [hist.a]: [{ number: 5, merged_at: "2026-11-01T10:00:00Z" }],
      [hist.b]: [
        { number: 4, merged_at: null },
        { number: 5, merged_at: "2026-11-01T10:00:00Z" },
      ],
      [hist.m]: [{ number: 7, merged_at: "2026-11-02T11:00:00Z" }],
      // коммиты ветки не на first-parent — не запрашиваются
      [hist.side[0]!]: [{ number: 99, merged_at: "2026-11-02T11:00:00Z" }],
    },
    prs: {
      "5": pr(5, "deploy: scripts", hist.b, "2026-11-01T10:00:00Z"),
      "7": pr(7, "evil | title <!-- hide `rows` >", hist.m, "2026-11-02T11:00:00Z"),
    },
  };
}

describe("deploy.yml plan.diff", () => {
  it("К-54: BASE пустой (staging, rollback) — итог не пишется", async () => {
    const r = await run("diff", { BASE: "" }, undefined, hist.repo);
    expect(r.code, r.stderr).toBe(0);
    expect(r.summary).toBe("");
  });

  it("К-54: git diff --stat BASE..HEAD только по deploy/, scripts/ops/, .github/, apps/server/migrations/", async () => {
    const r = await run("diff", { BASE: hist.base }, undefined, hist.repo);
    expect(r.code, r.stderr).toBe(0);
    expect(r.summary).toContain(hist.base);
    expect(r.summary).toContain("deploy/remote/deploy.sh");
    expect(r.summary).toContain("scripts/ops/x.sh");
    expect(r.summary).toContain("apps/server/migrations/0001.sql");
    expect(r.summary).not.toContain("apps/web/src/x.ts");
    expect(r.summary).not.toContain("apps/server/src/y.ts");
  });

  it("К-56: bootstrap — полный git ls-files deploy/ .github/ и «bootstrap: проверка базы пропущена»", async () => {
    const r = await run("diff", { BASE: "bootstrap" }, undefined, hist.repo);
    expect(r.code, r.stderr).toBe(0);
    expect(r.summary).toContain("bootstrap: проверка базы пропущена");
    for (const f of [".github/workflows/ci.yml", "deploy/compose.yml", "deploy/remote/deploy.sh"]) expect(r.summary).toContain(f);
    expect(r.summary).not.toContain("scripts/ops/x.sh");
  });
});

describe("deploy.yml plan.prs (O45)", () => {
  const rowsOf = (summary: string) => summary.split(/\r?\n/).filter((l) => l.startsWith("| ") && !l.startsWith("| PR |"));

  it("К-54 К-55: таблица O45, один PR на rebase-мерж (EC-7), коммит вне PR (EC-6), экранирование (EC-4)", async () => {
    const s = await scenario(prFixture());
    const r = await run("prs", { BASE: hist.base, LIST_BASE: hist.base }, s, hist.repo);
    expect(r.code, r.stderr).toBe(0);
    expect(r.summary).toContain("| PR | Заголовок | Автор | Смержил | Когда (UTC) | Коммит |");
    const rows = rowsOf(r.summary);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toBe(`| #5 | deploy: scripts | test-dev | test-owner | 2026-11-01T10:00:00Z | ${hist.b.slice(0, 7)} |`);
    expect(rows[1]).toContain("**коммит вне PR**");
    expect(rows[1]).toContain(hist.c.slice(0, 7));
    expect(rows[1]).toContain("direct _ push _!-- _x_ _");
    expect(rows[2]).toBe(
      `| #7 | evil _ title _!-- hide _rows_ _ | test-dev | test-owner | 2026-11-02T11:00:00Z | ${hist.m.slice(0, 7)} |`,
    );
    for (const row of rows) expect(row.split("|")).toHaveLength(8);
    expect(r.summary).not.toMatch(/<!--/);
    expect(r.summary.trimEnd().split(/\r?\n/).at(-1)).toBe("PR: 2, коммитов вне PR: 1");
  });

  it("К-55 EC-7: gh api — только коммиты first-parent, путь repos/<repo>/commits/<sha>/pulls", async () => {
    const s = await scenario(prFixture());
    await run("prs", { BASE: hist.base, LIST_BASE: hist.base }, s, hist.repo);
    const api = (await s.ghCalls()).filter((c) => c.startsWith("gh api "));
    expect(api.map((c) => c.split(" ")[2])).toEqual(
      [hist.a, hist.b, hist.c, hist.m].map((c) => `repos/Test-Owner/chezz/commits/${c}/pulls`),
    );
    const views = (await s.ghCalls()).filter((c) => c.startsWith("gh pr view "));
    expect(views.map((c) => c.split(" ")[3])).toEqual(["5", "7"]);
  });

  it("К-55 EC-5: пустой диапазон (база = HEAD) — «новых коммитов нет», без таблицы", async () => {
    const s = await scenario();
    const r = await run("prs", { BASE: hist.m, LIST_BASE: hist.m }, s, hist.repo);
    expect(r.code, r.stderr).toBe(0);
    expect(r.summary).toContain("новых коммитов нет");
    expect(r.summary).not.toContain("| PR |");
    expect(await s.ghCalls()).toEqual([]);
  });

  it("К-56: bootstrap без базы списка — «bootstrap: список PR не строится»", async () => {
    const s = await scenario();
    const r = await run("prs", { BASE: "bootstrap", LIST_BASE: "" }, s, hist.repo);
    expect(r.code, r.stderr).toBe(0);
    expect(r.summary).toContain("bootstrap: список PR не строится");
    expect(await s.ghCalls()).toEqual([]);
  });

  it("К-56 EC-3: bootstrap с найденной базой — список от неё", async () => {
    const s = await scenario(prFixture());
    const r = await run("prs", { BASE: "bootstrap", LIST_BASE: hist.c }, s, hist.repo);
    expect(r.code, r.stderr).toBe(0);
    expect(rowsOf(r.summary)).toHaveLength(1);
    expect(r.summary.trimEnd().split(/\r?\n/).at(-1)).toBe("PR: 1, коммитов вне PR: 0");
  });

  it("К-54: BASE пустой (staging, rollback) — список не строится", async () => {
    const s = await scenario();
    const r = await run("prs", { BASE: "", LIST_BASE: "" }, s, hist.repo);
    expect(r.code, r.stderr).toBe(0);
    expect(r.summary).toBe("");
    expect(await s.ghCalls()).toEqual([]);
  });
});
