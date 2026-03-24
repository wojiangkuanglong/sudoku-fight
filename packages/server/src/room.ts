import {
  PUZZLES,
  cloneGrid,
  filledCount,
  isGiven,
  isSolved,
  isValidDigit,
  type Digit,
  type Grid9,
  type ItemType,
  type MoveRecord,
  type PuzzlePack,
  FREEZE_MS,
  ITEM_COOLDOWN_MS,
  ITEM_MAX_PER_GAME,
  ROW_BLIND_MS,
} from "@sudoku-fight/shared";

export type RoomPhase = "lobby" | "playing" | "done";

export interface PlayerState {
  name: string;
  grid: Grid9;
  history: MoveRecord[];
  ready: boolean;
  freezeUntil: number;
  rowBlindUntil: number[];
  itemUses: number;
  itemReadyAt: number;
}

export class Room {
  readonly id: string;
  phase: RoomPhase = "lobby";
  puzzle: PuzzlePack | null = null;
  winnerId: string | null = null;
  readonly players = new Map<string, PlayerState>();

  constructor(id: string) {
    this.id = id;
  }

  addPlayer(socketId: string, name: string): { ok: true } | { ok: false; reason: string } {
    if (this.players.size >= 2) return { ok: false, reason: "房间已满" };
    if (this.phase !== "lobby") return { ok: false, reason: "游戏已开始" };
    this.players.set(socketId, {
      name: name.trim() || "玩家",
      grid: emptyGrid(),
      history: [],
      ready: false,
      freezeUntil: 0,
      rowBlindUntil: Array.from({ length: 9 }, () => 0),
      itemUses: 0,
      itemReadyAt: 0,
    });
    return { ok: true };
  }

  removePlayer(socketId: string): void {
    this.players.delete(socketId);
  }

  setReady(socketId: string, ready: boolean): { ok: true } | { ok: false; reason: string } {
    const p = this.players.get(socketId);
    if (!p) return { ok: false, reason: "不在房间内" };
    if (this.phase !== "lobby") return { ok: false, reason: "无法变更准备状态" };
    p.ready = ready;
    return { ok: true };
  }

  tryStart(now: number): { started: boolean } {
    if (this.phase !== "lobby" || this.players.size !== 2) return { started: false };
    for (const p of this.players.values()) {
      if (!p.ready) return { started: false };
    }
    const pick = PUZZLES[Math.floor(Math.random() * PUZZLES.length)]!;
    this.puzzle = pick;
    this.phase = "playing";
    this.winnerId = null;
    for (const p of this.players.values()) {
      p.grid = cloneGrid(pick.givens);
      p.history = [];
      p.freezeUntil = 0;
      p.rowBlindUntil = Array.from({ length: 9 }, () => 0);
      p.itemUses = 0;
      p.itemReadyAt = now;
    }
    return { started: true };
  }

  opponentOf(socketId: string): string | undefined {
    for (const id of this.players.keys()) {
      if (id !== socketId) return id;
    }
    return undefined;
  }

  applyCell(
    socketId: string,
    row: number,
    col: number,
    value: number,
    now: number,
  ): { ok: true } | { ok: false; reason: string } {
    if (this.phase !== "playing" || !this.puzzle) return { ok: false, reason: "未在对局中" };
    const me = this.players.get(socketId);
    if (!me) return { ok: false, reason: "不在房间内" };
    if (now < me.freezeUntil) return { ok: false, reason: "你被冻结，暂时无法填数" };
    if (row < 0 || row > 8 || col < 0 || col > 8) return { ok: false, reason: "坐标无效" };
    if (!isValidDigit(value)) return { ok: false, reason: "数字无效" };
    const g = this.puzzle.givens;
    if (isGiven(g, row, col)) return { ok: false, reason: "不能修改题目给定格" };
    const before = me.grid[row]![col]!;
    const after = value as Digit;
    if (before === after) return { ok: true };
    me.grid[row]![col] = after;
    me.history.push({ row, col, before, after });
    if (isSolved(me.grid, this.puzzle.solution)) {
      this.phase = "done";
      this.winnerId = socketId;
    }
    return { ok: true };
  }

  applyItem(
    fromId: string,
    type: ItemType,
    row: number | undefined,
    now: number,
  ): { ok: true } | { ok: false; reason: string } {
    if (this.phase !== "playing" || !this.puzzle) return { ok: false, reason: "未在对局中" };
    const me = this.players.get(fromId);
    const victimId = this.opponentOf(fromId);
    if (!me || !victimId) return { ok: false, reason: "对手不存在" };
    if (me.itemUses >= ITEM_MAX_PER_GAME) return { ok: false, reason: "本局道具次数已用尽" };
    if (now < me.itemReadyAt) return { ok: false, reason: "道具冷却中" };

    const victim = this.players.get(victimId)!;

    if (type === "row_blind") {
      if (row === undefined || row < 0 || row > 8) return { ok: false, reason: "请指定有效行 0-8" };
      victim.rowBlindUntil[row] = Math.max(victim.rowBlindUntil[row]!, now + ROW_BLIND_MS);
    } else if (type === "undo_three") {
      let n = 0;
      while (n < 3 && victim.history.length > 0) {
        const rec = victim.history.pop()!;
        victim.grid[rec.row]![rec.col] = rec.before;
        n++;
      }
    } else if (type === "freeze") {
      victim.freezeUntil = Math.max(victim.freezeUntil, now + FREEZE_MS);
    } else {
      return { ok: false, reason: "未知道具" };
    }

    me.itemUses += 1;
    me.itemReadyAt = now + ITEM_COOLDOWN_MS;
    return { ok: true };
  }

  pruneEffects(now: number): void {
    for (const p of this.players.values()) {
      if (now >= p.freezeUntil) p.freezeUntil = 0;
      for (let r = 0; r < 9; r++) {
        if (now >= p.rowBlindUntil[r]!) p.rowBlindUntil[r] = 0;
      }
    }
  }
}

function emptyGrid(): Grid9 {
  return Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => 0 as Digit));
}

export function publicLobbyPlayers(room: Room): { id: string; name: string; ready: boolean }[] {
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
  if (!me || !room.puzzle) {
    return {
      phase: room.phase,
      roomId: room.id,
      you: me ? { id: myId, name: me.name } : { id: myId, name: "?" },
      givens: null as Grid9 | null,
      grid: null as Grid9 | null,
      frozenUntil: 0,
      rowBlindUntil: [] as number[],
      rivalName: opp?.name ?? "等待对手",
      rivalFilled: opp ? filledCount(opp.grid) : 0,
      winnerId: room.winnerId,
      winnerName: room.winnerId ? room.players.get(room.winnerId)?.name ?? null : null,
      itemUses: me?.itemUses ?? 0,
      itemReadyAt: me?.itemReadyAt ?? 0,
      itemMax: ITEM_MAX_PER_GAME,
      itemCooldownMs: ITEM_COOLDOWN_MS,
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
    rivalName: opp?.name ?? "对手",
    rivalFilled: opp ? filledCount(opp.grid) : 0,
    winnerId: room.winnerId,
    winnerName: room.winnerId ? room.players.get(room.winnerId)?.name ?? null : null,
    itemUses: me.itemUses,
    itemReadyAt: me.itemReadyAt,
    itemMax: ITEM_MAX_PER_GAME,
    itemCooldownMs: ITEM_COOLDOWN_MS,
  };
}
