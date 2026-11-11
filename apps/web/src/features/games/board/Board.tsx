// Board (DESIGN §6, §7): обёртка chessground. Ход — перетаскиванием или кликом; допустимые ходы — от ChessPosition.
import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import type { Config } from "chessground/config";
import type { Key } from "chessground/types";
import type { Color } from "@chezz/protocol";
import { useEffect, useRef } from "react";
import "./board.css";
import "./pieces-cburnett.css";

export interface BoardProps {
  fen: string;
  orientation: Color;
  turnColor: Color;
  /** Последний ход в UCI — подсветка `last-move`. */
  lastMove: string | null;
  inCheck: boolean;
  /** Чья сторона может ходить сейчас; null — только просмотр. */
  movableColor: Color | null;
  /** Допустимые ходы в UCI (`legalUci`). */
  legalUci: readonly string[];
  onMove: (orig: string, dest: string) => void;
  boardTheme: string;
  label: string;
}

/** UCI → карта «поле → поля» для chessground; превращения дают одно поле назначения. */
export function destsOf(legalUci: readonly string[]): Map<Key, Key[]> {
  const dests = new Map<Key, Key[]>();
  for (const uci of legalUci) {
    const from = uci.slice(0, 2) as Key;
    const to = uci.slice(2, 4) as Key;
    const list = dests.get(from) ?? [];
    if (!list.includes(to)) list.push(to);
    dests.set(from, list);
  }
  return dests;
}

function configOf(props: BoardProps): Config {
  const last = props.lastMove;
  return {
    fen: props.fen,
    orientation: props.orientation,
    turnColor: props.turnColor,
    check: props.inCheck,
    lastMove: last === null ? undefined : [last.slice(0, 2) as Key, last.slice(2, 4) as Key],
    viewOnly: props.movableColor === null,
    movable: {
      free: false,
      color: props.movableColor ?? undefined,
      dests: props.movableColor === null ? new Map() : destsOf(props.legalUci),
      showDests: true,
    },
  };
}

export function Board(props: BoardProps) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const onMove = useRef(props.onMove);
  onMove.current = props.onMove;

  useEffect(() => {
    if (el.current === null) return;
    const cg = Chessground(el.current, {
      ...configOf(props),
      coordinates: true,
      premovable: { enabled: false },
      drawable: { enabled: false },
      animation: { enabled: true, duration: 150 },
      movable: { ...configOf(props).movable, events: { after: (orig, dest) => onMove.current(orig, dest) } },
    });
    api.current = cg;
    return () => {
      cg.destroy();
      api.current = null;
    };
    // Создаётся один раз; дальше — set() ниже.
  }, []);

  useEffect(() => {
    api.current?.set(configOf(props));
  });

  return (
    <div className="board" data-board-theme={props.boardTheme} role="img" aria-label={props.label}>
      <div ref={el} className="cg-wrap" data-board="true" />
    </div>
  );
}
