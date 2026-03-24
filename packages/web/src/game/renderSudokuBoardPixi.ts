/**
 * 纯 Canvas/Pixi 绘制逻辑，与 React 解耦，便于移植到微信小游戏（同样使用 Canvas 2D / WebGL 适配层）。
 * 微信侧可复用：SudokuBoardVisualState + 本文件绘制函数，网络层换为 wx.sendSocketMessage 等。
 */
import { Container, Graphics, Rectangle, Text, TextStyle } from "pixi.js";
import type { Grid9 } from "@sudoku-fight/shared";

export type SudokuBoardVisualState = {
  grid: Grid9;
  givens: Grid9;
  blindRows: boolean[];
  blindCols: boolean[];
  blindBoxes: boolean[];
  conflicts: Set<string>;
  selected: { row: number; col: number } | null;
  /** 被技能锁定的格子（仅展示） */
  lockedCell: { row: number; col: number } | null;
  readOnly: boolean;
};

export type BoardColorScheme = "dark" | "light";

const PALETTE = {
  dark: {
    cell: 0x1a1730,
    conflict: 0x4a1d35,
    selected: 0x1a3d48,
    given: 0xc4b5fd,
    user: 0xf4f4ff,
    conflictText: 0xfecdd3,
    line: 0x3d3a55,
    lineThick: 0x5b5678,
    accent: 0x2ee6d6,
    blind: 0x06050a,
  },
  light: {
    cell: 0xf1f5f9,
    conflict: 0xffe4e6,
    selected: 0xccfbf1,
    given: 0x4338ca,
    user: 0x0f172a,
    conflictText: 0xbe123c,
    line: 0xcbd5e1,
    lineThick: 0x94a3b8,
    accent: 0x0d9488,
    blind: 0xe2e8f0,
  },
} as const;

function cellIsBlinded(
  row: number,
  col: number,
  state: Pick<SudokuBoardVisualState, "blindRows" | "blindCols" | "blindBoxes">,
): boolean {
  const box = Math.floor(row / 3) * 3 + Math.floor(col / 3);
  return Boolean(state.blindRows[row] || state.blindCols[col] || state.blindBoxes[box]);
}

export function renderSudokuBoardPixi(
  root: Container,
  state: SudokuBoardVisualState,
  sizePx: number,
  scheme: BoardColorScheme = "dark",
): void {
  const C = PALETTE[scheme];
  root.removeChildren();
  const cell = sizePx / 9;
  const fontSize = Math.max(14, cell * 0.42);

  const styleGiven = new TextStyle({
    fontFamily: 'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif',
    fontSize,
    fontWeight: "700",
    fill: C.given,
  });
  const styleUser = new TextStyle({
    fontFamily: 'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif',
    fontSize,
    fontWeight: "600",
    fill: C.user,
  });
  const styleConflict = new TextStyle({
    fontFamily: 'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif',
    fontSize,
    fontWeight: "600",
    fill: C.conflictText,
  });

  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      const x = col * cell;
      const y = row * cell;
      const given = state.givens[row]![col]! !== 0;
      const display = given ? state.givens[row]![col]! : state.grid[row]![col]!;
      const key = `${row}-${col}`;
      const conflict = state.conflicts.has(key);
      const sel = state.selected?.row === row && state.selected?.col === col;
      const blinded = cellIsBlinded(row, col, state);

      const g = new Graphics();
      let fill: number = C.cell;
      if (conflict) fill = C.conflict;
      if (sel) fill = C.selected;
      g.rect(x, y, cell, cell).fill({ color: fill });

      const thin = 1;
      const thick = 2.5;
      const tr = col === 2 || col === 5 ? thick : thin;
      const tb = row === 2 || row === 5 ? thick : thin;
      g.moveTo(x + cell, y).lineTo(x + cell, y + cell).stroke({ width: tr, color: col === 8 ? C.lineThick : C.line });
      g.moveTo(x, y + cell).lineTo(x + cell, y + cell).stroke({ width: tb, color: row === 8 ? C.lineThick : C.line });

      root.addChild(g);

      if (display !== 0 && !blinded) {
        const style = conflict ? styleConflict : given ? styleGiven : styleUser;
        const t = new Text({ text: String(display), style });
        t.anchor.set(0.5);
        t.x = x + cell / 2;
        t.y = y + cell / 2;
        root.addChild(t);
      }
    }
  }

  const border = new Graphics();
  border
    .rect(0, 0, sizePx, sizePx)
    .stroke({ width: 2.5, color: C.lineThick });
  root.addChildAt(border, 0);

  const blindLayer = new Graphics();
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      const box = Math.floor(row / 3) * 3 + Math.floor(col / 3);
      if (!state.blindRows[row] && !state.blindCols[col] && !state.blindBoxes[box]) continue;
      blindLayer.rect(col * cell, row * cell, cell, cell).fill({ color: C.blind, alpha: 1 });
    }
  }
  root.addChild(blindLayer);

  if (state.selected && !state.readOnly) {
    const { row, col } = state.selected;
    const x = col * cell;
    const y = row * cell;
    const ring = new Graphics();
    ring.rect(x + 1, y + 1, cell - 2, cell - 2).stroke({ width: 2.5, color: C.accent });
    root.addChild(ring);
  }

  if (state.lockedCell) {
    const { row, col } = state.lockedCell;
    const x = col * cell;
    const y = row * cell;
    const lockRing = new Graphics();
    lockRing
      .rect(x + 2, y + 2, cell - 4, cell - 4)
      .stroke({ width: 2.2, color: 0xfbbf24, alpha: 0.95 });
    root.addChild(lockRing);
  }
}

export function boardCellFromPointer(
  sizePx: number,
  localX: number,
  localY: number,
): { row: number; col: number } | null {
  if (localX < 0 || localY < 0 || localX > sizePx || localY > sizePx) return null;
  const cell = sizePx / 9;
  return {
    row: Math.min(8, Math.max(0, Math.floor(localY / cell))),
    col: Math.min(8, Math.max(0, Math.floor(localX / cell))),
  };
}

export function attachBoardInteraction(
  board: Container,
  sizePx: number,
  opts: {
    readOnly: boolean;
    onSelect: (row: number, col: number) => void;
  },
): () => void {
  if (opts.readOnly) {
    board.eventMode = "none";
    board.removeAllListeners();
    board.hitArea = null;
    board.cursor = "default";
    return () => {};
  }
  board.eventMode = "static";
  board.hitArea = new Rectangle(0, 0, sizePx, sizePx);
  board.cursor = "pointer";
  const down = (ev: { getLocalPosition: (container: Container) => { x: number; y: number } }) => {
    const p = ev.getLocalPosition(board);
    const cell = boardCellFromPointer(sizePx, p.x, p.y);
    if (cell) opts.onSelect(cell.row, cell.col);
  };
  board.on("pointerdown", down);
  return () => {
    board.off("pointerdown", down);
  };
}
