import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LobbyPage } from "./pages/lobby/LobbyPage.tsx";
import { I18nProvider } from "./shared/i18n/I18nContext.tsx";
import { currentLocale } from "./shared/i18n/locale.ts";
import "./shared/ui/global.css";

const locale = currentLocale();
document.documentElement.lang = locale;

const root = document.getElementById("root");
if (!root) throw new Error("#root не найден");
createRoot(root).render(
  <StrictMode>
    <I18nProvider locale={locale}>
      <LobbyPage />
    </I18nProvider>
  </StrictMode>,
);
