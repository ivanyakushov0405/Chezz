import { useEffect, useState } from "react";

/** `performance.now()`, обновляется каждые 100 мс, пока `active` (отсчёт часов, API §9.4). */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    setNow(performance.now());
    if (!active) return;
    const id = window.setInterval(() => setNow(performance.now()), 100);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}
