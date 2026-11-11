import { describe, expect, it, vi } from "vitest";
import { click, flush, key, mount } from "../../../test/render.tsx";
import { Avatar } from "../Avatar/Avatar.tsx";
import { Menu } from "./Menu.tsx";

const items = (onSelect = vi.fn()) => [
  { id: "a", label: "A", onSelect },
  { id: "b", label: "B", onSelect },
  { id: "c", label: "C", onSelect },
];

describe("Menu", () => {
  it("К-9: aria-haspopup/expanded; ↓ открывает и фокусирует первый; ↑ ↓ Home End по кругу", async () => {
    const root = await mount(<Menu label="Меню" trigger="T" items={items()} />);
    const button = root.querySelector("button")!;
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    await key(button, "ArrowDown");
    await flush();
    const menu = root.querySelector('[role="menu"]')!;
    const labels = (): string | null | undefined => document.activeElement?.textContent;
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(labels()).toBe("A");
    await key(menu, "ArrowUp");
    expect(labels()).toBe("C");
    await key(menu, "ArrowDown");
    expect(labels()).toBe("A");
    await key(menu, "End");
    expect(labels()).toBe("C");
    await key(menu, "Home");
    expect(labels()).toBe("A");
  });

  it("К-9: Esc закрывает и возвращает фокус на кнопку", async () => {
    const root = await mount(<Menu label="Меню" trigger="T" items={items()} />);
    const button = root.querySelector("button")!;
    await click(button);
    await key(root.querySelector('[role="menu"]'), "Escape");
    expect(root.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("К-9: выбор пункта вызывает onSelect и закрывает меню", async () => {
    const onSelect = vi.fn();
    const root = await mount(<Menu label="Меню" trigger="T" items={items(onSelect)} />);
    await click(root.querySelector("button"));
    await click(root.querySelectorAll('[role="menuitem"]')[1] ?? null);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(root.querySelector('[role="menu"]')).toBeNull();
  });
});

describe("Avatar", () => {
  it("К-9: картинка только с lh3.googleusercontent.com, иначе заглушка", async () => {
    const ok = await mount(<Avatar url="https://lh3.googleusercontent.com/a/x" size="s" />);
    expect(ok.querySelector("img")?.getAttribute("referrerpolicy")).toBe("no-referrer");
    const bad = await mount(<Avatar url="https://evil.example/x.png" size="s" />);
    expect(bad.querySelector("img")).toBeNull();
    expect(bad.querySelector("[data-placeholder]")).not.toBeNull();
  });
});
