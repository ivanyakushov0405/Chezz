// deploy/Caddyfile — статически (E02 T-2; OPERATIONS §6.3; SECURITY §6, S32; O17).
// `caddy validate` — caddy.image.test.ts (проект deploy-image).
import { describe, expect, it } from "vitest";
import { readRepoFile } from "./support/index.ts";

interface Block {
  label: string;
  body: string;
}

/** Блоки верхнего уровня: `<метка> { … }` (сниппеты `(имя)`, сайты, глобальные опции с пустой меткой). */
function topBlocks(text: string): Block[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/(^|\s)#.*$/, "").trimEnd())
    .filter((l) => l.trim() !== "");
  const blocks: Block[] = [];
  let depth = 0;
  let cur: Block | null = null;
  for (const line of lines) {
    const t = line.trim();
    // Плейсхолдеры {$X} и {host} не меняют глубину: считаем только «голые» { и }.
    const bare = t.replace(/\{[$A-Za-z_.][^{}\s]*\}/g, "");
    const o = (bare.match(/\{/g) ?? []).length;
    const c = (bare.match(/\}/g) ?? []).length;
    if (depth === 0 && o > 0) {
      cur = { label: t.replace(/\{\s*$/, "").trim(), body: "" };
    } else if (cur) {
      cur.body += `${line}\n`;
    }
    depth += o - c;
    if (depth === 0 && cur) {
      blocks.push(cur);
      cur = null;
    }
  }
  return blocks;
}

const load = async (): Promise<{ text: string; blocks: Block[] }> => {
  const text = await readRepoFile("deploy/Caddyfile");
  return { text, blocks: topBlocks(text) };
};

const siteAddresses = (label: string): string[] =>
  label
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((a) => a.replace(/^https:\/\//, ""));

function site(blocks: Block[], address: string): Block {
  const b = blocks.find((x) => !x.label.startsWith("(") && siteAddresses(x.label).includes(address));
  if (!b) throw new Error(`нет сайта ${address}`);
  return b;
}

function headerValue(body: string, name: string): string | null {
  const re = new RegExp(`(?:^|\\s)\\+?${name.replace(/-/g, "\\-")}\\s+("((?:[^"\\\\]|\\\\.)*)"|(\\S+))`, "m");
  const m = re.exec(body);
  if (!m) return null;
  return m[2] ?? m[3] ?? null;
}

const CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob: https://lh3.googleusercontent.com; connect-src 'self' wss://{host} https://{$SENTRY_INGEST}; " +
  "font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

const HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000",
  "Content-Security-Policy": CSP,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

/** Сниппет с заголовками SECURITY §6. */
function headersSnippet(blocks: Block[]): Block {
  const s = blocks.find((b) => /^\([^)]+\)$/.test(b.label) && /Content-Security-Policy/.test(b.body));
  if (!s) throw new Error("нет сниппета с Content-Security-Policy");
  return s;
}

const snippetName = (b: Block): string => b.label.slice(1, -1);

describe("deploy/Caddyfile", () => {
  it("AC-15: сниппет — пять заголовков SECURITY §6, значения дословно", async () => {
    const { blocks } = await load();
    const s = headersSnippet(blocks);
    for (const [name, value] of Object.entries(HEADERS)) expect(headerValue(s.body, name), name).toBe(value);
  });

  it("AC-15: connect-src содержит wss://{host} и https://{$SENTRY_INGEST}", async () => {
    const { blocks } = await load();
    const csp = headerValue(headersSnippet(blocks).body, "Content-Security-Policy") ?? "";
    const connect = /connect-src ([^;]*)/.exec(csp)?.[1] ?? "";
    expect(connect.split(/\s+/)).toEqual(expect.arrayContaining(["wss://{host}", "https://{$SENTRY_INGEST}"]));
  });

  it("AC-15: сниппет удаляет заголовок Server (-Server)", async () => {
    const { blocks } = await load();
    expect(headersSnippet(blocks).body).toMatch(/(^|\s)-Server(\s|$)/m);
  });

  it("AC-15: оба сайта импортируют сниппет заголовков", async () => {
    const { blocks } = await load();
    const name = snippetName(headersSnippet(blocks));
    for (const addr of ["{$APP_DOMAIN}", "staging.{$APP_DOMAIN}"]) {
      expect(site(blocks, addr).body, addr).toMatch(new RegExp(`(^|\\s)import\\s+${name}(\\s|$)`, "m"));
    }
  });

  it("AC-15: {$APP_DOMAIN} → reverse_proxy app:3000, staging.{$APP_DOMAIN} → app-staging:3000", async () => {
    const { blocks } = await load();
    const proxies = (b: Block): string[] =>
      [...b.body.matchAll(/(?:^|\s)reverse_proxy\s+([^\s{]+)/gm)].map((m) => m[1]!.replace(/^http:\/\//, ""));
    expect(proxies(site(blocks, "{$APP_DOMAIN}"))).toEqual(["app:3000"]);
    expect(proxies(site(blocks, "staging.{$APP_DOMAIN}"))).toEqual(["app-staging:3000"]);
  });

  it("AC-15: сайтов ровно два", async () => {
    const { blocks } = await load();
    const sites = blocks.filter((b) => b.label !== "" && !b.label.startsWith("("));
    expect(sites.map((b) => b.label).sort()).toEqual(["staging.{$APP_DOMAIN}", "{$APP_DOMAIN}"].sort());
  });

  it("AC-16: нет директивы log", async () => {
    const { text } = await load();
    const code = text
      .split(/\r?\n/)
      .map((l) => l.replace(/(^|\s)#.*$/, ""))
      .join("\n");
    expect(code).not.toMatch(/(^|\s)log(\s|\{|$)/m);
  });

  it("AC-16: порт 9464 не проксируется", async () => {
    const { text } = await load();
    expect(text).not.toMatch(/9464/);
    expect(text).not.toMatch(/reverse_proxy[^\n]*:(?!3000\b)\d+/);
  });

  it("AC-14 (статически): Caddyfile берёт APP_DOMAIN, ACME_EMAIL, SENTRY_INGEST из окружения", async () => {
    const { text } = await load();
    for (const v of ["APP_DOMAIN", "ACME_EMAIL", "SENTRY_INGEST"]) expect(text, v).toContain(`{$${v}}`);
  });
});
