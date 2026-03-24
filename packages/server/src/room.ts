import {
  CELL_LOCK_MS,
  COOLDOWN_SPIKE_MS,
  cloneGrid,
  type Difficulty,
  type Digit,
  FREEZE_MS,
  filledCount,
  type Grid9,
  generatePuzzlePack,
  ITEM_COOLDOWN_MS,
  ITEM_MAX_PER_GAME,
  type ItemType,
  isGiven,
  isSolved,
  isValidDigit,
  type MoveRecord,
  type PuzzlePack,
  ROW_BLIND_MS,
  SILENCE_MS,
} from "@sudoku-fight/shared";

export type RoomPhase = "lobby" | "playing" | "done";

export interface PlayerState {
  boxBlindUntil: number[];
  cellLockCol: number;
  /** 被锁定的格子，-1 表示无 */
  cellLockRow: number;
  cellLockUntil: number;
  colBlindUntil: number[];
  freezeUntil: number;
  grid: Grid9;
  history: MoveRecord[];
  itemReadyAt: number;
  itemUses: number;
  name: string;
  ready: boolean;
  rowBlindUntil: number[];
  /** 无法使用技能的截止时间 */
  silenceUntil: number;
}

export class Room {
  readonly id: string;
  phase: RoomPhase = "lobby";
  puzzle: PuzzlePack | null = null;
  winnerId: string | null = null;
  /** 本局开始时间（毫秒），对局中/结束后有效 */
  gameStartedAt: number | null = null;
  /** 有人提交正确终局的时间 */
  finishedAt: number | null = null;
  /** 结束后点击「再来一局」的玩家 socketId */
  readonly rematchAck = new Set<string>();
  readonly players = new Map<string, PlayerState>();
  /** 下一局开局用题难度（仅大厅可改） */
  lobbyDifficulty: Difficulty = "medium";

  constructor(id: string) {
    this.id = id;
  }

  addPlayer(
    socketId: string,
    name: string
  ): { ok: true } | { ok: false; reason: string } {
    if (this.players.size >= 2) {
      return { ok: false, reason: "房间已满" };
    }
    if (this.phase !== "lobby") {
      return { ok: false, reason: "游戏已开始" };
    }
    this.players.set(socketId, {
      name: name.trim() || "玩家",
      grid: emptyGrid(),
      history: [],
      ready: false,
      freezeUntil: 0,
      rowBlindUntil: Array.from({ length: 9 }, () => 0),
      colBlindUntil: Array.from({ length: 9 }, () => 0),
      boxBlindUntil: Array.from({ length: 9 }, () => 0),
      itemUses: 0,
      itemReadyAt: 0,
      silenceUntil: 0,
      cellLockRow: -1,
      cellLockCol: -1,
      cellLockUntil: 0,
    });
    return { ok: true };
  }

  removePlayer(socketId: string): void {
    this.players.delete(socketId);
  }

  setReady(
    socketId: string,
    ready: boolean
  ): { ok: true } | { ok: false; reason: string } {
    const p = this.players.get(socketId);
    if (!p) {
      return { ok: false, reason: "不在房间内" };
    }
    if (this.phase !== "lobby") {
      return { ok: false, reason: "无法变更准备状态" };
    }
    p.ready = ready;
    return { ok: true };
  }

  setLobbyDifficulty(
    socketId: string,
    difficulty: Difficulty
  ): { ok: true } | { ok: false; reason: string } {
    if (!this.players.has(socketId)) {
      return { ok: false, reason: "不在房间内" };
    }
    if (this.phase !== "lobby") {
      return { ok: false, reason: "对局进行中无法更改难度" };
    }
    if (
      difficulty !== "easy" &&
      difficulty !== "medium" &&
      difficulty !== "hard"
    ) {
      return { ok: false, reason: "难度无效" };
    }
    this.lobbyDifficulty = difficulty;
    for (const p of this.players.values()) {
      p.ready = false;
    }
    return { ok: true };
  }

  tryStart(now: number): { started: boolean } {
    if (this.phase !== "lobby" || this.players.size !== 2) {
      return { started: false };
    }
    for (const p of this.players.values()) {
      if (!p.ready) {
        return { started: false };
      }
    }
    const pick = generatePuzzlePack(this.lobbyDifficulty);
    this.puzzle = pick;
    this.phase = "playing";
    this.winnerId = null;
    this.gameStartedAt = now;
    this.finishedAt = null;
    this.rematchAck.clear();
    for (const p of this.players.values()) {
      p.grid = cloneGrid(pick.givens);
      p.history = [];
      p.freezeUntil = 0;
      p.rowBlindUntil = Array.from({ length: 9 }, () => 0);
      p.colBlindUntil = Array.from({ length: 9 }, () => 0);
      p.boxBlindUntil = Array.from({ length: 9 }, () => 0);
      p.itemUses = 0;
      p.itemReadyAt = now;
      p.silenceUntil = 0;
      p.cellLockRow = -1;
      p.cellLockCol = -1;
      p.cellLockUntil = 0;
    }
    return { started: true };
  }

  opponentOf(socketId: string): string | undefined {
    for (const id of this.players.keys()) {
      if (id !== socketId) {
        return id;
      }
    }
    return undefined;
  }

  applyCell(
    socketId: string,
    row: number,
    col: number,
    value: number,
    now: number
  ): { ok: true } | { ok: false; reason: string } {
    if (this.phase !== "playing" || !this.puzzle) {
      return { ok: false, reason: "未在对局中" };
    }
    const me = this.players.get(socketId);
    if (!me) {
      return { ok: false, reason: "不在房间内" };
    }
    if (now < me.freezeUntil) {
      return { ok: false, reason: "你被冻结，暂时无法填数" };
    }
    if (
      me.cellLockRow === row &&
      me.cellLockCol === col &&
      now < me.cellLockUntil
    ) {
      return { ok: false, reason: "该格被锁定，稍后再改" };
    }
    if (row < 0 || row > 8 || col < 0 || col > 8) {
      return { ok: false, reason: "坐标无效" };
    }
    if (!isValidDigit(value)) {
      return { ok: false, reason: "数字无效" };
    }
    const g = this.puzzle.givens;
    if (isGiven(g, row, col)) {
      return { ok: false, reason: "不能修改题目给定格" };
    }
    const before = me.grid[row]![col]!;
    const after = value as Digit;
    if (before === after) {
      return { ok: true };
    }
    me.grid[row]![col] = after;
    me.history.push({ row, col, before, after });
    if (isSolved(me.grid, this.puzzle.solution)) {
      this.phase = "done";
      this.winnerId = socketId;
      this.finishedAt = now;
    }
    return { ok: true };
  }

  applyItem(
    fromId: string,
    type: ItemType,
    _row: number | undefined,
    now: number
  ): { ok: true } | { ok: false; reason: string } {
    if (this.phase !== "playing" || !this.puzzle) {
      return { ok: false, reason: "未在对局中" };
    }
    const me = this.players.get(fromId);
    const victimId = this.opponentOf(fromId);
    if (!(me && victimId)) {
      return { ok: false, reason: "对手不存在" };
    }
    if (me.itemUses >= ITEM_MAX_PER_GAME) {
      return { ok: false, reason: "本局道具次数已用尽" };
    }
    if (now < me.itemReadyAt) {
      return { ok: false, reason: "道具冷却中" };
    }
    if (now < me.silenceUntil) {
      return { ok: false, reason: "沉默中，无法使用技能" };
    }

    const victim = this.players.get(victimId)!;
    const g = this.puzzle.givens;

    if (type === "area_blind") {
      const kind = Math.floor(Math.random() * 3);
      const idx = Math.floor(Math.random() * 9);
      if (kind === 0) {
        victim.rowBlindUntil[idx] = Math.max(
          victim.rowBlindUntil[idx]!,
          now + ROW_BLIND_MS
        );
      } else if (kind === 1) {
        victim.colBlindUntil[idx] = Math.max(
          victim.colBlindUntil[idx]!,
          now + ROW_BLIND_MS
        );
      } else {
        victim.boxBlindUntil[idx] = Math.max(
          victim.boxBlindUntil[idx]!,
          now + ROW_BLIND_MS
        );
      }
    } else if (type === "undo_three") {
      let n = 0;
      while (n < 3 && victim.history.length > 0) {
        const rec = victim.history.pop()!;
        victim.grid[rec.row]![rec.col] = rec.before;
        n++;
      }
    } else if (type === "freeze") {
      victim.freezeUntil = Math.max(victim.freezeUntil, now + FREEZE_MS);
    } else if (type === "eraser_one") {
      if (victim.history.length === 0) {
        return { ok: false, reason: "对手没有可擦除的手写" };
      }
      const rec = victim.history.pop()!;
      victim.grid[rec.row]![rec.col] = rec.before;
    } else if (type === "silence") {
      victim.silenceUntil = Math.max(victim.silenceUntil, now + SILENCE_MS);
    } else if (type === "lock_cell") {
      const candidates: [number, number][] = [];
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          if (isGiven(g, r, c)) {
            continue;
          }
          if (victim.grid[r]![c]! === 0) {
            continue;
          }
          candidates.push([r, c]);
        }
      }
      if (candidates.length === 0) {
        return { ok: false, reason: "对手没有可锁的手写格" };
      }
      const pick = candidates[Math.floor(Math.random() * candidates.length)]!;
      victim.cellLockRow = pick[0];
      victim.cellLockCol = pick[1];
      victim.cellLockUntil = now + CELL_LOCK_MS;
    } else if (type === "cooldown_hurt") {
      victim.itemReadyAt = Math.max(
        victim.itemReadyAt,
        now + COOLDOWN_SPIKE_MS
      );
    } else if (type === "bomb_digit") {
      const bombCandidates: [number, number][] = [];
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          if (isGiven(g, r, c)) {
            continue;
          }
          if (victim.grid[r]![c]! === 0) {
            continue;
          }
          bombCandidates.push([r, c]);
        }
      }
      if (bombCandidates.length === 0) {
        return { ok: false, reason: "对手没有可炸掉的手写数字" };
      }
      const bombPick =
        bombCandidates[Math.floor(Math.random() * bombCandidates.length)]!;
      const br = bombPick[0];
      const bc = bombPick[1];
      victim.grid[br]![bc] = 0 as Digit;
      victim.history = victim.history.filter(
        (rec) => rec.row !== br || rec.col !== bc
      );
    } else {
      return { ok: false, reason: "未知道具" };
    }

    me.itemUses += 1;
    me.itemReadyAt = now + ITEM_COOLDOWN_MS;
    return { ok: true };
  }

  pruneEffects(now: number): void {
    for (const p of this.players.values()) {
      if (now >= p.freezeUntil) {
        p.freezeUntil = 0;
      }
      if (now >= p.silenceUntil) {
        p.silenceUntil = 0;
      }
      if (p.cellLockRow >= 0 && now >= p.cellLockUntil) {
        p.cellLockRow = -1;
        p.cellLockCol = -1;
        p.cellLockUntil = 0;
      }
      for (let r = 0; r < 9; r++) {
        if (now >= p.rowBlindUntil[r]!) {
          p.rowBlindUntil[r] = 0;
        }
        if (now >= p.colBlindUntil[r]!) {
          p.colBlindUntil[r] = 0;
        }
        if (now >= p.boxBlindUntil[r]!) {
          p.boxBlindUntil[r] = 0;
        }
      }
    }
  }

  /** 双方确认后回到大厅，保留玩家，需重新准备 */
  resetToLobbyAfterMatch(): void {
    this.phase = "lobby";
    this.puzzle = null;
    this.winnerId = null;
    this.gameStartedAt = null;
    this.finishedAt = null;
    this.rematchAck.clear();
    for (const p of this.players.values()) {
      p.grid = emptyGrid();
      p.history = [];
      p.ready = false;
      p.freezeUntil = 0;
      p.rowBlindUntil = Array.from({ length: 9 }, () => 0);
      p.colBlindUntil = Array.from({ length: 9 }, () => 0);
      p.boxBlindUntil = Array.from({ length: 9 }, () => 0);
      p.itemUses = 0;
      p.itemReadyAt = 0;
      p.silenceUntil = 0;
      p.cellLockRow = -1;
      p.cellLockCol = -1;
      p.cellLockUntil = 0;
    }
  }

  voteRematch(socketId: string): { ok: true } | { ok: false; reason: string } {
    if (this.phase !== "done") {
      return { ok: false, reason: "只有本局结束后才能再来一局" };
    }
    if (!this.players.has(socketId)) {
      return { ok: false, reason: "不在房间内" };
    }
    this.rematchAck.add(socketId);
    if (this.rematchAck.size >= 2) {
      this.resetToLobbyAfterMatch();
    }
    return { ok: true };
  }
}

function emptyGrid(): Grid9 {
  return Array.from({ length: 9 }, () =>
    Array.from({ length: 9 }, () => 0 as Digit)
  );
}

export function publicLobbyPlayers(
  room: Room
): { id: string; name: string; ready: boolean }[] {
  return [...room.players.entries()].map(([id, p]) => ({
    id,
    name: p.name,
    ready: p.ready,
  }));
}

export function buildPersonalState(room: Room, myId: string, now: number) {
  room.pruneEffects(now);
  const me = room.players.get(myId);
  const oppId = room.opponentOf(myId);
  const opp = oppId ? room.players.get(oppId) : undefined;
  if (!(me && room.puzzle)) {
    return {
      phase: room.phase,
      roomId: room.id,
      you: me ? { id: myId, name: me.name } : { id: myId, name: "?" },
      givens: null as Grid9 | null,
      grid: null as Grid9 | null,
      frozenUntil: 0,
      rowBlindUntil: [] as number[],
      colBlindUntil: [] as number[],
      boxBlindUntil: [] as number[],
      rivalName: opp?.name ?? "等待对手",
      rivalFilled: opp ? filledCount(opp.grid) : 0,
      winnerId: room.winnerId,
      winnerName: room.winnerId
        ? (room.players.get(room.winnerId)?.name ?? null)
        : null,
      itemUses: me?.itemUses ?? 0,
      itemReadyAt: me?.itemReadyAt ?? 0,
      itemMax: ITEM_MAX_PER_GAME,
      itemCooldownMs: ITEM_COOLDOWN_MS,
      gameStartedAt: room.gameStartedAt,
      finishedAt: room.finishedAt,
      puzzleId: null as string | null,
      puzzleDifficulty: null as Difficulty | null,
      silenceUntil: me?.silenceUntil ?? 0,
      cellLocked:
        me && me.cellLockRow >= 0 && now < me.cellLockUntil
          ? {
              row: me.cellLockRow,
              col: me.cellLockCol,
              until: me.cellLockUntil,
            }
          : null,
      rematchVotes: [...room.rematchAck],
      lobbyDifficulty: room.lobbyDifficulty,
    };
  }

  return {
    phase: room.phase,
    roomId: room.id,
    you: { id: myId, name: me.name },
    givens: room.puzzle.givens,
    grid: me.grid,
    frozenUntil: me.freezeUntil,
    rowBlindUntil: [...me.rowBlindUntil],
    colBlindUntil: [...me.colBlindUntil],
    boxBlindUntil: [...me.boxBlindUntil],
    rivalName: opp?.name ?? "对手",
    rivalFilled: opp ? filledCount(opp.grid) : 0,
    winnerId: room.winnerId,
    winnerName: room.winnerId
      ? (room.players.get(room.winnerId)?.name ?? null)
      : null,
    itemUses: me.itemUses,
    itemReadyAt: me.itemReadyAt,
    itemMax: ITEM_MAX_PER_GAME,
    itemCooldownMs: ITEM_COOLDOWN_MS,
    gameStartedAt: room.gameStartedAt,
    finishedAt: room.finishedAt,
    puzzleId: room.puzzle.id,
    puzzleDifficulty: room.puzzle.difficulty,
    silenceUntil: me.silenceUntil,
    cellLocked:
      me.cellLockRow >= 0 && now < me.cellLockUntil
        ? { row: me.cellLockRow, col: me.cellLockCol, until: me.cellLockUntil }
        : null,
    rematchVotes: [...room.rematchAck],
    lobbyDifficulty: room.lobbyDifficulty,
  };
}
