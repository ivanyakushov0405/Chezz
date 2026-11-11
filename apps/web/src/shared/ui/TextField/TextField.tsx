import { useId, type InputHTMLAttributes, type Ref } from "react";
import { useT } from "../../i18n/I18nContext.tsx";
import styles from "./TextField.module.css";

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "className"> {
  /** Видимая подпись (уже переведённая строка). */
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Ключ перевода подсказки. */
  hint?: string;
  /** Ключ перевода ошибки; при ошибке подсказка остаётся под ней (DESIGN §7). */
  error?: string;
  ref?: Ref<HTMLInputElement>;
}

/** TextField (DESIGN §7): `<label>`, подсказка и ошибка под полем, обе в `aria-describedby`. */
export function TextField({ label, value, onChange, hint, error, id, ref, ...rest }: TextFieldProps) {
  const t = useT();
  const auto = useId();
  const inputId = id ?? auto;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const describedBy = [error !== undefined ? errorId : null, hint !== undefined ? hintId : null].filter(Boolean).join(" ");
  return (
    <div className={styles["field"]} data-error={error !== undefined ? "true" : undefined}>
      <label className={styles["label"]} htmlFor={inputId}>
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        className={styles["input"]}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error !== undefined ? true : undefined}
        aria-describedby={describedBy === "" ? undefined : describedBy}
        {...rest}
      />
      {error !== undefined ? (
        <p id={errorId} className={styles["error"]}>
          {t(error)}
        </p>
      ) : null}
      {hint !== undefined ? (
        <p id={hintId} className={styles["hint"]}>
          {t(hint)}
        </p>
      ) : null}
    </div>
  );
}
