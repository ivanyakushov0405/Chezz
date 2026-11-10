// deploy.yml: разбор и выполнение шагов build и SSH с подменой docker/ssh (E02 T-5; OPERATIONS §9.2, §9.6, §7;
// design П11, П4). Сам VPS здесь не участвует: команды entry.sh проверяют tests/deploy/remote/.
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  allowlistKeys,
  execStep,
  job,
  loadWorkflow,
  makeTempDir,
  prepareBin,
  REPO_ROOT,
  runCmd,
  runOf,
  step,
  walkStrings,
  writeWorkflowFakes,
  type Workflow,
} from "../support/index.ts";

const FILE = ".github/workflows/deploy.yml";
const SHA = "e".repeat(40);
const BASE = "d".repeat(40);
const DIGEST = `sha256:${"c".repeat(64)}`;
const COND = (env: string) =>
  `always() && needs.plan.result == 'success' && inputs.env == '${env}' && (needs.build.result == 'success' || needs.build.result == 'skipped')`;

let wf: Workflow;
let tmp: { dir: string; cleanup: () => Promise<void> };
let bin: string;

beforeAll(async () => {
  wf = await loadWorkflow(FILE);
  tmp = await makeTempDir("chezz-wf-static-");
  bin = join(tmp.dir, "bin");
  await prepareBin(bin);
  await writeWorkflowFakes(bin);
});

afterAll(async () => {
  await tmp?.cleanup();
});

let n = 0;
async function exec(jobName: string, id: string, env: Record<string, string>) {
  const dir = join(tmp.dir, `x${++n}`);
  await runCmd("mkdir", ["-p", join(dir, "runner_temp")]);
  const log = join(dir, "fake.log");
  const r = await execStep(runOf(wf, jobName, id), {
    dir,
    cwd: dir,
    fakeBin: bin,
    env: {
      FAKE_DIR: dir,
      FAKE_LOG: log,
      GITHUB_SHA: SHA,
      GITHUB_REPOSITORY: "Test-Owner/chezz",
      GITHUB_REPOSITORY_OWNER: "Test-Owner",
      GITHUB_ACTOR: "test-owner",
      ...env,
    },
  });
  const calls = existsSync(log) ? (await readFile(log, "utf8")).split(/\r?\n/).filter((l) => l !== "") : [];
  const read = async (f: string) => (existsSync(join(dir, f)) ? await readFile(join(dir, f), "utf8") : null);
  const tempLeft = await readdir(join(dir, "runner_temp"));
  return { ...r, calls, read, tempLeft };
}

const SSH_BASE = {
  VPS_HOST: "vps.chezz.test",
  VPS_HOST_KEY: "vps.chezz.test ssh-ed25519 AAAATESTHOSTKEY",
  SSH_DEPLOY_KEY: "-----BEGIN TEST KEY-----\nTESTKEYBODY\n-----END TEST KEY-----",
};

/** Значение каждого ключа = «v-<ключ>», чтобы проверять, что дошло до stdin. */
const valued = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, `v-${k}`]));
const stdinKeys = (s: string | null) =>
  (s ?? "")
    .split(/\r?\n/)
    .filter((l) => l !== "")
    .map((l) => l.slice(0, l.indexOf("=")));

describe("deploy.yml: триггеры, входы, права", () => {
  it("К-50 EC-41: check-workflows.sh зелёный", async () => {
    const r = await runCmd("bash", ["scripts/check-workflows.sh"], { cwd: REPO_ROOT });
    expect(r.code, r.stderr).toBe(0);
  });

  it("К-50 EC-41: только workflow_dispatch; права job по OPERATIONS §9.2, верхний уровень пустой", () => {
    expect(Object.keys(wf.on)).toEqual(["workflow_dispatch"]);
    expect(wf.permissions).toEqual({});
    expect(job(wf, "plan").permissions).toEqual({ contents: "read", actions: "read", "pull-requests": "read" });
    expect(job(wf, "build").permissions).toEqual({ contents: "read", packages: "write" });
    expect(job(wf, "prod").permissions).toEqual({ contents: "read" });
    expect(job(wf, "staging").permissions).toEqual({ contents: "read" });
    expect(Object.keys(wf.jobs).sort()).toEqual(["build", "plan", "prod", "staging"]);
  });

  it("К-51: входы env, action, image, force, bootstrap", () => {
    const inputs = (wf.on["workflow_dispatch"] as { inputs: Record<string, Record<string, unknown>> }).inputs;
    expect(Object.keys(inputs).sort()).toEqual(["action", "bootstrap", "env", "force", "image"]);
    expect(inputs["env"]).toMatchObject({ type: "choice", options: ["staging", "prod"] });
    expect(inputs["action"]).toMatchObject({ type: "choice", options: ["deploy", "rollback", "down"], default: "deploy" });
    expect(inputs["image"]).toMatchObject({ type: "string" });
    expect(inputs["force"]).toMatchObject({ type: "boolean", default: false });
    expect(inputs["bootstrap"]).toMatchObject({ type: "boolean", default: false });
  });

  it("К-51 EC-30 EC-32: run-name и concurrency deploy-<env> без cancel-in-progress", () => {
    expect(wf["run-name"]).toBe("${{ inputs.env }} ${{ inputs.action }}");
    expect(wf.concurrency?.group).toBe("deploy-${{ inputs.env }}");
    expect(wf.concurrency?.["cancel-in-progress"]).toBeUndefined();
  });
});

describe("deploy.yml: выражения и секреты", () => {
  const steps = () => Object.entries(wf.jobs).flatMap(([j, jb]) => jb.steps.map((s) => ({ j, s })));

  it("К-52: в run: нет ${{ }}", () => {
    for (const { j, s } of steps()) if (s.run) expect(s.run, `${j}.${s.id}`).not.toContain("${{");
  });

  it("К-52: secrets.* — только в env: шагов", () => {
    const hits = walkStrings(wf).filter((x) => x.value.includes("secrets."));
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.path.join("."), h.value).toMatch(/^jobs\.(prod|staging)\.steps\.\d+\.env\.[A-Z0-9_]+$/);
  });

  it("К-52: нет set -x, printenv, env без аргументов; секреты в run: — только запись ключа в файл", () => {
    for (const { j, s } of steps()) {
      if (!s.run) continue;
      expect(s.run, `${j}.${s.id}`).not.toMatch(/set\s+-[a-z]*x|\bprintenv\b|(^|[;|&]\s*)env\s*($|[;|&])/m);
      const secretVars = Object.entries(s.env ?? {})
        .filter(([, v]) => v.includes("secrets."))
        .map(([k]) => k);
      for (const line of s.run.split("\n")) {
        for (const v of secretVars) {
          if (!new RegExp(`\\$\\{?${v}\\b`).test(line)) continue;
          expect(line.trim(), `${j}.${s.id}: ${v}`).toBe(`printf '%s\\n' "$${v}" > "$KEY"`);
        }
      }
    }
  });

  it("К-57: job plan и build без секретов environment, без environment", () => {
    for (const name of ["plan", "build"]) {
      expect(job(wf, name).environment).toBeUndefined();
      expect(JSON.stringify(job(wf, name))).not.toMatch(/secrets\.|vars\./);
    }
  });
});

describe("deploy.yml: plan", () => {
  it("К-53 К-54: шаги validate, base, diff, prs; checkout с fetch-depth 0; файлов репозитория не запускает", () => {
    const p = job(wf, "plan");
    expect(p.steps.filter((s) => s.id).map((s) => s.id)).toEqual(["validate", "base", "diff", "prs"]);
    const co = p.steps.filter((s) => s.uses);
    expect(co).toHaveLength(1);
    expect(co[0]!.uses).toMatch(/^actions\/checkout@/);
    expect(co[0]!.with).toMatchObject({ "fetch-depth": 0, "persist-credentials": false });
    expect(p.outputs).toEqual({ base: "${{ steps.base.outputs.base }}" });
    for (const s of p.steps)
      if (s.run) expect(s.run, s.id).not.toMatch(/(^|\s)(bash|sh|source|\.)\s+\S+|\.\/[\w./-]+|\bnpm\b|\bnode\b|\bnpx\b/m);
  });
});

describe("deploy.yml: build", () => {
  it("К-57: только при action == 'deploy', needs plan, одна сторонняя action — checkout", () => {
    const b = job(wf, "build");
    expect(b.needs).toBe("plan");
    expect(b.if).toBe("inputs.action == 'deploy'");
    expect(b.steps.filter((s) => s.uses).map((s) => s.uses!.split("@")[0])).toEqual(["actions/checkout"]);
    expect(step(wf, "build", "build").env).toMatchObject({ APP_VERSION: "${{ github.sha }}", IN_ENV: "${{ inputs.env }}" });
    expect(b.outputs).toEqual({
      app_digest: "${{ steps.build.outputs.app_digest }}",
      tools_digest: "${{ steps.build.outputs.tools_digest }}",
    });
  });

  it("К-57: prod — app в ghcr.io/<owner в нижнем регистре>/chezz-app:sha-<sha>, метки, --push --metadata-file, выход digest", async () => {
    const r = await exec("build", "build", { IN_ENV: "prod", APP_VERSION: SHA, GHCR_TOKEN: "ghs-test-token" });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const builds = r.calls.filter((c) => c.startsWith("docker buildx build "));
    expect(builds).toHaveLength(1);
    const c = builds[0]!;
    for (const part of [
      "--push",
      "--metadata-file",
      "-f deploy/Dockerfile",
      "--target app",
      `--build-arg APP_VERSION=${SHA}`,
      `--label org.opencontainers.image.revision=${SHA}`,
      "--label org.opencontainers.image.source=https://github.com/Test-Owner/chezz",
      `-t ghcr.io/test-owner/chezz-app:sha-${SHA}`,
    ])
      expect(c).toContain(part);
    expect(r.outputs).toEqual({ app_digest: `sha256:${"1".repeat(64)}` });
  });

  it("К-57: staging — app в chezz-app-staging и tools в chezz-tools-staging", async () => {
    const r = await exec("build", "build", { IN_ENV: "staging", APP_VERSION: SHA, GHCR_TOKEN: "ghs-test-token" });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const tags = r.calls.filter((c) => c.startsWith("docker buildx build ")).map((c) => /-t (\S+)/.exec(c)?.[1]);
    expect(tags).toEqual([`ghcr.io/test-owner/chezz-app-staging:sha-${SHA}`, `ghcr.io/test-owner/chezz-tools-staging:sha-${SHA}`]);
    expect(r.outputs).toEqual({ app_digest: `sha256:${"1".repeat(64)}`, tools_digest: `sha256:${"2".repeat(64)}` });
  });

  it("К-57: вход в GHCR — токен через stdin, не в argv", async () => {
    const r = await exec("build", "build", { IN_ENV: "prod", APP_VERSION: SHA, GHCR_TOKEN: "ghs-test-token" });
    expect(r.calls.find((c) => c.startsWith("docker login "))).toBe("docker login ghcr.io -u test-owner --password-stdin");
    expect(await r.read("login.stdin")).toBe("ghs-test-token");
    expect(r.calls.join("\n")).not.toContain("ghs-test-token");
  });
});

describe("deploy.yml: prod", () => {
  const PROD = async (extra: Record<string, string>) => {
    const keys = await allowlistKeys();
    return {
      ...SSH_BASE,
      ...valued([...keys["prod"]!, ...keys["ops"]!]),
      APP_ENV: "prod",
      BASE,
      APP_DIGEST: DIGEST,
      IN_IMAGE: "",
      IN_FORCE: "false",
      ...extra,
    };
  };

  it("К-58: needs/if дословно по §9.2, environment prod, один шаг ssh", () => {
    const p = job(wf, "prod");
    expect(p.needs).toEqual(["plan", "build"]);
    expect(p.if).toBe(COND("prod"));
    expect(p.environment).toBe("prod");
    expect(p.steps.map((s) => s.id)).toEqual(["ssh"]);
    expect(p.steps[0]!.uses).toBeUndefined();
  });

  it("К-58 К-59: deploy <sha> <digest> <base>; секреты [prod]∪[ops] в stdin printf KEY=value; status в итог", async () => {
    const keys = await allowlistKeys();
    const r = await exec("prod", "ssh", await PROD({ IN_ACTION: "deploy" }));
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const ssh = r.calls.filter((c) => c.startsWith("ssh "));
    expect(ssh).toHaveLength(2);
    expect(ssh[0]).toMatch(/ -o StrictHostKeyChecking=yes /);
    expect(ssh[0]).toMatch(/ -o UserKnownHostsFile=\S+known_hosts /);
    expect(ssh[0]!.endsWith(` deploy@vps.chezz.test deploy ${SHA} ${DIGEST} ${BASE}`)).toBe(true);
    expect(ssh[1]!.endsWith(" deploy@vps.chezz.test status")).toBe(true);
    const stdin = await r.read("ssh.1.stdin");
    expect(stdinKeys(stdin).sort()).toEqual([...keys["prod"]!, ...keys["ops"]!].sort());
    expect(stdin).toContain("APP_ENV=prod\n");
    expect(stdin).toContain("DATABASE_URL=v-DATABASE_URL\n");
    expect(await r.read("ssh.2.stdin")).toBe("");
    expect(await r.read("ssh.1.key")).toBe(`${SSH_BASE.SSH_DEPLOY_KEY}\n`);
    expect(r.summary).toContain("result=ok");
    expect(r.summary).toContain("prod: running");
    expect(r.summary).not.toContain("v-DATABASE_URL");
    expect(r.stdout).not.toContain("v-DATABASE_URL");
  });

  it("К-59: файл ключа и known_hosts удалены после шага (trap), временных файлов секретов нет", async () => {
    const r = await exec("prod", "ssh", await PROD({ IN_ACTION: "deploy" }));
    expect(r.code).toBe(0);
    expect(r.tempLeft).toEqual([]);
    const r2 = await exec("prod", "ssh", await PROD({ IN_ACTION: "deploy", FAKE_SSH_RC: "4", FAKE_SSH_RESULT: "rolled_back" }));
    expect(r2.tempLeft).toEqual([]);
  });

  it("К-58: force=true → «deploy … force»; bootstrap → база bootstrap", async () => {
    const r = await exec("prod", "ssh", await PROD({ IN_ACTION: "deploy", IN_FORCE: "true", BASE: "bootstrap" }));
    expect(r.code, r.stderr).toBe(0);
    expect(r.calls[0]!.endsWith(` deploy ${SHA} ${DIGEST} bootstrap force`)).toBe(true);
  });

  it("К-58: rollback и rollback <digest> — без секретов в stdin", async () => {
    const r = await exec("prod", "ssh", await PROD({ IN_ACTION: "rollback", APP_DIGEST: "" }));
    expect(r.code, r.stderr).toBe(0);
    expect(r.calls[0]!.endsWith(" deploy@vps.chezz.test rollback")).toBe(true);
    expect(await r.read("ssh.1.stdin")).toBe("");
    const r2 = await exec("prod", "ssh", await PROD({ IN_ACTION: "rollback", APP_DIGEST: "", IN_IMAGE: DIGEST }));
    expect(r2.calls[0]!.endsWith(` deploy@vps.chezz.test rollback ${DIGEST}`)).toBe(true);
  });

  it("К-58: код VPS ≠ 0 → шаг красный с тем же кодом, status и result всё равно в итоге", async () => {
    const r = await exec("prod", "ssh", await PROD({ IN_ACTION: "deploy", FAKE_SSH_RC: "4", FAKE_SSH_RESULT: "rolled_back" }));
    expect(r.code).toBe(4);
    expect(r.summary).toContain("result=rolled_back");
    expect(r.summary).toContain("prod: running");
  });

  it("К-58: пустой optional уходит как KEY= (VPS его пропускает, A2)", async () => {
    const r = await exec("prod", "ssh", await PROD({ IN_ACTION: "deploy", TELEGRAM_BOT_TOKEN: "" }));
    expect(await r.read("ssh.1.stdin")).toContain("TELEGRAM_BOT_TOKEN=\n");
  });
});

describe("deploy.yml: staging", () => {
  it("К-58: needs/if дословно, environment staging", () => {
    const s = job(wf, "staging");
    expect(s.needs).toEqual(["plan", "build"]);
    expect(s.if).toBe(COND("staging"));
    expect(s.environment).toBe("staging");
  });

  it("К-60 EC-40: ssh-up первым, затем код ветки; после checkout шагов SSH нет; ssh-down только при down", () => {
    const steps = job(wf, "staging").steps;
    expect(steps.map((s) => s.id)).toEqual(["ssh-up", "checkout", "node", "npm-ci", "browsers", "smoke", "ssh-down"]);
    for (const s of steps.slice(0, -1)) expect(s.if, s.id).toBe("inputs.action == 'deploy'");
    expect(steps.at(-1)!.if).toBe("inputs.action == 'down'");
    const co = steps.findIndex((s) => s.id === "checkout");
    for (const s of steps.slice(co, -1)) {
      expect(JSON.stringify(s), s.id).not.toMatch(/\bssh\b|SSH_DEPLOY_KEY|VPS_HOST/);
    }
    expect(step(wf, "staging", "checkout").with).toMatchObject({ "persist-credentials": false });
    expect(JSON.stringify(steps)).not.toMatch(/upload-artifact|cache/);
  });

  it("К-60: npm ci → playwright chromium → smoke c E2E_BASE_URL и SEED_TOKEN_SECRET в env шага", () => {
    expect(runOf(wf, "staging", "npm-ci")).toBe("npm ci");
    expect(runOf(wf, "staging", "browsers")).toMatch(/^npx playwright install( --with-deps)? chromium$/);
    expect(runOf(wf, "staging", "smoke")).toBe("npm run test:e2e -- --grep @smoke --project=desktop");
    expect(step(wf, "staging", "smoke").env).toEqual({
      E2E_BASE_URL: "${{ vars.APP_ORIGIN }}",
      SEED_TOKEN_SECRET: "${{ secrets.SEED_TOKEN_SECRET }}",
    });
  });

  it("К-59 К-60: ssh-up — up <app> <tools>, в stdin ровно ключи [staging]", async () => {
    const keys = await allowlistKeys();
    const r = await exec("staging", "ssh-up", {
      ...SSH_BASE,
      ...valued(keys["staging"]!),
      APP_ENV: "staging",
      APP_DIGEST: DIGEST,
      TOOLS_DIGEST: `sha256:${"b".repeat(64)}`,
    });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]).toMatch(/ -o StrictHostKeyChecking=yes /);
    expect(r.calls[0]!.endsWith(` deploy@vps.chezz.test up ${DIGEST} sha256:${"b".repeat(64)}`)).toBe(true);
    expect(stdinKeys(await r.read("ssh.1.stdin")).sort()).toEqual([...keys["staging"]!].sort());
    expect(r.tempLeft).toEqual([]);
  });

  it("К-60: ssh-down — одна команда down без stdin; код VPS ≠ 0 → шаг красный", async () => {
    const r = await exec("staging", "ssh-down", { ...SSH_BASE });
    expect(r.code, r.stderr).toBe(0);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]!.endsWith(" deploy@vps.chezz.test down")).toBe(true);
    expect(await r.read("ssh.1.stdin")).toBe("");
    expect(r.tempLeft).toEqual([]);
    const r2 = await exec("staging", "ssh-down", { ...SSH_BASE, FAKE_SSH_RC: "9" });
    expect(r2.code).toBe(9);
  });
});

describe("deploy.yml: actions", () => {
  it("К-61: все uses — по полному SHA; checkout везде с persist-credentials: false", () => {
    const uses = Object.values(wf.jobs).flatMap((j) => j.steps.filter((s) => s.uses));
    expect(uses.length).toBeGreaterThan(0);
    for (const s of uses) {
      expect(s.uses).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
      if (s.uses!.startsWith("actions/checkout@")) expect(s.with).toMatchObject({ "persist-credentials": false });
    }
    expect(uses.map((s) => s.uses!.split("@")[0]).every((u) => u === "actions/checkout" || u === "actions/setup-node")).toBe(true);
  });
});
