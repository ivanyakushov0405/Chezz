// Свой роутер поверх history (бриф E04, «Решения»): адреса — только PAGES (API §14, §15).
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";

export interface Location {
  pathname: string;
  search: string;
}

interface RouterValue {
  location: Location;
  navigate: (to: string, options?: { replace?: boolean }) => void;
}

const RouterContext = createContext<RouterValue | null>(null);

function current(): Location {
  return { pathname: window.location.pathname, search: window.location.search };
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState<Location>(current);

  useEffect(() => {
    const onPop = (): void => setLocation(current());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
    const url = new URL(to, window.location.origin);
    // Только свой origin: внешнее (и /auth/*) — полная загрузка.
    if (url.origin !== window.location.origin) {
      window.location.assign(url.href);
      return;
    }
    const target = `${url.pathname}${url.search}${url.hash}`;
    if (options?.replace) window.history.replaceState(null, "", target);
    else window.history.pushState(null, "", target);
    setLocation({ pathname: url.pathname, search: url.search });
    window.scrollTo?.(0, 0);
  }, []);

  const value = useMemo(() => ({ location, navigate }), [location, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

function useRouter(): RouterValue {
  const v = useContext(RouterContext);
  if (!v) throw new Error("useRouter вне RouterProvider");
  return v;
}

export const useLocation = (): Location => useRouter().location;
export const useNavigate = (): RouterValue["navigate"] => useRouter().navigate;

/** Текущий путь с query — для `return_to` (PAGES). */
export function currentPath(location: Location): string {
  return `${location.pathname}${location.search}`;
}

export type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };

/** Ссылка SPA: обычный клик — без перезагрузки; с модификаторами, `target` или `/auth/*` — как у браузера. */
export function Link({ href, onClick, target, ...rest }: LinkProps) {
  const navigate = useNavigate();
  const handle = (event: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (target !== undefined && target !== "_self") return;
    if (href.startsWith("/auth/")) return;
    event.preventDefault();
    navigate(href);
  };
  return <a href={href} target={target} onClick={handle} {...rest} />;
}
