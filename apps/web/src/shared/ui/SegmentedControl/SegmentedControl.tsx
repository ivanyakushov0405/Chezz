import styles from "./SegmentedControl.module.css";

export interface SegmentedOption<V extends string> {
  value: V;
  label: string;
}

export interface SegmentedControlProps<V extends string> {
  options: readonly SegmentedOption<V>[];
  value: V;
  onChange: (value: V) => void;
  /** Имя группы (`aria-label`). */
  label: string;
}

/** SegmentedControl (DESIGN §7): выбор из 2–4; текущий — `aria-pressed`. */
export function SegmentedControl<V extends string>({ options, value, onChange, label }: SegmentedControlProps<V>) {
  return (
    <div className={styles["group"]} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={styles["option"]}
          aria-pressed={o.value === value}
          onClick={() => {
            if (o.value !== value) onChange(o.value);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
