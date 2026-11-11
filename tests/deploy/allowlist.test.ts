// deploy/env.allowlist (E02 T-2; OPERATIONS §7; design П4): формат и состав, значений нет.
import { describe, expect, it } from "vitest";
import { readRepoFile } from "./support/index.ts";

type Level = "required" | "optional";

const EXPECTED: Record<string, Record<string, Level>> = {
  prod: {
    APP_ENV: "required",
    APP_ORIGIN: "required",
    DATABASE_URL: "required",
    POSTGRES_PASSWORD: "required",
    GOOGLE_CLIENT_ID: "required",
    GOOGLE_CLIENT_SECRET: "required",
    COOKIE_SECRET: "required",
    SENTRY_DSN: "optional",
  },
  ops: {
    APP_DOMAIN: "required",
    ACME_EMAIL: "required",
    SENTRY_INGEST: "required",
    TELEGRAM_BOT_TOKEN: "optional",
    TELEGRAM_CHAT_ID: "optional",
    B2_KEY_ID: "optional",
    B2_APP_KEY: "optional",
    B2_BUCKET: "optional",
    BACKUP_REQUIRE_OFFSITE: "optional",
  },
  staging: {
    APP_ENV: "required",
    APP_ORIGIN: "required",
    DATABASE_URL: "required",
    POSTGRES_PASSWORD: "required",
    SEED_TOKEN_SECRET: "required",
    GOOGLE_CLIENT_ID: "required",
    GOOGLE_CLIENT_SECRET: "required",
    COOKIE_SECRET: "required",
    SENTRY_DSN: "optional",
    RATE_LIMIT_IP_PER_MIN: "optional",
  },
};

interface Parsed {
  sections: Map<string, Array<{ name: string; level: string; line: number }>>;
  /** Значимые строки вне формата `ИМЯ required|optional` и `[раздел]`. */
  bad: string[];
  /** Строки до первого раздела. */
  orphan: string[];
}

const significant = (text: string): Array<{ text: string; line: number }> =>
  text
    .split(/\r?\n/)
    .map((l, i) => ({ text: l.replace(/#.*$/, "").trim(), line: i + 1 }))
    .filter((l) => l.text !== "");

function parseAllowlist(text: string): Parsed {
  const sections = new Map<string, Array<{ name: string; level: string; line: number }>>();
  const bad: string[] = [];
  const orphan: string[] = [];
  let cur: string | null = null;
  for (const { text: l, line } of significant(text)) {
    const sec = /^\[([a-z]+)\]$/.exec(l);
    if (sec) {
      cur = sec[1]!;
      if (sections.has(cur)) bad.push(`${line}: повтор раздела [${cur}]`);
      else sections.set(cur, []);
      continue;
    }
    const m = /^([A-Z][A-Z0-9_]*)\s+(required|optional)$/.exec(l);
    if (!m) {
      bad.push(`${line}: ${l}`);
      continue;
    }
    if (cur === null) {
      orphan.push(`${line}: ${l}`);
      continue;
    }
    sections.get(cur)!.push({ name: m[1]!, level: m[2]!, line });
  }
  return { sections, bad, orphan };
}

const load = async (): Promise<{ text: string; parsed: Parsed }> => {
  const text = await readRepoFile("deploy/env.allowlist");
  return { text, parsed: parseAllowlist(text) };
};

describe("deploy/env.allowlist", () => {
  it("AC-22: ровно три раздела — [prod], [ops], [staging]", async () => {
    const { parsed } = await load();
    expect([...parsed.sections.keys()].sort()).toEqual(["ops", "prod", "staging"]);
  });

  it("AC-22: каждая строка — `ИМЯ required|optional` или `[раздел]`; строк вне раздела нет", async () => {
    const { parsed } = await load();
    expect(parsed.bad).toEqual([]);
    expect(parsed.orphan).toEqual([]);
  });

  it("AC-22: значений нет — ни одной строки с `=` (кроме комментариев)", async () => {
    const { text } = await load();
    expect(significant(text).filter((l) => l.text.includes("="))).toEqual([]);
  });

  it("AC-22: в разделах нет повторов ключей", async () => {
    const { parsed } = await load();
    for (const [sec, rows] of parsed.sections) {
      const names = rows.map((r) => r.name);
      expect(names.filter((n, i) => names.indexOf(n) !== i), sec).toEqual([]);
    }
  });

  for (const sec of Object.keys(EXPECTED)) {
    it(`AC-22: [${sec}] — ключи и required/optional по OPERATIONS §7 и П4`, async () => {
      const { parsed } = await load();
      const rows = parsed.sections.get(sec) ?? [];
      const actual = Object.fromEntries(rows.map((r) => [r.name, r.level]));
      expect(actual).toEqual(EXPECTED[sec]);
    });
  }
});
