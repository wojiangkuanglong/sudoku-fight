import { cloneGrid } from "./sudoku.js";
import type { Difficulty, Digit, Grid9, PuzzlePack } from "./types.js";
import { PUZZLES } from "./puzzles.js";

/** 终局提示数区间（含）：题面数字越多通常越简单 */
const CLUE_RANGE: Record<Difficulty, readonly [number, number]> = {
  easy: [36, 44],
  medium: [28, 34],
  hard: [22, 27],
};

function shuffleInPlace<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

function isValidPlacement(grid: Grid9, row: number, col: number, num: Digit): boolean {
  for (let i = 0; i < 9; i++) {
    if (grid[row]![i] === num) return false;
    if (grid[i]![col] === num) return false;
  }
  const br = Math.floor(row / 3) * 3;
  const bc = Math.floor(col / 3) * 3;
  for (let r = br; r < br + 3; r++) {
    for (let c = bc; c < bc + 3; c++) {
      if (grid[r]![c] === num) return false;
    }
  }
  return true;
}

function findEmpty(grid: Grid9): [number, number] | null {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (grid[r]![c]! === 0) return [r, c];
    }
  }
  return null;
}

/** 回溯求解，统计解的个数，达到 limit 即停（用于唯一解判定） */
export function countSolutionsUpTo(grid: Grid9, limit: number): number {
  const g = cloneGrid(grid);
  let count = 0;

  function dfs(): void {
    if (count >= limit) return;
    const pos = findEmpty(g);
    if (!pos) {
      count++;
      return;
    }
    const [row, col] = pos;
    for (let n = 1; n <= 9; n++) {
      const d = n as Digit;
      if (!isValidPlacement(g, row, col, d)) continue;
      g[row]![col] = d;
      dfs();
      if (count >= limit) return;
      g[row]![col] = 0;
    }
  }

  dfs();
  return count;
}

function hasUniqueSolution(grid: Grid9): boolean {
  return countSolutionsUpTo(grid, 2) === 1;
}

function fillGridRandom(grid: Grid9, rng: () => number): boolean {
  const pos = findEmpty(grid);
  if (!pos) return true;
  const [row, col] = pos;
  const nums: Digit[] = [1, 2, 3, 4, 5, 6, 7, 8, 9] as Digit[];
  shuffleInPlace(nums, rng);
  for (const d of nums) {
    if (!isValidPlacement(grid, row, col, d)) continue;
    grid[row]![col] = d;
    if (fillGridRandom(grid, rng)) return true;
    grid[row]![col] = 0;
  }
  return false;
}

/** 生成一帧完整合法终盘 */
export function generateSolvedGrid(rng: () => number = Math.random): Grid9 {
  const grid = Array.from({ length: 9 }, () =>
    Array.from({ length: 9 }, () => 0 as Digit),
  ) as Grid9;
  fillGridRandom(grid, rng);
  return grid;
}

function countClues(g: Grid9): number {
  let n = 0;
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (g[r]![c]! !== 0) n++;
    }
  }
  return n;
}

function allCellPairs(): [number, number][] {
  const p: [number, number][] = [];
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) p.push([r, c]);
  }
  return p;
}

/**
 * 从终盘挖空，保证唯一解；目标提示数落在 difficulty 对应区间。
 */
export function digPuzzleFromSolution(
  solution: Grid9,
  difficulty: Difficulty,
  rng: () => number = Math.random,
): Grid9 | null {
  const [minClues, maxClues] = CLUE_RANGE[difficulty];
  const targetClues = minClues + Math.floor(rng() * (maxClues - minClues + 1));
  const wantRemove = 81 - targetClues;

  const givens = cloneGrid(solution);
  const order = allCellPairs();
  shuffleInPlace(order, rng);

  let removed = 0;
  for (const [r, c] of order) {
    if (removed >= wantRemove) break;
    const backup = givens[r]![c]!;
    if (backup === 0) continue;
    givens[r]![c] = 0;
    if (hasUniqueSolution(givens)) {
      removed++;
    } else {
      givens[r]![c] = backup;
    }
  }

  const clues = countClues(givens);
  if (clues < minClues - 2 || clues > maxClues + 2) return null;
  return givens;
}

/**
 * 生成一道带难度标签的题目；失败时回退到内置静态题。
 */
export function generatePuzzlePack(
  difficulty: Difficulty,
  rng: () => number = Math.random,
): PuzzlePack {
  const maxAttempts = 28;
  for (let a = 0; a < maxAttempts; a++) {
    const solution = generateSolvedGrid(rng);
    const givens = digPuzzleFromSolution(solution, difficulty, rng);
    if (givens && hasUniqueSolution(givens)) {
      const id = `${difficulty}-${Date.now().toString(36)}-${Math.floor(rng() * 1e9)
        .toString(36)
        .slice(0, 6)}`;
      return { id, givens, solution, difficulty };
    }
  }
  const fallback = PUZZLES[Math.floor(rng() * PUZZLES.length)]!;
  return {
    id: `${difficulty}-fallback-${fallback.id}`,
    givens: cloneGrid(fallback.givens),
    solution: cloneGrid(fallback.solution),
    difficulty,
  };
}

/** 开局随机难度：略偏多中等题 */
export function randomDifficulty(rng: () => number = Math.random): Difficulty {
  const t = rng();
  if (t < 0.22) return "easy";
  if (t < 0.72) return "medium";
  return "hard";
}
