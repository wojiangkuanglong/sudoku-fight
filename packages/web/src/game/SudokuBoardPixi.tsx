import { Application, Container } from "pixi.js";
import { useEffect, useRef } from "react";
import type { Grid9 } from "@sudoku-fight/shared";
import {
  attachBoardInteraction,
  renderSudokuBoardPixi,
  type SudokuBoardVisualState,
} from "./renderSudokuBoardPixi.js";

type Props = {
  grid: Grid9;
  givens: Grid9;
  blindRows: boolean[];
  conflicts: Set<string>;
  selected: { row: number; col: number } | null;
  readOnly: boolean;
  interactive: boolean;
  onSelectCell: (row: number, col: number) => void;
};

/**
 * H5 侧用 Pixi 渲染棋盘；核心绘制在 renderSudokuBoardPixi.ts，便于微信小游戏侧复用。
 */
export function SudokuBoardPixi(props: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const boardRef = useRef<Container | null>(null);
  const detachRef = useRef<(() => void) | null>(null);
  const sizeRef = useRef(360);
  const propsRef = useRef(props);
  propsRef.current = props;
  const applyRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let alive = true;
    let ro: ResizeObserver | null = null;

    const apply = () => {
      const app = appRef.current;
      const board = boardRef.current;
      const hostEl = hostRef.current;
      if (!app || !board || !hostEl) return;
      const w = Math.max(200, Math.floor(hostEl.clientWidth));
      sizeRef.current = w;
      app.renderer.resize(w, w);
      const p = propsRef.current;
      const state: SudokuBoardVisualState = {
        grid: p.grid,
        givens: p.givens,
        blindRows: p.blindRows,
        conflicts: p.conflicts,
        selected: p.selected,
        readOnly: p.readOnly || !p.interactive,
      };
      renderSudokuBoardPixi(board, state, w);
      detachRef.current?.();
      detachRef.current = attachBoardInteraction(board, w, {
        readOnly: p.readOnly || !p.interactive,
        onSelect: (r, c) => p.onSelectCell(r, c),
      });
    };

    applyRef.current = apply;

    void (async () => {
      const app = new Application();
      await app.init({
        background: 0x06050a,
        antialias: true,
        resolution: Math.min(window.devicePixelRatio ?? 1, 2),
        autoDensity: true,
      });
      if (!alive) {
        app.destroy(true);
        return;
      }
      host.replaceChildren(app.canvas as unknown as HTMLElement);
      const board = new Container();
      app.stage.addChild(board);
      appRef.current = app;
      boardRef.current = board;
      ro = new ResizeObserver(() => apply());
      ro.observe(host);
      apply();
    })();

    return () => {
      alive = false;
      applyRef.current = null;
      ro?.disconnect();
      detachRef.current?.();
      detachRef.current = null;
      const a = appRef.current;
      appRef.current = null;
      boardRef.current = null;
      a?.destroy(true, { children: true, texture: true });
      host.replaceChildren();
    };
  }, []);

  useEffect(() => {
    applyRef.current?.();
  }, [
    props.grid,
    props.givens,
    props.blindRows,
    props.conflicts,
    props.selected,
    props.readOnly,
    props.interactive,
    props.onSelectCell,
  ]);

  return (
    <div
      ref={hostRef}
      className="mx-auto aspect-square w-full max-w-[min(100%,24rem)] touch-none select-none"
      aria-label="数独棋盘"
    />
  );
}
