// Экран `game-live` / `game-spectator` (DESIGN §9.3, §10.3, §8): доска, часы, ходы, ввод хода, итог.
// Всё решает сервер (ARCHITECTURE §10): клиент показывает снимок и шлёт `game.move`, отказ возвращает фигуру.
import { ChessPosition } from "@chezz/chess";
import { PAGES, type Color } from "@chezz/protocol";
import { useCallback, useEffect, useMemo, useState } from "react";
import { meOf, useMe } from "../../features/auth/MeContext.tsx";
import { Board } from "../../features/games/board/Board.tsx";
import { Clock } from "../../features/games/Clock.tsx";
import { displayedMs, lowTimeThresholdMs } from "../../features/games/clockDisplay.ts";
import { GameResultPanel } from "../../features/games/GameResultPanel.tsx";
import type { GameView } from "../../features/games/gameState.ts";
import { MoveInput } from "../../features/games/MoveInput.tsx";
import { MoveList } from "../../features/games/MoveList.tsx";
import { PlayerLine } from "../../features/games/PlayerLine.tsx";
import { PromotionPicker, type PromotionPiece } from "../../features/games/PromotionPicker.tsx";
import { useGame } from "../../features/games/useGame.ts";
import { useNow } from "../../features/games/useNow.ts";
import { useT } from "../../shared/i18n/I18nContext.tsx";
import { Button, ButtonLink } from "../../shared/ui/Button/Button.tsx";
import styles from "./GamePage.module.css";

const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/u;
const other = (c: Color): Color => (c === "white" ? "black" : "white");

/** Позиция показа: история `viewPly` или текущая + ход, ждущий ответа (фигура стоит на новом поле). */
function positionOf(view: GameView, viewPly: number | null): ChessPosition {
  const sans = view.game.moves.map((m) => m.san);
  if (viewPly !== null) return ChessPosition.fromSans(sans.slice(0, viewPly));
  const pos = ChessPosition.fromSans(sans);
  if (view.pending !== null) pos.play(view.pending.uci);
  return pos;
}

function LiveGame({ view, online, move }: { view: GameView; online: boolean; move: (uci: string) => boolean }) {
  const t = useT();
  const { state: meState } = useMe();
  const settings = meOf(meState)?.settings;
  const autoQueen = settings?.auto_queen ?? true;
  const { game, yourColor, clock, pending } = view;
  const active = game.status === "active";

  const [viewPly, setViewPly] = useState<number | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [promotion, setPromotion] = useState<{ from: string; to: string } | null>(null);
  // Сброс доски к позиции из состояния после отказанного или отменённого хода (chessground уже сдвинул фигуру).
  const [, setResync] = useState(0);
  const resync = useCallback(() => setResync((n) => n + 1), []);

  const moves = game.moves;
  // Новый ход во время просмотра истории не сбивает просмотр; ход вне истории — показ текущей.
  useEffect(() => {
    if (viewPly !== null && viewPly >= moves.length) setViewPly(null);
  }, [viewPly, moves.length]);

  const position = useMemo(() => positionOf(view, viewPly), [view, viewPly]);
  const current = useMemo(() => (viewPly === null ? position : positionOf(view, null)), [view, viewPly, position]);

  const canMove = active && online && yourColor !== null && viewPly === null && pending === null && promotion === null && current.turn() === yourColor;

  const send = useCallback(
    (uci: string): boolean => {
      const ok = move(uci);
      if (!ok) resync();
      return ok;
    },
    [move, resync],
  );

  /** UCI без буквы превращения: ферзь сразу (`auto_queen`) или выбор фигуры. */
  const tryMove = useCallback(
    (from: string, to: string, piece?: string): boolean => {
      const legal = current.legalUci();
      const base = from + to;
      if (piece !== undefined) return legal.includes(base + piece) ? send(base + piece) : false;
      if (legal.includes(base)) return send(base);
      if (legal.includes(`${base}q`)) {
        if (autoQueen) return send(`${base}q`);
        setPromotion({ from, to });
        return true;
      }
      resync();
      return false;
    },
    [current, autoQueen, send, resync],
  );

  const onBoardMove = useCallback((orig: string, dest: string) => void tryMove(orig, dest), [tryMove]);

  const onTextMove = (text: string): boolean => {
    if (!canMove) return false;
    const uci = UCI_RE.test(text) ? text : current.uciOfSan(text);
    if (uci === null) return false;
    return tryMove(uci.slice(0, 2), uci.slice(2, 4), uci.length === 5 ? uci.slice(4) : undefined);
  };

  const pick = (piece: PromotionPiece): void => {
    if (promotion === null) return;
    const { from, to } = promotion;
    setPromotion(null);
    send(from + to + piece);
  };
  const cancelPromotion = (): void => {
    setPromotion(null);
    resync();
  };

  // ←/→ — навигация по ходам (DESIGN §9.3), кроме полей ввода.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target !== null && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      setViewPly((v) => {
        const shown = v ?? moves.length;
        const next = e.key === "ArrowLeft" ? Math.max(0, shown - 1) : shown + 1;
        return next >= moves.length ? null : next;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moves.length]);

  const now = useNow(active && online && clock.running !== null);
  const ms = (side: Color): number => displayedMs(clock, side, view.clockAt, now, online);
  const threshold = lowTimeThresholdMs(game.time_base);
  const bottom: Color = yourColor ?? (flipped ? "black" : "white");
  const top = other(bottom);
  const lowTime = active && yourColor !== null && ms(yourColor) < threshold;

  const states = [
    !active ? "ended" : null,
    !online ? "reconnecting" : null,
    lowTime ? "low-time" : null,
    promotion !== null ? "promotion" : null,
    pending !== null ? "move-pending" : null,
  ].filter((s): s is string => s !== null);

  const side = (color: Color, where: "top" | "bottom") => (
    <div className={styles[where]} data-side={color}>
      {/* Связь важна только в идущей партии: у законченной из БД подписчиков нет. */}
      <PlayerLine player={game[color]} connected={!active || view.connected[color]} side={where} />
      <Clock
        ms={ms(color)}
        active={active && clock.running === color}
        low={active && color === yourColor && ms(color) < threshold}
        label={t("game.clock_label", { side: t(`game.color.${color}`) })}
      />
    </div>
  );

  const lastMove = position.lastMoveUci();
  return (
    <main
      className={styles["page"]}
      data-screen={yourColor === null ? "game-spectator" : "game-live"}
      data-state={states.length === 0 ? "default" : states.join(" ")}
    >
      {side(top, "top")}
      <div className={styles["boardArea"]}>
        <Board
          fen={position.fen()}
          orientation={bottom}
          turnColor={position.turn()}
          lastMove={lastMove}
          inCheck={position.inCheck()}
          movableColor={canMove ? yourColor : null}
          legalUci={canMove ? current.legalUci() : []}
          onMove={onBoardMove}
          boardTheme={settings?.board_theme ?? "brown"}
          label={t("game.board_label")}
        />
        {!online ? <div className={styles["locked"]} data-board-locked="true" /> : null}
        {promotion !== null && yourColor !== null ? <PromotionPicker color={yourColor} onPick={pick} onCancel={cancelPromotion} /> : null}
      </div>
      {side(bottom, "bottom")}
      <div className={styles["panel"]}>
        {yourColor === null ? (
          <div className={styles["spectator"]}>
            <span data-spectator="true">{t("game.spectator")}</span>
            <Button variant="ghost" onClick={() => setFlipped((f) => !f)}>
              {t("game.flip")}
            </Button>
          </div>
        ) : null}
        {!active ? <GameResultPanel game={game} yourColor={yourColor} /> : null}
        <MoveList moves={moves} viewPly={viewPly} onView={setViewPly} />
        {yourColor !== null && active ? <MoveInput onSubmit={onTextMove} disabled={!online} /> : null}
      </div>
    </main>
  );
}

export function GamePage({ gameId }: { gameId: string }) {
  const t = useT();
  const { state, online, move, retry } = useGame(gameId);

  if (state.status === "ready") return <LiveGame view={state.view} online={online} move={move} />;
  if (state.status === "not-found") {
    return (
      <main className={styles["message"]} data-screen="game-live" data-state="not-found">
        <h1>{t("game.not_found")}</h1>
        <ButtonLink href={PAGES.home()}>{t("not_found.home")}</ButtonLink>
      </main>
    );
  }
  if (state.status === "error") {
    return (
      <main className={styles["message"]} data-screen="game-live" data-state="error">
        <h1>{t("game.load_error")}</h1>
        <p>{t(`error.${state.code}`)}</p>
        <Button onClick={retry}>{t("game.retry")}</Button>
      </main>
    );
  }
  return <main className={styles["page"]} data-screen="game-live" data-state="loading" aria-busy="true" />;
}
