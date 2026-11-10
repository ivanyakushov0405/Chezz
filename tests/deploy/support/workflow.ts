// Разбор workflow и запуск шагов run: дословно (design E02 П11): bash -eo pipefail, как у GitHub,
// с файлами GITHUB_OUTPUT / GITHUB_STEP_SUMMARY во временном каталоге и подменами команд в PATH.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { type RunResult, runScript, toBashPath, writeFake } from "./bash.js";
import { readRepoFile } from "./exec.js";

export interface Step {
  id?: string;
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}

export interface Job {
  needs?: string | string[];
  if?: string;
  "runs-on"?: string;
  environment?: string;
  permissions?: Record<string, string>;
  outputs?: Record<string, string>;
  env?: Record<string, string>;
  steps: Step[];
}

export interface Workflow {
  name?: string;
  on: Record<string, unknown>;
  "run-name"?: string;
  concurrency?: { group?: string; "cancel-in-progress"?: unknown };
  permissions?: unknown;
  env?: Record<string, string>;
  jobs: Record<string, Job>;
}

export async function loadWorkflow(rel: string): Promise<Workflow> {
  return parse(await readRepoFile(rel)) as Workflow;
}

export function job(wf: Workflow, name: string): Job {
  const j = wf.jobs[name];
  if (!j) throw new Error(`нет job ${name}`);
  return j;
}

export function step(wf: Workflow, jobName: string, id: string): Step {
  const s = job(wf, jobName).steps.find((x) => x.id === id);
  if (!s) throw new Error(`нет шага ${jobName}.${id}`);
  return s;
}

export function runOf(wf: Workflow, jobName: string, id: string): string {
  const r = step(wf, jobName, id).run;
  if (r === undefined) throw new Error(`у шага ${jobName}.${id} нет run:`);
  return r;
}

export interface StepRun extends RunResult {
  outputs: Record<string, string>;
  summary: string;
}

/** Каталог подмен: обёртка jq без CR (jq.exe на Windows пишет CRLF), остальное — через writeFake. */
export async function prepareBin(binDir: string): Promise<void> {
  await mkdir(binDir, { recursive: true });
  const real = execFileSync(process.platform === "win32" ? "where" : "which", ["jq"], { encoding: "utf8" })
    .split(/\r?\n/)[0]!
    .trim();
  await writeFake(binDir, "jq", `'${toBashPath(real)}' "$@" | tr -d '\\r'`);
}

/** Выполняет блок run: шага в `dir` (cwd — `cwd`, по умолчанию `dir`). */
export async function execStep(
  run: string,
  opts: { dir: string; cwd?: string; env?: Record<string, string>; fakeBin?: string; stdin?: string },
): Promise<StepRun> {
  const out = join(opts.dir, "github_output");
  const summary = join(opts.dir, "step_summary");
  const script = join(opts.dir, `step-${Date.now()}-${Math.random().toString(16).slice(2)}.sh`);
  await writeFile(out, "");
  await writeFile(summary, "");
  // Git Bash ставит /usr/bin и /mingw64/bin впереди PATH (там настоящие ssh, curl) — подмены возвращаются вперёд.
  const pathLine = opts.fakeBin ? `PATH='${toBashPath(opts.fakeBin)}':"$PATH"\n` : "";
  await writeFile(script, `${pathLine}set -eo pipefail\n${run}`);
  const r = await runScript(script, {
    cwd: opts.cwd ?? opts.dir,
    fakeBin: opts.fakeBin,
    stdin: opts.stdin,
    env: {
      GITHUB_OUTPUT: out,
      GITHUB_STEP_SUMMARY: summary,
      RUNNER_TEMP: join(opts.dir, "runner_temp"),
      ...opts.env,
    },
    timeoutMs: 30_000,
  });
  const outputs: Record<string, string> = {};
  for (const l of (await readFile(out, "utf8")).split(/\r?\n/)) {
    const p = l.indexOf("=");
    if (p > 0) outputs[l.slice(0, p)] = l.slice(p + 1);
  }
  return { ...r, outputs, summary: existsSync(summary) ? await readFile(summary, "utf8") : "" };
}

/** Ключи разделов env.allowlist (`[prod]`, `[ops]`, `[staging]`). */
export async function allowlistKeys(): Promise<Record<string, string[]>> {
  const res: Record<string, string[]> = {};
  let sec = "";
  for (const raw of (await readRepoFile("deploy/env.allowlist")).split(/\r?\n/)) {
    const l = raw.trim();
    if (l === "" || l.startsWith("#")) continue;
    const s = /^\[(\w+)\]$/.exec(l);
    if (s) {
      sec = s[1]!;
      res[sec] = [];
      continue;
    }
    res[sec]!.push(l.split(/\s+/)[0]!);
  }
  return res;
}

/** Все строки-значения дерева с путём (для поиска `secrets.` и `${{`). */
export function walkStrings(node: unknown, path: string[] = [], acc: Array<{ path: string[]; value: string }> = []) {
  if (typeof node === "string") acc.push({ path, value: node });
  else if (Array.isArray(node)) node.forEach((v, i) => walkStrings(v, [...path, String(i)], acc));
  else if (node && typeof node === "object")
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) walkStrings(v, [...path, k], acc);
  return acc;
}

/**
 * Подмены docker и ssh для шагов build и SSH. Пишут в "$FAKE_DIR": fake.log (argv; путь — "$FAKE_LOG"),
 * login.stdin, ssh.<n>.stdin, ssh.<n>.key. ssh: status → «prod: running», иначе «result=$FAKE_SSH_RESULT»
 * (по умолчанию ok) и код "$FAKE_SSH_RC"; FAKE_SSH_OUT — файл, чей текст выводится вместо result=.
 */
export async function writeWorkflowFakes(bin: string): Promise<void> {
  // docker: argv в лог, stdin login — в отдельный файл; buildx пишет metadata с digest по имени цели.
  await writeFake(
    bin,
    "docker",
    [
      `printf '%s\\n' "docker $*" >> "$FAKE_LOG"`,
      `if [ "$1" = login ]; then cat > "$FAKE_DIR/login.stdin"; exit 0; fi`,
      `if [ "$1 $2" = "buildx build" ]; then`,
      `  meta=""; target=""; prev=""`,
      `  for a in "$@"; do [ "$prev" = --metadata-file ] && meta="$a"; [ "$prev" = --target ] && target="$a"; prev="$a"; done`,
      `  case "$target" in app) h=1 ;; tools) h=2 ;; *) h=0 ;; esac`,
      `  printf '{"containerimage.digest":"sha256:%s"}' "$(printf "$h%.0s" $(seq 64))" > "$meta"`,
      `fi`,
    ].join("\n"),
  );
  // ssh: argv, stdin, наличие ключа; код — FAKE_SSH_RC для команд кроме status.
  await writeFake(
    bin,
    "ssh",
    [
      `n=$(( $(ls "$FAKE_DIR" | grep -c '^ssh\\..*\\.stdin$' || true) + 1 ))`,
      `key=""; prev=""; for a in "$@"; do [ "$prev" = -i ] && key="$a"; prev="$a"; done`,
      `printf '%s\\n' "ssh $*" >> "$FAKE_LOG"`,
      `cat > "$FAKE_DIR/ssh.$n.stdin"`,
      `if [ -f "$key" ]; then cat "$key" > "$FAKE_DIR/ssh.$n.key"; fi`,
      `cmd="\${!#}"`,
      `if [ "$cmd" = status ]; then echo "prod: running"; exit 0; fi`,
      `if [ -n "\${FAKE_SSH_OUT:-}" ]; then cat "$FAKE_SSH_OUT"; else echo "result=\${FAKE_SSH_RESULT:-ok}"; fi`,
      `exit "\${FAKE_SSH_RC:-0}"`,
    ].join("\n"),
  );
}
