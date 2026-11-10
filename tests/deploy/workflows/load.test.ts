// load.yml: разбор и выполнение шагов с подменой docker/ssh (E02 T-5; OPERATIONS §11; design П11, EC-24).
// Поведение `load` на VPS (games_active, команда генератора) проверяет tests/deploy/remote/staging.test.ts.
import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  allowlistKeys,
  execStep,
  job,
  loadWorkflow,
  makeTempDir,
  prepareBin,
  runCmd,
  runOf,
  step,
  walkStrings,
  writeWorkflowFakes,
  type Workflow,
} from "../support/index.ts";

const SHA = "e".repeat(40);
const DIGEST = `sha256:${"c".repeat(64)}`;
const SSH_BASE = {
  VPS_HOST: "vps.chezz.test",
  VPS_HOST_KEY: "vps.chezz.test ssh-ed25519 AAAATESTHOSTKEY",
  SSH_DEPLOY_KEY: "-----BEGIN TEST KEY-----\nTESTKEYBODY\n-----END TEST KEY-----",
};

let wf: Workflow;
let tmp: { dir: string; cleanup: () => Promise<void> };
let bin: string;

beforeAll(async () => {
  wf = await loadWorkflow(".github/workflows/load.yml");
  tmp = await makeTempDir("chezz-wf-load-");
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
  return { ...r, dir, calls, read, tempLeft: await readdir(join(dir, "runner_temp")) };
}

describe("load.yml: структура", () => {
  it("К-62: check-workflows.sh зелёный; только workflow_dispatch без входов", async () => {
    const r = await runCmd("bash", ["scripts/check-workflows.sh"]);
    expect(r.code, r.stderr).toBe(0);
    expect(Object.keys(wf.on)).toEqual(["workflow_dispatch"]);
    expect(wf.on["workflow_dispatch"] ?? null).toBeNull();
  });

  it("К-62 EC-30: concurrency deploy-staging (общая с deploy.yml env=staging), без cancel-in-progress", () => {
    expect(wf.concurrency?.group).toBe("deploy-staging");
    expect(wf.concurrency?.["cancel-in-progress"]).toBeUndefined();
  });

  it("К-62: цепочка plan → build → load; права не шире §11", () => {
    expect(Object.keys(wf.jobs)).toEqual(["plan", "build", "load"]);
    expect(wf.permissions).toEqual({});
    expect(job(wf, "build").needs).toBe("plan");
    expect(job(wf, "load").needs).toBe("build");
    expect(job(wf, "build").permissions).toEqual({ contents: "read", packages: "write" });
    expect(job(wf, "load").permissions).toEqual({ contents: "read" });
    expect(job(wf, "plan").environment).toBeUndefined();
    expect(job(wf, "build").environment).toBeUndefined();
  });

  it("К-62: plan.validate без входов — код 0", async () => {
    const r = await exec("plan", "validate", {});
    expect(r.code, r.stderr).toBe(0);
  });

  it("К-62: load — environment staging, только SSH-шаги ssh-up, ssh-load, ssh-down; без uses и checkout", () => {
    const l = job(wf, "load");
    expect(l.environment).toBe("staging");
    expect(l.steps.map((s) => s.id)).toEqual(["ssh-up", "ssh-load", "ssh-down"]);
    for (const s of l.steps) {
      expect(s.uses, s.id).toBeUndefined();
      expect(s.run, s.id).toMatch(/\bssh -i "\$KEY"/);
      expect(s.run, s.id).not.toMatch(/\bnpm\b|\bnode\b|\bnpx\b|\.\/[\w./-]+/);
    }
    expect(step(wf, "load", "ssh-down").if).toBe("always()");
    expect(JSON.stringify(wf)).not.toMatch(/upload-artifact/);
  });

  it("К-62: в run: нет ${{ }}; secrets.* — только в env: шагов load; uses по SHA", () => {
    for (const j of Object.values(wf.jobs))
      for (const s of j.steps) {
        if (s.run) expect(s.run).not.toContain("${{");
        if (s.uses) expect(s.uses).toMatch(/^actions\/checkout@[0-9a-f]{40}$/);
        if (s.uses) expect(s.with).toMatchObject({ "persist-credentials": false });
      }
    for (const h of walkStrings(wf).filter((x) => x.value.includes("secrets.")))
      expect(h.path.join("."), h.value).toMatch(/^jobs\.load\.steps\.\d+\.env\.[A-Z0-9_]+$/);
  });
});

describe("load.yml: шаги", () => {
  it("К-62: build — обе цели в пакеты *-staging, тег sha-<sha>, выходы digest", async () => {
    const r = await exec("build", "build", { APP_VERSION: SHA, GHCR_TOKEN: "ghs-test-token" });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const builds = r.calls.filter((c) => c.startsWith("docker buildx build "));
    expect(builds.map((c) => /--target (\S+)/.exec(c)?.[1])).toEqual(["app", "tools"]);
    expect(builds.map((c) => /-t (\S+)/.exec(c)?.[1])).toEqual([
      `ghcr.io/test-owner/chezz-app-staging:sha-${SHA}`,
      `ghcr.io/test-owner/chezz-tools-staging:sha-${SHA}`,
    ]);
    for (const c of builds) {
      expect(c).toContain("--push");
      expect(c).toContain(`--label org.opencontainers.image.revision=${SHA}`);
      expect(c).toContain("--label org.opencontainers.image.source=https://github.com/Test-Owner/chezz");
    }
    expect(r.outputs).toEqual({ app_digest: `sha256:${"1".repeat(64)}`, tools_digest: `sha256:${"2".repeat(64)}` });
    expect(await r.read("login.stdin")).toBe("ghs-test-token");
  });

  it("К-62: ssh-up — up <app> <tools>, в stdin ровно ключи [staging], ключ удалён", async () => {
    const keys = await allowlistKeys();
    const r = await exec("load", "ssh-up", {
      ...SSH_BASE,
      ...Object.fromEntries(keys["staging"]!.map((k) => [k, `v-${k}`])),
      APP_ENV: "staging",
      APP_DIGEST: DIGEST,
      TOOLS_DIGEST: `sha256:${"b".repeat(64)}`,
    });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]).toMatch(/ -o StrictHostKeyChecking=yes /);
    expect(r.calls[0]!.endsWith(` deploy@vps.chezz.test up ${DIGEST} sha256:${"b".repeat(64)}`)).toBe(true);
    const sent = (await r.read("ssh.1.stdin"))!.split(/\r?\n/).filter((l) => l !== "").map((l) => l.split("=")[0]);
    expect(sent.sort()).toEqual([...keys["staging"]!].sort());
    expect(r.tempLeft).toEqual([]);
  });

  it("К-63: ssh-load — команда load без stdin; отчёт между report_begin/report_end — в итог job, не в лог", async () => {
    const out = join(tmp.dir, "load-ok.out");
    const report = '{"p95_ms":120,"errors":0}';
    await writeFile(out, `starting\nreport_begin\n${report}\nreport_end\nresult=ok\n`);
    const r = await exec("load", "ssh-load", { ...SSH_BASE, FAKE_SSH_OUT: out });
    expect(r.code, r.stderr).toBe(0);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]!.endsWith(" deploy@vps.chezz.test load")).toBe(true);
    expect(await r.read("ssh.1.stdin")).toBe("");
    expect(r.summary).toContain(report);
    expect(r.summary).toContain("result=ok");
    expect(r.stdout).toContain("starting");
    expect(r.stdout).not.toContain(report);
    expect(r.tempLeft).toEqual([]);
  });

  it("К-63 EC-24: код load ≠ 0 (порог нарушен или генератора нет до E21) → шаг красный, отчёт всё равно в итоге", async () => {
    const out = join(tmp.dir, "load-fail.out");
    await writeFile(out, `seed: not available yet\nresult=load_failed\n`);
    const r = await exec("load", "ssh-load", { ...SSH_BASE, FAKE_SSH_OUT: out, FAKE_SSH_RC: "1" });
    expect(r.code).toBe(1);
    expect(r.summary).toContain("result=load_failed");
    expect(r.tempLeft).toEqual([]);
  });

  it("К-63: games_active prod > 2 → код 3 доходит до job", async () => {
    const out = join(tmp.dir, "load-busy.out");
    await writeFile(out, `result=prod_busy\n`);
    const r = await exec("load", "ssh-load", { ...SSH_BASE, FAKE_SSH_OUT: out, FAKE_SSH_RC: "3" });
    expect(r.code).toBe(3);
  });

  it("К-62 EC-24: ssh-down — команда down без stdin", async () => {
    const r = await exec("load", "ssh-down", { ...SSH_BASE });
    expect(r.code, r.stderr).toBe(0);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]!.endsWith(" deploy@vps.chezz.test down")).toBe(true);
    expect(await r.read("ssh.1.stdin")).toBe("");
    expect(r.tempLeft).toEqual([]);
  });
});
