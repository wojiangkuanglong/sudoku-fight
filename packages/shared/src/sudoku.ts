import type { Digit, Grid9 } from "./types.js";

export function cloneGrid(grid: Grid9): Grid9 {
  return grid.map((row) => [...row]) as Grid9;
}

export function gridsEqual(a: Grid9, b: Grid9): boolean {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (a[r]![c] !== b[r]![c]) {
        return false;
      }
    }
  }
  return true;
}

export function isSolved(player: Grid9, solution: Grid9): boolean {
  return gridsEqual(player, solution);
}

export function isGiven(givens: Grid9, row: number, col: number): boolean {
  return givens[row]![col]! !== 0;
}

export function isValidDigit(v: number): v is Digit {
  return Number.isInteger(v) && v >= 0 && v <= 9;
}

/** 统计非空格数量（含给定） */
export function filledCount(grid: Grid9): number {
  let n = 0;
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (grid[r]![c]! !== 0) {
        n++;
      }
    }
  }
  return n;
}

/** 与 (row,col) 同值冲突的格子键，格式 `r-c`（含自身，便于高亮整块冲突） */
export function conflictKeysForCell(
  grid: Grid9,
  row: number,
  col: number
): Set<string> {
  const keys = new Set<string>();
  const v = grid[row]![col]!;
  if (v === 0) {
    return keys;
  }

  for (let c = 0; c < 9; c++) {
    if (grid[row]![c] === v) {
      keys.add(`${row}-${c}`);
    }
  }
  for (let r = 0; r < 9; r++) {
    if (grid[r]![col] === v) {
      keys.add(`${r}-${col}`);
    }
  }
  const br = Math.floor(row / 3) * 3;
  const bc = Math.floor(col / 3) * 3;
  for (let r = br; r < br + 3; r++) {
    for (let c = bc; c < bc + 3; c++) {
      if (grid[r]![c] === v) {
        keys.add(`${r}-${c}`);
      }
    }
  }
  return keys;
}

/** 所有非空格中与规则冲突的格子键（行/列/九宫出现重复数字） */
export function allConflictKeys(grid: Grid9): Set<string> {
  const bad = new Set<string>();
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (grid[r]![c]! === 0) {
        continue;
      }
      const k = conflictKeysForCell(grid, r, c);
      if (k.size > 1) {
        for (const key of k) {
          bad.add(key);
        }
      }
    }
  }
  return bad;
}
