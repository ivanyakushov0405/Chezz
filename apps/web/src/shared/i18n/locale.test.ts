import { describe, expect, it } from "vitest";
import { detectLocale, LOCALE_STORAGE_KEY } from "./locale.ts";

const store = (value: string | null) => ({ getItem: (k: string) => (k === LOCALE_STORAGE_KEY ? value : null) });

describe("detectLocale", () => {
  it("EC-20: браузер", () => {
    expect(detectLocale(store(null), "ru-UA")).toBe("ru");
    expect(detectLocale(store(null), "de-DE")).toBe("en");
    expect(detectLocale(store(null), "en-US")).toBe("en");
  });
  it("EC-20: localStorage главнее, мусор игнорируется", () => {
    expect(detectLocale(store("en"), "ru-RU")).toBe("en");
    expect(detectLocale(store("ru"), "en-US")).toBe("ru");
    expect(detectLocale(store("fr"), "ru-RU")).toBe("ru");
    expect(detectLocale(store("fr"), "en-US")).toBe("en");
  });
  it("без хранилища", () => {
    expect(detectLocale(null, "ru")).toBe("ru");
  });
});
