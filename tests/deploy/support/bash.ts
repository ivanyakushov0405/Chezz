import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  /** Аргументы скрипта. */
  args?: string[];
  /** Переменные окружения (П2): CHEZZ_ROOT, CHEZZ_BACKUP_DIR, SSH_ORIGINAL_COMMAND и т.п. */
  env?: Record<string, string>;
  /** Содержимое stdin (секреты KEY=VALUE); поток закрывается (EOF). */
  stdin?: string;
  /** Каталог подменных команд — ставится первым в PATH. */
  fakeBin?: string;
  /** Рабочий каталог. */
  cwd?: string;
  /** Таймаут, мс. */
  timeoutMs?: number;
}

const WIN_ABS = /^[A-Za-z]:[\\/]/;

/** Путь для bash: на Windows `C:\a\b` -> `/c/a/b`. */
export function toBashPath(p: string): string {
  if (process.platform !== "win32" || !WIN_ABS.test(p)) return p;
  return `/${p[0]!.toLowerCase()}${p.slice(2).replaceAll("\\", "/")}`;
}

export function bashExecutable(): string {
  if (process.platform !== "win32") return "bash";
  return process.env["CHEZZ_BASH"] ?? "C:\\Program Files\\Git\\bin\\bash.exe";
}

/** Запускает bash-скрипт и возвращает {code, stdout, stderr}. */
export async function runScript(script: string, opts: RunOptions = {}): Promise<RunResult> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  for (const [k, v] of Object.entries(opts.env ?? {})) env[k] = toBashPath(v);
  if (opts.fakeBin) {
    const pathKey = Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "PATH";
    env[pathKey] = `${opts.fakeBin}${delimiter}${env[pathKey] ?? ""}`;
  }
  return await new Promise<RunResult>((resolve, reject) => {
    const child = spawn(bashExecutable(), [toBashPath(script), ...(opts.args ?? [])], {
      env,
      cwd: opts.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`скрипт ${script} не завершился за ${opts.timeoutMs ?? 20_000} мс`));
    }, opts.timeoutMs ?? 20_000);
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(opts.stdin ?? "");
  });
}

/** Временный каталог; `cleanup` удаляет его. */
export async function makeTempDir(prefix = "chezz-deploy-"): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/**
 * Подменная команда: исполняемый bash-файл без расширения в `binDir`.
 * `body` — тело скрипта (после shebang); argv доступен как "$@".
 */
export async function writeFake(binDir: string, name: string, body: string): Promise<void> {
  await mkdir(binDir, { recursive: true });
  const file = join(binDir, name);
  await writeFile(file, `#!/usr/bin/env bash\n${body}\n`, { encoding: "utf8" });
  await chmod(file, 0o755);
}

/** Подмена, дописывающая argv каждого вызова в `logFile` (одна строка на вызов) и затем выполняющая `body`. */
export async function writeLoggingFake(binDir: string, name: string, logFile: string, body = "exit 0"): Promise<void> {
  await writeFake(binDir, name, `printf '%s\\n' "${name} $*" >> '${toBashPath(logFile)}'\n${body}`);
}
