// Экран `welcome` — первый вход: ник и принятие правил (DESIGN §9, §10.4; design-spec E04; К-5, К-7, К-9).
import { isReservedNickname, NICKNAME_RE, PAGES, REST_ROUTES, safeLocalPath, type Me } from "@chezz/protocol";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { errorCodeOf, useMe } from "../../features/auth/MeContext.tsx";
import { callApi } from "../../shared/api/rest.ts";
import { useT } from "../../shared/i18n/I18nContext.tsx";
import { clearGuestLocale, storedGuestLocale } from "../../shared/i18n/locale.ts";
import { T } from "../../shared/i18n/T.tsx";
import { useLocation, useNavigate } from "../../shared/router/Router.tsx";
import { Button } from "../../shared/ui/Button/Button.tsx";
import { Checkbox } from "../../shared/ui/Checkbox/Checkbox.tsx";
import { TextField } from "../../shared/ui/TextField/TextField.tsx";
import { useToast } from "../../shared/ui/Toast/Toast.tsx";
import styles from "./WelcomePage.module.css";

const FIELD_ERRORS = new Set(["nickname_invalid", "nickname_reserved", "nickname_taken"]);

/** Ошибка формата на клиенте (тот же regex и список S14, что у сервера), иначе undefined. */
export function nicknameError(nickname: string): string | undefined {
  if (!NICKNAME_RE.test(nickname)) return "error.nickname_invalid";
  if (isReservedNickname(nickname)) return "error.nickname_reserved";
  return undefined;
}

/** U29: язык, выбранный гостем, переносится в `Me.locale`; ключ localStorage чистится. Сбой PATCH — не мешает входу. */
async function carryGuestLocale(me: Me): Promise<Me> {
  const stored = storedGuestLocale();
  if (stored === null) return me;
  if (stored === me.locale) {
    clearGuestLocale();
    return me;
  }
  try {
    const { user } = await callApi(REST_ROUTES.updateMe, { body: { locale: stored } });
    clearGuestLocale();
    return user;
  } catch {
    return me;
  }
}

export function WelcomePage() {
  const t = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const { setMe, refresh } = useMe();
  const [nickname, setNickname] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [changed, setChanged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const termsId = useId();

  useEffect(() => {
    document.title = `${t("welcome.title")} — ${t("app.name")}`;
  }, [t]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const fail = (key: string): void => {
    setError(key);
    inputRef.current?.focus();
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!accepted || submitting) return;
    const local = nicknameError(nickname);
    if (local !== undefined) return fail(local);
    setSubmitting(true);
    try {
      const { user } = await callApi(REST_ROUTES.completeOnboarding, { body: { nickname, terms_accepted: true } });
      const me = await carryGuestLocale(user);
      const returnTo = new URLSearchParams(location.search).get("return_to");
      setMe(me);
      navigate(safeLocalPath(returnTo, window.location.origin), { replace: true });
    } catch (err) {
      setSubmitting(false);
      const code = errorCodeOf(err);
      if (FIELD_ERRORS.has(code)) return fail(`error.${code}`);
      if (code === "onboarding_completed") {
        await refresh();
        navigate(PAGES.home(), { replace: true });
        return;
      }
      toast({ message: `error.${code}`, tone: "danger" });
    }
  };

  const link = (href: string, key: string) => (
    <a href={href} target="_blank" rel="noopener">
      {t(key)}
    </a>
  );

  return (
    <main className={styles["screen"]} data-screen="welcome" data-state={submitting ? "submitting" : error !== undefined ? "field-error" : "default"}>
      <form className={styles["card"]} onSubmit={(e) => void submit(e)} aria-busy={submitting ? true : undefined} noValidate>
        <h1 className={styles["title"]}>{t("welcome.title")}</h1>
        <TextField
          ref={inputRef}
          label={t("welcome.nickname_label")}
          name="nickname"
          autoComplete="username"
          spellCheck={false}
          maxLength={64}
          value={nickname}
          disabled={submitting}
          hint="welcome.nickname_hint"
          error={error}
          onChange={(v) => {
            setNickname(v);
            setChanged(true);
            setError(undefined);
          }}
          onBlur={() => {
            // Только добавляет ошибку формата: blur при disabled на время отправки не стирает ответ сервера.
            if (submitting || !changed || nickname === "") return;
            const local = nicknameError(nickname);
            if (local !== undefined) setError(local);
          }}
        />
        <Checkbox
          labelId={termsId}
          value={accepted}
          disabled={submitting}
          onChange={setAccepted}
          label={<T k="welcome.terms" nodes={{ terms: link(PAGES.terms(), "welcome.terms_link"), privacy: link(PAGES.privacy(), "welcome.privacy_link") }} />}
        />
        <Button type="submit" block disabled={!accepted} loading={submitting} aria-describedby={termsId}>
          {t("welcome.submit")}
        </Button>
      </form>
    </main>
  );
}
