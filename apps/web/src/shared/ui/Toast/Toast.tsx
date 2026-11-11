import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useT } from "../../i18n/I18nContext.tsx";
import styles from "./Toast.module.css";

/** Toast (DESIGN §7): `message` — ключ перевода, `tone`, `role="status"`, 5 с. */
export const TOAST_MS = 5_000;

export interface ToastMessage {
  message: string;
  tone: "info" | "danger";
}

type ShowToast = (toast: ToastMessage) => void;

const ToastContext = createContext<ShowToast | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [toast, setToast] = useState<(ToastMessage & { id: number }) | null>(null);
  const seq = useRef(0);

  const show = useCallback<ShowToast>((next) => setToast({ ...next, id: ++seq.current }), []);

  useEffect(() => {
    if (toast === null) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={styles["region"]} role="status" aria-live="polite">
        {toast !== null ? (
          <div key={toast.id} className={`${styles["toast"]} ${styles[toast.tone]}`} data-tone={toast.tone}>
            {t(toast.message)}
          </div>
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ShowToast {
  const v = useContext(ToastContext);
  if (!v) throw new Error("useToast вне ToastProvider");
  return v;
}
