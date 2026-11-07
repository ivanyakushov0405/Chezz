// Unit: <meta> конфига клиента (ADR-0010 п.3; SECURITY §6): экранирование, DSN только при заданном, место вставки.
import { describe, expect, it } from "vitest";
import { clientConfigMetaTags, escapeHtmlAttribute, injectClientConfig } from "./client-config.ts";

describe("client-config", () => {
  it("escapeHtmlAttribute экранирует & < > \" '", () => {
    expect(escapeHtmlAttribute(`a&b<c>d"e'f`)).toBe("a&amp;b&lt;c&gt;d&quot;e&#39;f");
  });

  it("значение с кавычкой и тегом не выходит из атрибута", () => {
    const tags = clientConfigMetaTags({ environment: "prod", release: '"><script>x</script>', sentryDsn: null });

    expect(tags).not.toContain("<script>");
    expect(tags).toContain('<meta name="chezz-release" content="&quot;&gt;&lt;script&gt;x&lt;/script&gt;">');
  });

  it("без DSN — только environment и release; с DSN — ещё chezz-sentry-dsn", () => {
    expect(clientConfigMetaTags({ environment: "dev", release: "r", sentryDsn: null })).toBe(
      '<meta name="chezz-environment" content="dev">\n<meta name="chezz-release" content="r">',
    );
    expect(clientConfigMetaTags({ environment: "dev", release: "r", sentryDsn: "https://k@o0.ingest.sentry.io/1" })).toContain(
      '<meta name="chezz-sentry-dsn" content="https://k@o0.ingest.sentry.io/1">',
    );
  });

  it("вставка перед первым </head> (регистр не важен); остальной HTML без изменений", () => {
    const html = "<html><HEAD><title>t</title></HEAD><body></body></html>";

    const out = injectClientConfig(html, { environment: "staging", release: "abc", sentryDsn: null });

    expect(out.startsWith("<html><HEAD><title>t</title><meta name=\"chezz-environment\"")).toBe(true);
    expect(out.endsWith("</HEAD><body></body></html>")).toBe(true);
    expect(out.replace(/<meta name="chezz-[^>]*>\n/g, "")).toBe(html);
  });

  it("без </head> — теги в начале документа", () => {
    const out = injectClientConfig("<title>x</title>", { environment: "dev", release: "r", sentryDsn: null });

    expect(out.endsWith("<title>x</title>")).toBe(true);
    expect(out.startsWith('<meta name="chezz-environment"')).toBe(true);
  });
});
