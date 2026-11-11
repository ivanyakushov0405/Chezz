import { Fragment, type ReactNode } from "react";
import { useT } from "./I18nContext.tsx";

/**
 * Перевод с React-узлами на месте `{name}` (бриф E04, «Решения», п.6): фраза целиком в переводе,
 * HTML в строках нет (DESIGN §15). Строковые подстановки — через `t()`.
 */
export function T({ k, nodes }: { k: string; nodes: Readonly<Record<string, ReactNode>> }) {
  const t = useT();
  const text = t(k);
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(/\{(\w+)\}/g)) {
    const name = match[1] ?? "";
    if (!(name in nodes)) continue;
    parts.push(text.slice(last, match.index));
    parts.push(<Fragment key={`${name}-${match.index}`}>{nodes[name]}</Fragment>);
    last = match.index + match[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}
