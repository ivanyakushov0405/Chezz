import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "../Button/Button.tsx";
import styles from "./Menu.module.css";

export interface MenuItem {
  id: string;
  label: string;
  onSelect: () => void | Promise<void>;
  loading?: boolean;
}

export interface MenuProps {
  /** В `aria-label` кнопки. */
  label: string;
  trigger: ReactNode;
  items: readonly MenuItem[];
  /** Заголовок внутри меню (ник). */
  heading?: ReactNode;
}

/**
 * Menu (DESIGN §7): кнопка `aria-haspopup="menu"`, список `role="menu"`; ↑ ↓ Home End, Esc и клик вне закрывают,
 * фокус возвращается на кнопку. Пока пункт `loading` — меню открыто.
 */
export function Menu({ label, trigger, items, heading }: MenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();
  const busy = items.some((i) => i.loading === true);

  const focusItem = (index: number): void => {
    const n = items.length;
    if (n === 0) return;
    itemRefs.current[((index % n) + n) % n]?.focus();
  };

  const close = (returnFocus: boolean): void => {
    if (busy) return;
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  });

  const openAndFocus = (index: number): void => {
    setOpen(true);
    // Пункты появляются после рендера.
    queueMicrotask(() => focusItem(index));
  };

  const onButtonKey = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openAndFocus(0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      openAndFocus(items.length - 1);
    }
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const index = itemRefs.current.findIndex((el) => el === document.activeElement);
    if (e.key === "ArrowDown") focusItem(index + 1);
    else if (e.key === "ArrowUp") focusItem(index - 1);
    else if (e.key === "Home") focusItem(0);
    else if (e.key === "End") focusItem(items.length - 1);
    else if (e.key === "Escape") close(true);
    else if (e.key === "Tab") close(false);
    else return;
    if (e.key !== "Tab") e.preventDefault();
  };

  const select = async (item: MenuItem): Promise<void> => {
    await item.onSelect();
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <div className={styles["root"]} ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={styles["trigger"]}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={onButtonKey}
      >
        {trigger}
      </button>
      {open ? (
        <div id={menuId} role="menu" aria-label={label} className={styles["menu"]} onKeyDown={onMenuKey}>
          {heading !== undefined ? <div className={styles["heading"]}>{heading}</div> : null}
          {items.map((item, i) => (
            <Button
              key={item.id}
              ref={(el: HTMLButtonElement | null) => {
                itemRefs.current[i] = el;
              }}
              role="menuitem"
              variant="ghost"
              block
              className={styles["item"]}
              loading={item.loading === true}
              tabIndex={-1}
              onClick={() => void select(item)}
            >
              {item.label}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
