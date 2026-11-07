import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../../shared/i18n/I18nContext.tsx";
import { LobbyPage } from "./LobbyPage.tsx";

function render(locale: "ru" | "en"): string {
  return renderToStaticMarkup(
    <I18nProvider locale={locale}>
      <LobbyPage />
    </I18nProvider>,
  );
}

describe("LobbyPage", () => {
  it("AC-35: data-screen/data-state, ссылка на /, Бета и текст", () => {
    const html = render("ru");
    expect(html).toContain('data-screen="lobby"');
    expect(html).toContain('data-state="default"');
    expect(html).toContain('href="/"');
    expect(html).toContain("Chezz");
    expect(html).toContain("Бета");
    expect(html).toContain("Скоро здесь можно будет играть в шахматы онлайн.");
    expect(html.match(/<a\b/g)).toHaveLength(1);
    expect(html).not.toContain("<button");
  });

  it("EN", () => {
    const html = render("en");
    expect(html).toContain("Beta");
    expect(html).toContain("Online chess is coming soon.");
  });
});
