import { ERROR_CODES } from "@chezz/protocol";
import { describe, expect, it } from "vitest";
import { createT, createTFrom, LOCALES, MESSAGES } from "./index.ts";

describe("i18n: ключи", () => {
  it("AC-34, EC-18: набор ключей RU = EN", () => {
    expect(Object.keys(MESSAGES.ru).sort()).toEqual(Object.keys(MESSAGES.en).sort());
  });

  it("AC-34, EC-18: error.<code> на каждый ErrorCode и клиентские ключи", () => {
    for (const locale of LOCALES) {
      const keys = new Set(Object.keys(MESSAGES[locale]));
      for (const code of ERROR_CODES) expect(keys.has(`error.${code}`), `${locale} error.${code}`).toBe(true);
      for (const extra of ["network", "unknown", "engine_failed"]) expect(keys.has(`error.${extra}`)).toBe(true);
    }
  });

  it("AC-34: app.name = Chezz, строки главной", () => {
    expect(MESSAGES.ru["app.name"]).toBe("Chezz");
    expect(MESSAGES.en["app.name"]).toBe("Chezz");
    expect(MESSAGES.ru["app.beta"]).toBe("Бета");
    expect(MESSAGES.en["app.beta"]).toBe("Beta");
    expect(MESSAGES.en["lobby.coming_soon"]).toBe("Online chess is coming soon.");
  });

  it("значения не пустые", () => {
    for (const locale of LOCALES) for (const v of Object.values(MESSAGES[locale])) expect(v.trim()).not.toBe("");
  });
});

describe("createT", () => {
  it("AC-34, EC-19: нет ключа: throw / key", () => {
    expect(() => createT("ru", { onMissing: "throw" })("no.such")).toThrow();
    expect(createT("ru", { onMissing: "key" })("no.such")).toBe("no.such");
  });

  it("подстановка {name}", () => {
    const t = createTFrom({ "hi": "Привет, {name}! {name}, {other}" }, "ru", { onMissing: "throw" });
    expect(t("hi", { name: "Ян" })).toBe("Привет, Ян! Ян, {other}");
  });

  it("множественное число по Intl.PluralRules", () => {
    const ru = createTFrom(
      { "n_one": "{count} партия", "n_few": "{count} партии", "n_many": "{count} партий", "n_other": "{count} партии" },
      "ru",
      { onMissing: "throw" },
    );
    expect([1, 3, 5, 21].map((count) => ru("n", { count }))).toEqual(["1 партия", "3 партии", "5 партий", "21 партия"]);
    const en = createTFrom({ n_one: "{count} game", n_other: "{count} games" }, "en", { onMissing: "throw" });
    expect([en("n", { count: 1 }), en("n", { count: 2 })]).toEqual(["1 game", "2 games"]);
    const plain = createTFrom({ n: "{count} шт." }, "ru", { onMissing: "throw" });
    expect(plain("n", { count: 5 })).toBe("5 шт.");
  });
});

describe("i18n: onMissingKey", () => {
  it("AC-21, EC-26: onMissing=key — колбэк с ключом, возвращается ключ; найденный ключ колбэк не вызывает", () => {
    const seen: string[] = [];
    const t = createTFrom({ a: "A" }, "en", { onMissing: "key", onMissingKey: (k) => seen.push(k) });
    expect(t("a")).toBe("A");
    expect(t("nope")).toBe("nope");
    expect(seen).toEqual(["nope"]);
  });

  it("onMissing=throw — исключение, колбэк не вызывается", () => {
    const seen: string[] = [];
    const t = createTFrom({}, "en", { onMissing: "throw", onMissingKey: (k) => seen.push(k) });
    expect(() => t("x")).toThrow();
    expect(seen).toEqual([]);
  });
});
