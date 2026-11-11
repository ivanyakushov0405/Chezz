// Маршруты SPA (DESIGN §9; адреса — PAGES, API §14) и ограничения П1 (SECURITY §5, бриф E04 «Решения»).
import { PAGES } from "@chezz/protocol";
import { useEffect, useRef, type ReactNode } from "react";
import { useMe } from "../features/auth/MeContext.tsx";
import { LobbyPage } from "../pages/lobby/LobbyPage.tsx";
import { NotFoundPage } from "../pages/not-found/NotFoundPage.tsx";
import { AppShell } from "../pages/shell/AppShell.tsx";
import { currentPath, useLocation, useNavigate } from "../shared/router/Router.tsx";

/** Пути, открытые П1 (до завершения первого входа): сам `/welcome` и тексты правил. */
export const ONBOARDING_PATHS: readonly string[] = [PAGES.welcome(), PAGES.terms(), PAGES.privacy()];

export function routeFor(pathname: string): ReactNode {
  switch (pathname) {
    case PAGES.home():
      return <LobbyPage />;
    default:
      return <NotFoundPage />;
  }
}

/** Экран по адресу + ограничения П1: любой другой путь → `/welcome?return_to=<путь>` (replace). */
export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const { state, refresh } = useMe();
  const onboarding = state.status === "ready" && state.me.onboarding_required;
  const blocked = onboarding && !ONBOARDING_PATHS.includes(location.pathname);

  useEffect(() => {
    if (blocked) navigate(PAGES.welcome(currentPath(location)), { replace: true });
  }, [blocked, location, navigate]);

  // `/api/me` не ответил — повтор при следующей навигации, не таймером (design-spec п.14).
  const lastPath = useRef(currentPath(location));
  useEffect(() => {
    const path = currentPath(location);
    if (path === lastPath.current) return;
    lastPath.current = path;
    if (state.status === "error") void refresh();
  }, [location, state.status, refresh]);

  return <AppShell>{blocked ? null : routeFor(location.pathname)}</AppShell>;
}
