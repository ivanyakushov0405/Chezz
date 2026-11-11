import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.tsx";
import { AppLocale } from "./app/AppLocale.tsx";
import { MeProvider } from "./features/auth/MeContext.tsx";
import { currentLocale } from "./shared/i18n/locale.ts";
import { initSentry } from "./shared/observability/sentry.ts";
import { RouterProvider } from "./shared/router/Router.tsx";
import { ToastProvider } from "./shared/ui/Toast/Toast.tsx";
import "./shared/ui/global.css";

initSentry();
// Язык гостя — до первого рендера (как в E01); для Игрока AppLocale сменит его после /api/me.
document.documentElement.lang = currentLocale();

const root = document.getElementById("root");
if (!root) throw new Error("#root не найден");
createRoot(root).render(
  <StrictMode>
    <RouterProvider>
      <MeProvider>
        <AppLocale>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AppLocale>
      </MeProvider>
    </RouterProvider>
  </StrictMode>,
);
