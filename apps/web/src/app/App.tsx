// Маршруты SPA (DESIGN §9; адреса — PAGES, API §14) и ограничения П1 (SECURITY §5, бриф E04 «Решения»).
import { PAGES } from "@chezz/protocol";
import { lazy, Suspense, useEffect, useRef, type ReactNode } from "react";
import { useMe } from "../features/auth/MeContext.tsx";
import { LegalPage } from "../pages/legal/LegalPage.tsx";
import { LobbyPage } from "../pages/lobby/LobbyPage.tsx";
import { LoginFailedPage } from "../pages/login-failed/LoginFailedPage.tsx";
import { NotFoundPage } from "../pages/not-found/NotFoundPage.tsx";
import { AppShell } from "../pages/shell/AppShell.tsx";
import { WelcomePage } from "../pages/welcome/WelcomePage.tsx";
import { currentPath, useLocation, useNavigate } from "../shared/router/Router.tsx";

/** Пути, открытые П1 (до завершения первого входа): сам `/welcome` и тексты правил. */
export const ONBOARDING_PATHS: readonly string[] = [PAGES.welcome(), PAGES.terms(), PAGES.privacy()];

/** Адрес callback: при ошибке входа сервер отдаёт на нём index.html (бриф E04, «Решения»). */
export const OIDC_CALLBACK_PATH = "/auth/google/callback";

/** Экран партии — отдельный чанк (chessground, chess.js): главная ≤ 300 КБ gzip (ARCHITECTURE §12). */
const GamePage = lazy(() => import("../pages/game/GamePage.tsx").then((m) => ({ default: m.GamePage })));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** id партии из адреса `PAGES.game(id)`; не UUID — null (экран not-found). */
export function gameIdOf(pathname: string): string | null {
  const prefix = PAGES.game("");
  if (!pathname.startsWith(prefix)) return null;
  const id = pathname.slice(prefix.length);
  return UUID_RE.test(id) ? id : null;
}

export function routeFor(pathname: string): ReactNode {
  const id = gameIdOf(pathname);
  if (id !== null) {
    return (
      <Suspense fallback={null}>
        <GamePage key={id} gameId={id} />
      </Suspense>
    );
  }
  switch (pathname) {
    case PAGES.home():
      return <LobbyPage />;
    case PAGES.welcome():
      return <WelcomePage />;
    case PAGES.terms():
      return <LegalPage kind="terms" />;
    case PAGES.privacy():
      return <LegalPage kind="privacy" />;
    case OIDC_CALLBACK_PATH:
      return <LoginFailedPage />;
    default:
      return <NotFoundPage />;
  }
}

/**
 * Экран по адресу + ограничения П1: любой другой путь → `/welcome?return_to=<путь>` (replace).
 * `/welcome` нужен только П1: гость и Игрок уходят на главную.
 */
export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const { state, refresh } = useMe();
  const onboarding = state.status === "ready" && state.me.onboarding_required;
  const onWelcome = location.pathname === PAGES.welcome();
  const settled = state.status !== "loading";
  const blocked = (onboarding && !ONBOARDING_PATHS.includes(location.pathname)) || (onWelcome && (!settled || !onboarding));

  useEffect(() => {
    if (onboarding && !ONBOARDING_PATHS.includes(location.pathname)) navigate(PAGES.welcome(currentPath(location)), { replace: true });
    else if (onWelcome && settled && !onboarding) navigate(PAGES.home(), { replace: true });
  }, [onboarding, onWelcome, settled, location, navigate]);

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
