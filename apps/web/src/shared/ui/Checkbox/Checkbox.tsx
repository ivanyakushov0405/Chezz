import { useId, type ReactNode } from "react";
import styles from "./Checkbox.module.css";

export interface CheckboxProps {
  /** Подпись; ReactNode — чтобы вставить ссылки (design-spec E04, п.6). */
  label: ReactNode;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  /** id подписи — для `aria-describedby` у связанной кнопки (DESIGN §14). */
  labelId?: string;
}

/** Checkbox (DESIGN §7): нативный `<input>` визуально скрыт, квадрат — CSS; вся подпись — цель касания. */
export function Checkbox({ label, value, onChange, disabled = false, labelId }: CheckboxProps) {
  const auto = useId();
  const textId = labelId ?? `${auto}-label`;
  return (
    <label className={styles["row"]} data-checked={value ? "true" : undefined}>
      <input
        type="checkbox"
        className={styles["input"]}
        checked={value}
        disabled={disabled}
        aria-labelledby={textId}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className={styles["box"]} aria-hidden="true">
        <svg viewBox="0 0 16 16" className={styles["mark"]} focusable="false">
          <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span id={textId} className={styles["text"]}>
        {label}
      </span>
    </label>
  );
}
