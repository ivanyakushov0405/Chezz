// .github/dependabot.yml (E02 T-5; OPERATIONS §16.1 п.6; design A6).
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { readRepoFile } from "../support/index.ts";

interface Update {
  "package-ecosystem": string;
  directory: string;
  schedule: { interval: string };
}

describe("dependabot.yml", () => {
  it("К-64 A6: npm и github-actions для /, docker и docker-compose для /deploy — раз в неделю", async () => {
    const cfg = parse(await readRepoFile(".github/dependabot.yml")) as { version: number; updates: Update[] };
    expect(cfg.version).toBe(2);
    const got = cfg.updates.map((u) => `${u["package-ecosystem"]} ${u.directory} ${u.schedule.interval}`).sort();
    expect(got).toEqual(
      ["npm / weekly", "github-actions / weekly", "docker /deploy weekly", "docker-compose /deploy weekly"].sort(),
    );
  });
});
