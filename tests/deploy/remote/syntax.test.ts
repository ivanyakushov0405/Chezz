// AC-45 для deploy/remote/*.sh (E02 T-3): `bash -n` без ошибок; исполняемые скрипты (command= в authorized_keys,
// ExecStart юнитов) — с битом x. shellcheck — tests/deploy/shellcheck.image.test.ts.
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, bashExecutable, runCmd, tail, toBashPath } from "../support/index.ts";

const SCRIPTS = ["entry.sh", "deploy.sh", "backup.sh", "staging-ttl.sh", "lib.sh"];
const EXECUTABLE = ["entry.sh", "deploy.sh", "backup.sh", "staging-ttl.sh"];

describe("deploy/remote/*.sh — синтаксис (AC-45)", () => {
  it.each(SCRIPTS)("AC-45: bash -n deploy/remote/%s без ошибок", async (name) => {
    const file = join(REPO_ROOT, "deploy", "remote", name);
    expect(existsSync(file), `нет deploy/remote/${name}`).toBe(true);
    const r = await runCmd(bashExecutable(), ["-n", toBashPath(file)]);
    expect(r.code, tail(r.stdout + r.stderr)).toBe(0);
  });

  it.skipIf(process.platform === "win32").each(EXECUTABLE)("AC-45: deploy/remote/%s исполняемый (бит x)", async (name) => {
    const file = join(REPO_ROOT, "deploy", "remote", name);
    expect(existsSync(file), `нет deploy/remote/${name}`).toBe(true);
    expect((await stat(file)).mode & 0o111, "chmod +x (git update-index --chmod=+x)").not.toBe(0);
  });
});
