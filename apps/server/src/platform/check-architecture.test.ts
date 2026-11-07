// Правило AC-17 в scripts/check-architecture.sh: вторая маскировка id вызова запрещена.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(
  import.meta.dirname,
  "../../../../scripts/check-architecture.sh",
);
const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function run(files: Record<string, string>): {
  code: number | null;
  stderr: string;
} {
  const root = mkdtempSync(path.join(tmpdir(), "chezz-arch-"));
  dirs.push(root);
  mkdirSync(path.join(root, "scripts"));
  cpSync(SCRIPT, path.join(root, "scripts/check-architecture.sh"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  }
  const res = spawnSync("bash", ["scripts/check-architecture.sh"], {
    cwd: root,
    encoding: "utf8",
  });
  return { code: res.status, stderr: res.stderr };
}

const BS = "\\"; // один обратный слэш

describe("check-architecture: вторая маскировка id вызова", () => {
  it("регулярное выражение с экранированным слэшем перед challenge в apps/server/src → нарушение", () => {
    const r = run({
      "apps/server/src/x.ts": `export const re = /${BS}/challenge${BS}/[^/]+/g;`,
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("apps/server/src/x.ts:1");
  });

  it("то же для api/challenges в apps/web/src → нарушение", () => {
    const r = run({
      "apps/web/src/y.ts": `export const re = /${BS}/api${BS}/challenges${BS}//;`,
    });
    expect(r.code).toBe(1);
  });

  it("простой литерал и комментарий с /challenge, /api/challenges — не нарушение", () => {
    const r = run({
      "apps/server/src/z.ts": 'export const p = "/challenge/x";\n// POST /api/challenges/:id/accept\n',
    });
    expect(r.stderr).not.toContain("вторая маскировка");
  });

  it("в *.test.ts правило не действует; без регулярных выражений — чисто", () => {
    const r = run({
      "apps/server/src/x.test.ts": `export const re = /${BS}/challenge${BS}//;`,
      "apps/server/src/z.ts": "export const p = 'challenge';",
    });
    expect(r.stderr).not.toContain("вторая маскировка");
  });
});
