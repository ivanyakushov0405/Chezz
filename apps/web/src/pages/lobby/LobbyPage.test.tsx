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
  it("К-9: data-screen/data-state и текст; бренд — в шапке shell", () => {
    const html = render("ru");
    expect(html).toContain('data-screen="lobby"');
    expect(html).toContain('data-state="default"');
    expect(html).toContain("Скоро здесь можно будет играть в шахматы онлайн.");
    expect(html).not.toContain("<a");
    expect(html).not.toContain("<button");
  });

  it("К-9: EN", () => {
    expect(render("en")).toContain("Online chess is coming soon.");
  });
});
