// AC-45 (E02 T-3; design A1): `shellcheck -S error` для deploy/remote/*.sh в koalaman/shellcheck:v0.10.0.
// Проект deploy-image: нужен Docker-демон.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, runCmd, tail } from "./support/index.ts";

const SCRIPTS = ["entry.sh", "deploy.sh", "backup.sh", "staging-ttl.sh", "lib.sh"];

describe("deploy/remote/*.sh — shellcheck", () => {
  it("AC-45: shellcheck -S error по всем deploy/remote/*.sh — без ошибок уровня error", async () => {
    const dir = join(REPO_ROOT, "deploy", "remote");
    for (const s of SCRIPTS) expect(existsSync(join(dir, s)), `нет deploy/remote/${s}`).toBe(true);
    const r = await runCmd(
      "docker",
      ["run", "--rm", "-v", `${dir}:/mnt:ro`, "-w", "/mnt", "koalaman/shellcheck:v0.10.0", "-S", "error", "-x", ...SCRIPTS],
      { timeoutMs: 300_000 },
    );
    expect(r.code, `shellcheck:\n${tail(r.stdout + r.stderr, 15)}`).toBe(0);
  });
});
