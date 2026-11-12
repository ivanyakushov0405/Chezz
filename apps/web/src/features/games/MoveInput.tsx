import { useState, type KeyboardEvent } from "react";
import { useT } from "../../shared/i18n/I18nContext.tsx";
import { Button } from "../../shared/ui/Button/Button.tsx";
import { TextField } from "../../shared/ui/TextField/TextField.tsx";
import styles from "./MoveInput.module.css";

/**
 * MoveInput (U19): ход с клавиатуры — SAN или UCI, Enter. На `s` поле скрыто за кнопкой «⌨ Ход» (U30).
 * `onSubmit` → true — ход отправлен (поле очищается), false — такого хода нет (ошибка под полем).
 */
export function MoveInput({ onSubmit, disabled }: { onSubmit: (text: string) => boolean; disabled: boolean }) {
  const t = useT();
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [open, setOpen] = useState(false);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (value.trim() === "" || disabled) return;
    if (onSubmit(value.trim())) {
      setValue("");
      setInvalid(false);
    } else setInvalid(true);
  };

  return (
    <div className={styles["wrap"]} data-open={open || undefined}>
      <Button variant="secondary" className={styles["toggle"]} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {t("game.move_input.toggle")}
      </Button>
      <div className={styles["field"]}>
        <TextField
          label={t("game.move_input.label")}
          value={value}
          onChange={(v) => {
            setValue(v);
            setInvalid(false);
          }}
          onKeyDown={onKeyDown}
          hint="game.move_input.hint"
          error={invalid ? "game.move_input.invalid" : undefined}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          disabled={disabled}
          data-move-input="true"
        />
      </div>
    </div>
  );
}
