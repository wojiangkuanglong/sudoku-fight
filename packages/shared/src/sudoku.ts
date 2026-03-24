import type { Digit, Grid9 } from "./types.js";

export function cloneGrid(grid: Grid9): Grid9 {
  return grid.map((row) => [...row]) as Grid9;
}

export function gridsEqual(a: Grid9, b: Grid9): boolean {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (a[r]![c] !== b[r]![c]) return false;
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
      if (grid[r]![c]! !== 0) n++;
    }
  }
  return n;
}
