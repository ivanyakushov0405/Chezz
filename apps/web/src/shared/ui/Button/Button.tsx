import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { Link } from "../../router/Router.tsx";
import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

interface CommonProps {
  variant?: ButtonVariant;
  size?: "m" | "l";
  /** Во всю ширину родителя. */
  block?: boolean;
  children: ReactNode;
  className?: string;
}

export type ButtonProps = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children"> & {
    /** Блокирует повторный клик (DESIGN §7). */
    loading?: boolean;
    ref?: Ref<HTMLButtonElement>;
  };

function classes(variant: ButtonVariant, size: "m" | "l", block: boolean, extra?: string): string {
  return [styles["button"], styles[variant], styles[size], block ? styles["block"] : "", extra ?? ""].filter(Boolean).join(" ");
}

/** Button (DESIGN §7): `variant`, `size`, `loading`, `disabled`. */
export function Button({ variant = "primary", size = "m", block = false, loading = false, disabled, className, children, type, ...rest }: ButtonProps) {
  return (
    <button
      type={type ?? "button"}
      className={classes(variant, size, block, className)}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      data-loading={loading || undefined}
      {...rest}
    >
      {loading ? <span className={styles["spinner"]} aria-hidden="true" /> : null}
      <span className={styles["label"]}>{children}</span>
    </button>
  );
}

export type ButtonLinkProps = CommonProps & { href: string; target?: string; rel?: string };

/** Ссылка в виде Button (вход через Google — переход, не POST; DESIGN §9 `shell`). */
export function ButtonLink({ variant = "primary", size = "m", block = false, className, children, ...rest }: ButtonLinkProps) {
  return (
    <Link className={classes(variant, size, block, className)} {...rest}>
      <span className={styles["label"]}>{children}</span>
    </Link>
  );
}
