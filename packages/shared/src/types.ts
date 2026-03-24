export type Digit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type Grid9 = Digit[][];

export type ItemType = "row_blind" | "undo_three" | "freeze";

export interface PuzzlePack {
  id: string;
  givens: Grid9;
  solution: Grid9;
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
export const ITEM_COOLDOWN_MS = 45_000;
export const ITEM_MAX_PER_GAME = 2;
