import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Корень репозитория (tests/deploy/support → ../../..). */
export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** Читает файл репозитория; понятная ошибка, если файла нет (кода ещё нет — тест красный по делу). */
export async function readRepoFile(rel: string): Promise<string> {
  const file = join(REPO_ROOT, rel);
  if (!existsSync(file)) throw new Error(`нет файла ${rel}`);
  return await readFile(file, "utf8");
}

export interface CmdResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface CmdOptions {
  cwd?: string;
  /** Добавляется к process.env. */
  env?: Record<string, string>;
  timeoutMs?: number;
  stdin?: string;
}

/** Запуск внешней команды (docker, git) без shell; при таймауте — код -1. */
export async function runCmd(cmd: string, args: string[], opts: CmdOptions = {}): Promise<CmdResult> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  Object.assign(env, opts.env ?? {});
  return await new Promise<CmdResult>((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd ?? REPO_ROOT, env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs ?? 60_000);
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: timedOut ? -1 : (code ?? -1), stdout, stderr: timedOut ? `${stderr}\n[timeout]` : stderr });
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(opts.stdin ?? "");
  });
}

/** Последние n строк текста — для сообщений об ошибке. */
export function tail(text: string, n = 15): string {
  return text.trimEnd().split(/\r?\n/).slice(-n).join("\n");
}
