export type Digit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type Grid9 = Digit[][];

export type Difficulty = "easy" | "medium" | "hard";

export type ItemType =
  | "area_blind"
  | "undo_three"
  | "freeze"
  | "eraser_one"
  | "silence"
  | "lock_cell"
  | "cooldown_hurt"
  | "bomb_digit";

export interface PuzzlePack {
  id: string;
  givens: Grid9;
  solution: Grid9;
  difficulty: Difficulty;
}

export interface MoveRecord {
  row: number;
  col: number;
  before: Digit;
  after: Digit;
}

/** 客户端展示用常量（与服务端配置保持一致） */
export const ROW_BLIND_MS = 30_000;
export const FREEZE_MS = 8_000;
export const SILENCE_MS = 15_000;
export const CELL_LOCK_MS = 12_000;
export const COOLDOWN_SPIKE_MS = 12_000;
export const ITEM_COOLDOWN_MS = 45_000;
export const ITEM_MAX_PER_GAME = 3;
