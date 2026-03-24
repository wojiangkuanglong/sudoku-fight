import {
  allConflictKeys,
  type Difficulty,
  type Digit,
  filledCount,
  type Grid9,
  type ItemType,
} from "@sudoku-fight/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { SudokuBoardPixi } from "./game/SudokuBoardPixi.js";

const DEFAULT_SERVER_PORT = 3001;

/** 未设置 VITE_SERVER_URL 时：本机用 localhost；手机/局域网用当前页面主机名，避免连到设备自身的 localhost。 */
function socketServerUrl(): string {
  const fromEnv = import.meta.env.VITE_SERVER_URL;
  if (typeof fromEnv === "string" && fromEnv.trim()) {
    return fromEnv.trim();
  }
  const { protocol, hostname } = window.location;
  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    return `${protocol}//${hostname}:${DEFAULT_SERVER_PORT}`;
  }
  return `http://localhost:${DEFAULT_SERVER_PORT}`;
}

/** Clipboard API 仅在安全上下文可用；局域网 HTTP 下用隐藏 textarea + execCommand 兜底。 */
async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof window === "undefined") {
    return false;
  }
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* 继续走 execCommand */
    }
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText =
    "position:fixed;left:-9999px;top:0;opacity:0;font-size:12pt;";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } finally {
    document.body.removeChild(ta);
  }
  return ok;
}

type Phase = "lobby" | "playing" | "done";

interface LobbyPlayer {
  id: string;
  name: string;
  ready: boolean;
}

interface GameStatePayload {
  boxBlindUntil: number[];
  cellLocked: { row: number; col: number; until: number } | null;
  colBlindUntil: number[];
  finishedAt: number | null;
  frozenUntil: number;
  gameStartedAt: number | null;
  givens: Grid9 | null;
  grid: Grid9 | null;
  itemCooldownMs: number;
  itemMax: number;
  itemReadyAt: number;
  itemUses: number;
  /** 下一局将使用的难度（大厅内可选，对局/结算中仅展示） */
  lobbyDifficulty: Difficulty;
  phase: Phase;
  puzzleDifficulty: Difficulty | null;
  puzzleId: string | null;
  rematchVotes: string[];
  rivalFilled: number;
  rivalName: string;
  roomId: string;
  rowBlindUntil: number[];
  silenceUntil: number;
  winnerId: string | null;
  winnerName: string | null;
  you: { id: string; name: string };
}

const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: "简单",
  medium: "中等",
  hard: "困难",
};

const DIFFICULTY_OPTIONS: Difficulty[] = ["easy", "medium", "hard"];

type ThemeChoice = "dark" | "light";
const THEME_STORAGE_KEY = "sf-theme";

function noopSelectCell(_row: number, _col: number) {}

/** 手游风计时：始终 mm:ss */
function formatClock(ms: number): string {
  const clamped = ms < 0 ? 0 : ms;
  const s = Math.floor(clamped / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

const popoverDigitBtn =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-sf-divider bg-gradient-to-b from-sf-elevated to-sf-bg text-sm font-black text-sf-text shadow-md active:scale-95 sm:h-9 sm:w-9 sm:text-base";

const popoverClearBtn =
  "col-span-3 w-full min-w-0 justify-self-stretch mt-0.5 flex h-7 items-center justify-center rounded-lg border border-sf-accent/40 bg-sf-accent/12 px-2 text-[0.65rem] font-bold text-sf-accent active:brightness-110 sm:h-8 sm:text-xs";

/** 浮层约 sm:w-[8.5rem]，clamp 用半宽避免左右裁切 */
const POPOVER_HALF_REM = 4.25;

const SKILL_ROWS: {
  type: ItemType;
  icon: string;
  label: string;
  hint: string;
}[] = [
  {
    type: "area_blind",
    icon: "🌫️",
    label: "随机遮盖",
    hint: "随机遮挡对手一整行、一整列或一个宫格片刻",
  },
  { type: "undo_three", icon: "↩️", label: "三连擦", hint: "撤销对手最近三步" },
  { type: "freeze", icon: "❄️", label: "冰冻", hint: "对手短时间无法填数" },
  { type: "eraser_one", icon: "🧽", label: "单擦", hint: "撤销对手最近一步" },
  { type: "silence", icon: "🤐", label: "禁言", hint: "对手暂时无法施放技能" },
  { type: "lock_cell", icon: "🔒", label: "锁格", hint: "暂时锁住对手一格" },
  {
    type: "cooldown_hurt",
    icon: "⏳",
    label: "扰乱",
    hint: "拉长对手技能冷却",
  },
  {
    type: "bomb_digit",
    icon: "💣",
    label: "炸弹",
    hint: "随机清空对手一格手写数字",
  },
];

const skillDrawerRowBtn =
  "flex w-full items-center gap-3 rounded-2xl border border-sf-divider bg-sf-inset px-3 py-2.5 text-left shadow-sm active:scale-[0.99] disabled:pointer-events-none disabled:opacity-35";

const ctaPrimary =
  "flex min-h-14 w-full items-center justify-center rounded-2xl border border-teal-400/40 bg-gradient-to-r from-teal-400 via-cyan-500 to-teal-500 text-base font-black tracking-wide text-slate-950 shadow-[0_0_24px_rgba(45,212,191,0.35)] transition active:scale-[0.99] disabled:pointer-events-none disabled:opacity-40";

const ctaSecondary =
  "flex min-h-12 w-full items-center justify-center rounded-2xl border border-sf-divider bg-sf-chip text-sm font-bold text-sf-text backdrop-blur-sm transition active:scale-[0.99] disabled:pointer-events-none disabled:opacity-40";

export default function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [name, setName] = useState("");
  const [roomIdInput, setRoomIdInput] = useState("");
  const [roomId, setRoomId] = useState<string | null>(null);
  const [roster, setRoster] = useState<LobbyPlayer[]>([]);
  const [game, setGame] = useState<GameStatePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [copyHint, setCopyHint] = useState(false);
  const [selectedCell, setSelectedCell] = useState<{
    row: number;
    col: number;
  } | null>(null);
  const [skillDrawerOpen, setSkillDrawerOpen] = useState(false);
  const boardWrapRef = useRef<HTMLDivElement>(null);

  const [theme, setTheme] = useState<ThemeChoice>(() => {
    try {
      return localStorage.getItem(THEME_STORAGE_KEY) === "light"
        ? "light"
        : "dark";
    } catch {
      return "dark";
    }
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  useEffect(() => {
    const s = io(socketServerUrl(), { transports: ["websocket"] });
    setSocket(s);

    s.on("lobby:created", (p: { roomId: string }) => {
      setRoomId(p.roomId);
      setError(null);
    });
    s.on("lobby:joined", (p: { roomId: string }) => {
      setRoomId(p.roomId);
      setError(null);
    });
    s.on("lobby:roster", (p: { players: LobbyPlayer[] }) => {
      setRoster(p.players);
    });
    s.on("game:started", () => {
      setError(null);
      setSelectedCell(null);
      setSkillDrawerOpen(false);
    });
    s.on("game:state", (st: GameStatePayload) => {
      setGame(st);
    });
    s.on("app:error", (p: { message: string }) => {
      setError(p.message);
    });
    s.on("room:closed", () => {
      setRoomId(null);
      setRoster([]);
      setGame(null);
      setSelectedCell(null);
      setError("房间已解散（有玩家离开）");
    });

    return () => {
      s.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!error) {
      return;
    }
    const t = window.setTimeout(() => setError(null), 4800);
    return () => window.clearTimeout(t);
  }, [error]);

  useEffect(() => {
    if (!game || (game.phase !== "playing" && game.phase !== "done")) {
      return;
    }
    const id = window.setInterval(() => setTick((x) => x + 1), 250);
    return () => window.clearInterval(id);
  }, [game?.phase]);

  void tick;
  const now = Date.now();
  const myId = socket?.id ?? "";
  const selfReady = roster.find((p) => p.id === myId)?.ready ?? false;

  const frozen = Boolean(game && game.frozenUntil > now);
  const silenced = Boolean(game && game.silenceUntil > now);
  const blindRows =
    game?.rowBlindUntil?.map((until) => until > now) ??
    Array.from({ length: 9 }, () => false);
  const blindCols =
    game?.colBlindUntil?.map((until) => until > now) ??
    Array.from({ length: 9 }, () => false);
  const blindBoxes =
    game?.boxBlindUntil?.map((until) => until > now) ??
    Array.from({ length: 9 }, () => false);

  const lockedCellVisual =
    game?.cellLocked && now < game.cellLocked.until
      ? { row: game.cellLocked.row, col: game.cellLocked.col }
      : null;

  const isSelectedCellLocked = Boolean(
    selectedCell &&
      game?.cellLocked &&
      now < game.cellLocked.until &&
      selectedCell.row === game.cellLocked.row &&
      selectedCell.col === game.cellLocked.col
  );

  const conflictSet = useMemo(() => {
    if (!game?.grid) {
      return new Set<string>();
    }
    return allConflictKeys(game.grid);
  }, [game?.grid]);

  const createRoom = () => {
    setError(null);
    socket?.emit("lobby:create", { name });
  };
  const joinRoom = () => {
    setError(null);
    const code = roomIdInput.replace(/\D/g, "").slice(0, 6);
    if (code.length !== 6) {
      setError("请输入 6 位数字房间码");
      return;
    }
    socket?.emit("lobby:join", { roomId: code, name });
  };
  const toggleReady = () => {
    setError(null);
    socket?.emit("lobby:ready", { ready: !selfReady });
  };

  const copyRoomId = async () => {
    if (!roomId) {
      return;
    }
    const ok = await copyTextToClipboard(roomId);
    if (!ok) {
      setError("无法复制，请手动选中房间号");
      return;
    }
    setCopyHint(true);
    window.setTimeout(() => setCopyHint(false), 2000);
  };

  const onSelectCell = useCallback(
    (row: number, col: number) => {
      if (!game?.givens) {
        return;
      }
      if (game.givens[row]![col]! !== 0) {
        return;
      }
      if (frozen) {
        return;
      }
      if (
        game.cellLocked &&
        now < game.cellLocked.until &&
        game.cellLocked.row === row &&
        game.cellLocked.col === col
      ) {
        return;
      }
      setSelectedCell({ row, col });
    },
    [game?.givens, game?.cellLocked, frozen, now]
  );

  const applyDigit = useCallback(
    (value: Digit) => {
      if (!(selectedCell && socket && game?.givens)) {
        return;
      }
      if (game.givens[selectedCell.row]![selectedCell.col]! !== 0) {
        return;
      }
      if (
        game.cellLocked &&
        now < game.cellLocked.until &&
        selectedCell.row === game.cellLocked.row &&
        selectedCell.col === game.cellLocked.col
      ) {
        return;
      }
      socket.emit("game:cell", {
        row: selectedCell.row,
        col: selectedCell.col,
        value,
      });
      setSelectedCell(null);
    },
    [selectedCell, socket, game?.givens, game?.cellLocked, now]
  );

  const canUseItem =
    game &&
    game.phase === "playing" &&
    game.itemUses < game.itemMax &&
    now >= game.itemReadyAt;

  const canCastSkill = Boolean(canUseItem && !silenced);

  const cooldownLeftSec =
    game && now < game.itemReadyAt
      ? Math.ceil((game.itemReadyAt - now) / 1000)
      : 0;

  const cooldownProgress =
    game && cooldownLeftSec > 0
      ? Math.max(0, 1 - (game.itemReadyAt - now) / game.itemCooldownMs)
      : 0;

  const sendGameItem = useCallback(
    (type: ItemType, row?: number) => {
      setError(null);
      socket?.emit("game:item", { type, row });
    },
    [socket]
  );

  const requestRematch = () => {
    setError(null);
    socket?.emit("lobby:rematch");
  };

  const inLobby =
    Boolean(roomId) && game?.phase !== "playing" && game?.phase !== "done";
  const playing = game?.phase === "playing";
  const done = game?.phase === "done";

  useEffect(() => {
    if (!(playing && selectedCell) || frozen) {
      return;
    }
    const wrap = boardWrapRef.current;
    if (!wrap) {
      return;
    }

    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (wrap.contains(t)) {
        return;
      }
      setSelectedCell(null);
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [playing, selectedCell, frozen]);

  useEffect(() => {
    if (!(selectedCell && game?.cellLocked)) {
      return;
    }
    const t = Date.now();
    if (
      t < game.cellLocked.until &&
      selectedCell.row === game.cellLocked.row &&
      selectedCell.col === game.cellLocked.col
    ) {
      setSelectedCell(null);
    }
  }, [selectedCell, game?.cellLocked, tick]);

  const elapsedMs =
    playing && game?.gameStartedAt ? now - game.gameStartedAt : 0;
  const resultMs =
    done && game?.finishedAt && game.gameStartedAt
      ? game.finishedAt - game.gameStartedAt
      : null;

  const selfFilled = game?.grid ? filledCount(game.grid) : 0;
  const rematchMine = Boolean(game?.rematchVotes.includes(game.you.id));
  const rematchPartner =
    game?.rematchVotes.some((id) => id !== game.you.id) ?? false;

  const skillsRemaining = game ? Math.max(0, game.itemMax - game.itemUses) : 0;

  const popoverPlacementBelow = selectedCell !== null && selectedCell.row < 2;
  const popoverCenterXPct =
    selectedCell === null ? 0 : ((selectedCell.col + 0.5) / 9) * 100;

  useEffect(() => {
    if (!playing) {
      setSkillDrawerOpen(false);
    }
  }, [playing]);

  const boardScheme = theme === "light" ? "light" : "dark";

  return (
    <>
      <div aria-hidden className="sf-page-deco">
        <div className="sf-page-deco__grid" />
        <div className="sf-page-deco__orb sf-page-deco__orb--a" />
        <div className="sf-page-deco__orb sf-page-deco__orb--b" />
        <div className="sf-page-deco__badge" />
      </div>
      <div className="sf-app-shell flex min-h-0 min-w-0 flex-1 flex-col">
        {/* 顶栏：品牌 + 主题 + 在线状态 */}
        <header className="mb-2 flex shrink-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="sf-glow-ring flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sf-accent to-teal-600 font-black text-lg text-slate-950 shadow-lg">
              9
            </div>
            <div className="min-w-0">
              <h1 className="truncate font-black text-[1.15rem] text-sf-text tracking-tight sm:text-xl">
                数独对决
              </h1>
              <p className="font-semibold text-[0.6rem] text-sf-muted uppercase tracking-[0.22em]">
                Battle
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              aria-label={theme === "dark" ? "切换浅色模式" : "切换深色模式"}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-sf-divider bg-sf-inset text-base shadow-sm transition active:scale-95"
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              title={theme === "dark" ? "切换浅色模式" : "切换深色模式"}
              type="button"
            >
              {theme === "dark" ? "☀️" : "🌙"}
            </button>
            <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-sf-divider bg-sf-inset px-2.5 py-1.5 backdrop-blur-md">
              <span
                className={`h-2 w-2 rounded-full ${socket ? "bg-emerald-400 shadow-[0_0_10px_#34d399]" : "bg-sf-muted"}`}
              />
              <span className="font-bold text-[0.65rem] text-sf-muted">
                {socket ? "在线" : "连接中"}
              </span>
            </div>
          </div>
        </header>

        {error && (
          <div
            className="sf-error-toast fixed top-[max(5.5rem,env(safe-area-inset-top)+3.5rem)] left-1/2 z-60 max-w-[min(92vw,22rem)] -translate-x-1/2 px-4 py-2.5"
            role="status"
          >
            {error}
          </div>
        )}

        <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-2">
          {/* 登录 / 开房 */}
          {!roomId && (
            <section className="sf-glass sf-glow-ring relative overflow-hidden rounded-3xl p-5">
              <div className="pointer-events-none absolute -top-8 -right-8 h-32 w-32 rounded-full bg-sf-magic/20 blur-3xl" />
              <div className="pointer-events-none absolute -bottom-10 -left-10 h-36 w-36 rounded-full bg-sf-accent/10 blur-3xl" />
              <p className="mb-1 font-bold text-[0.65rem] text-sf-accent uppercase tracking-[0.2em]">
                对战大厅
              </p>
              <h2 className="mb-4 font-black text-2xl text-sf-text">
                开始匹配
              </h2>
              <label className="mb-4 block font-bold text-sf-muted text-xs">
                玩家昵称
                <input
                  className="mt-1.5 min-h-12 w-full rounded-2xl border border-sf-divider bg-sf-inset px-4 font-semibold text-base text-sf-text outline-none ring-sf-accent/30 placeholder:text-sf-placeholder focus:ring-2"
                  onChange={(e) => setName(e.target.value)}
                  placeholder="输入昵称"
                  type="text"
                  value={name}
                />
              </label>
              <div className="flex flex-col gap-3">
                <button
                  className={ctaPrimary}
                  disabled={!socket}
                  onClick={createRoom}
                  type="button"
                >
                  创建房间
                </button>
                <div className="flex gap-2">
                  <input
                    autoComplete="off"
                    className="min-h-12 min-w-0 flex-1 rounded-2xl border border-sf-divider bg-sf-inset px-3 text-center font-bold font-mono text-base text-sf-text tracking-[0.2em] outline-none ring-sf-magic/30 focus:ring-2"
                    inputMode="numeric"
                    maxLength={6}
                    onChange={(e) =>
                      setRoomIdInput(
                        e.target.value.replace(/\D/g, "").slice(0, 6)
                      )
                    }
                    placeholder="6 位数字"
                    type="text"
                    value={roomIdInput}
                  />
                  <button
                    className={`${ctaSecondary} max-w-[6.5rem] shrink-0 px-2`}
                    disabled={!socket}
                    onClick={joinRoom}
                    type="button"
                  >
                    加入
                  </button>
                </div>
              </div>
            </section>
          )}

          {roomId && (game === null || game.phase === "lobby") && (
            <section className="sf-glass rounded-3xl p-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="font-bold text-[0.6rem] text-sf-muted uppercase tracking-widest">
                    房间码
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="sf-text-glow font-black font-mono text-2xl text-sf-accent tracking-[0.2em]">
                      {roomId}
                    </span>
                    <button
                      className="rounded-full border border-sf-divider bg-sf-chip px-3 py-1 font-bold text-[0.65rem] text-sf-muted active:opacity-80"
                      onClick={() => void copyRoomId()}
                      type="button"
                    >
                      {copyHint ? "已复制" : "复制"}
                    </button>
                  </div>
                </div>
                {game && (
                  <div className="text-right">
                    <p className="font-bold text-[0.6rem] text-sf-muted">
                      当前身份
                    </p>
                    <p className="max-w-[9rem] truncate font-black text-sf-text text-sm">
                      {game.you.name}
                    </p>
                  </div>
                )}
              </div>

              <div className="mt-4">
                <p className="mb-1.5 text-center font-bold text-[0.65rem] text-sf-muted uppercase tracking-widest">
                  本局难度
                </p>
                <div className="flex gap-2">
                  {DIFFICULTY_OPTIONS.map((d) => (
                    <button
                      className={`min-h-11 flex-1 rounded-xl border px-1 py-2 font-black text-xs transition sm:text-sm ${
                        game && game.lobbyDifficulty === d
                          ? "border-sf-accent/60 bg-sf-accent/20 text-sf-accent"
                          : "border-sf-divider bg-sf-inset text-sf-muted disabled:opacity-40"
                      }`}
                      disabled={!(socket && game)}
                      key={d}
                      onClick={() => {
                        setError(null);
                        socket?.emit("lobby:difficulty", { difficulty: d });
                      }}
                      type="button"
                    >
                      {DIFFICULTY_LABEL[d]}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-center text-[0.6rem] text-sf-muted leading-relaxed">
                  开战前任选；切换难度会取消双方准备
                </p>
              </div>

              {inLobby && (
                <div className="mt-5 space-y-4">
                  <p className="text-center font-bold text-[0.65rem] text-sf-muted uppercase tracking-widest">
                    玩家席位
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {[0, 1].map((i) => {
                      const p = roster[i];
                      return (
                        <div
                          className="flex flex-col items-center rounded-2xl border border-sf-divider bg-sf-inset p-3"
                          key={p?.id ?? `slot-${i}`}
                        >
                          <div className="mb-2 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-sf-accent/25 to-sf-magic/20 font-black text-2xl text-sf-text ring-2 ring-sf-divider">
                            {p ? p.name.slice(0, 1) : "?"}
                          </div>
                          <p className="w-full truncate text-center font-bold text-sf-text text-sm">
                            {p?.name ?? "等待加入…"}
                          </p>
                          <p
                            className={`mt-1 font-bold text-[0.65rem] ${p?.ready ? "text-sf-accent" : "text-sf-muted"}`}
                          >
                            {p ? (p.ready ? "已准备" : "未准备") : "空位"}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                  <button
                    className={ctaPrimary}
                    disabled={!socket}
                    onClick={toggleReady}
                    type="button"
                  >
                    {selfReady ? "取消准备" : "准备开战"}
                  </button>
                </div>
              )}
            </section>
          )}

          {playing && game?.grid && game.givens && (
            <>
              {frozen && (
                <div className="sf-banner-frozen">
                  <span aria-hidden className="text-xl">
                    ❄️
                  </span>
                  <p className="font-bold text-sm">冰冻中！暂时无法填数</p>
                </div>
              )}
              {silenced && (
                <div className="sf-banner-silence">
                  <span aria-hidden className="text-xl">
                    🤐
                  </span>
                  <p className="font-bold text-sm">
                    禁言中！本段时间无法使用干扰技能
                  </p>
                </div>
              )}

              <div className="sf-glass flex flex-col gap-2 rounded-3xl p-3 sm:p-4">
                <div className="flex gap-2">
                  <div className="sf-glow-ring flex flex-1 flex-col rounded-2xl border border-sf-divider bg-sf-inset px-3 py-2">
                    <span className="font-black text-[0.55rem] text-sf-muted uppercase tracking-[0.2em]">
                      对局时间
                    </span>
                    <span className="sf-text-glow font-black font-mono text-2xl text-sf-accent tabular-nums">
                      {formatClock(elapsedMs)}
                    </span>
                  </div>
                  <div className="flex flex-1 flex-col justify-center rounded-2xl border border-sf-divider bg-sf-inset px-3 py-2">
                    <span className="font-black text-[0.55rem] text-sf-muted uppercase tracking-[0.2em]">
                      对手
                    </span>
                    <span className="truncate font-black text-sf-text text-sm">
                      {game.rivalName}
                    </span>
                    <span className="font-bold text-[0.65rem] text-sf-magic">
                      {game.rivalFilled} 格
                    </span>
                  </div>
                  <div className="flex w-[4.25rem] flex-col items-center justify-center rounded-2xl border border-sf-gold/30 bg-sf-inset py-1">
                    <span className="font-black text-[0.5rem] text-sf-muted">
                      技能
                    </span>
                    <span className="font-black text-2xl text-sf-gold">
                      {skillsRemaining}
                    </span>
                  </div>
                </div>
                {game.puzzleId && (
                  <p className="text-center font-bold text-[0.6rem] text-sf-muted">
                    关卡{" "}
                    <span className="font-mono text-sf-text">
                      {game.puzzleId}
                    </span>
                    {game.puzzleDifficulty && (
                      <>
                        {" "}
                        · 难度{" "}
                        <span className="text-sf-gold">
                          {DIFFICULTY_LABEL[game.puzzleDifficulty]}
                        </span>
                      </>
                    )}{" "}
                    · 已填 <span className="text-sf-accent">{selfFilled}</span>
                    /81
                  </p>
                )}
                <p className="text-center text-[0.6rem] text-sf-muted leading-relaxed">
                  点可选格子弹出数字板；点空白外区域关闭。重复数字标红，终局须与标解一致。
                </p>
                <div
                  className="relative mx-auto w-full max-w-[min(100%,24rem)] touch-none"
                  ref={boardWrapRef}
                >
                  <SudokuBoardPixi
                    blindBoxes={blindBoxes}
                    blindCols={blindCols}
                    blindRows={blindRows}
                    colorScheme={boardScheme}
                    conflicts={conflictSet}
                    givens={game.givens}
                    grid={game.grid}
                    interactive={!frozen}
                    lockedCell={lockedCellVisual}
                    onSelectCell={onSelectCell}
                    readOnly={false}
                    selected={selectedCell}
                  />
                  {selectedCell && !frozen && !isSelectedCellLocked && (
                    <div
                      aria-label="填入数字"
                      className="pointer-events-auto absolute z-20 w-[7.6rem] max-w-[calc(100%-8px)] rounded-2xl border border-sf-accent/40 bg-sf-popover p-2 shadow-lg backdrop-blur-md sm:w-[8.5rem]"
                      onPointerDown={(e) => e.stopPropagation()}
                      role="dialog"
                      style={{
                        left: `clamp(${POPOVER_HALF_REM}rem, ${popoverCenterXPct}%, calc(100% - ${POPOVER_HALF_REM}rem))`,
                        top: `${((selectedCell.row + 0.5) / 9) * 100}%`,
                        transform: popoverPlacementBelow
                          ? "translate(-50%, 10px)"
                          : "translate(-50%, calc(-100% - 10px))",
                      }}
                    >
                      <div className="mb-1 text-center font-bold text-[0.55rem] text-sf-muted">
                        填入
                      </div>
                      <div className="grid grid-cols-3 justify-items-center gap-1">
                        {([1, 2, 3, 4, 5, 6, 7, 8, 9] as const).map((n) => (
                          <button
                            className={popoverDigitBtn}
                            key={n}
                            onClick={() => applyDigit(n as Digit)}
                            type="button"
                          >
                            {n}
                          </button>
                        ))}
                        <button
                          className={popoverClearBtn}
                          onClick={() => applyDigit(0 as Digit)}
                          type="button"
                        >
                          清除
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {done && game?.grid && game.givens && (
            <>
              <section className="sf-glass relative overflow-hidden rounded-3xl p-5 text-center">
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-sf-gold/10 to-transparent" />
                <p className="relative mb-1 font-black text-[0.65rem] text-sf-gold uppercase tracking-[0.25em]">
                  本局结果
                </p>
                <p className="relative font-black text-2xl text-sf-text sm:text-3xl">
                  {game.winnerId === game.you.id ? (
                    <span className="bg-gradient-to-r from-sf-gold via-amber-200 to-sf-gold bg-clip-text text-transparent">
                      胜利
                    </span>
                  ) : (
                    <span className="text-sf-muted">败北</span>
                  )}
                </p>
                <p className="relative mt-1 font-bold text-sf-muted text-sm">
                  {game.winnerId === game.you.id
                    ? "干得漂亮！"
                    : `胜者：${game.winnerName ?? "对手"}`}
                </p>
                {resultMs !== null && (
                  <p className="relative mt-3 font-black font-mono text-lg text-sf-accent">
                    {formatClock(resultMs)}
                  </p>
                )}
                {game.puzzleId && (
                  <p className="relative mt-1 text-[0.65rem] text-sf-muted">
                    关卡{" "}
                    <span className="font-mono text-sf-text">
                      {game.puzzleId}
                    </span>
                    {game.puzzleDifficulty && (
                      <> · {DIFFICULTY_LABEL[game.puzzleDifficulty]}</>
                    )}
                  </p>
                )}
                <div className="relative mt-4">
                  <SudokuBoardPixi
                    blindBoxes={Array.from({ length: 9 }, () => false)}
                    blindCols={Array.from({ length: 9 }, () => false)}
                    blindRows={Array.from({ length: 9 }, () => false)}
                    colorScheme={boardScheme}
                    conflicts={conflictSet}
                    givens={game.givens}
                    grid={game.grid}
                    interactive={false}
                    lockedCell={null}
                    onSelectCell={noopSelectCell}
                    readOnly
                    selected={null}
                  />
                </div>
              </section>
              <section className="sf-glass rounded-3xl p-4">
                <p className="mb-3 text-center font-bold text-[0.65rem] text-sf-muted">
                  双方各点一次「再战」返回大厅
                </p>
                <button
                  className={ctaPrimary}
                  disabled={!socket}
                  onClick={requestRematch}
                  type="button"
                >
                  {rematchMine ? "已就绪 · 等对手" : "再战一局"}
                </button>
                {rematchPartner && !rematchMine && (
                  <p className="mt-2 text-center font-bold text-sf-accent text-xs">
                    对手已确认
                  </p>
                )}
              </section>
            </>
          )}

          {roomId &&
            !playing &&
            !done &&
            game?.phase === "lobby" &&
            roster.length === 2 && (
              <p className="text-center font-bold text-[0.65rem] text-sf-muted">
                双方准备后立即开局
              </p>
            )}
        </main>

        {/* 技能抽屉：对局中从底部展开，新技能只改 SKILL_ROWS 即可 */}
        {playing && game?.grid && game.givens && skillDrawerOpen && (
          <>
            <button
              aria-label="关闭技能面板"
              className="fixed inset-0 z-40 bg-sf-overlay backdrop-blur-[2px]"
              onClick={() => setSkillDrawerOpen(false)}
              type="button"
            />
            <div
              aria-label="干扰技能"
              className="fixed inset-x-0 bottom-0 z-50 flex max-h-[min(72vh,28rem)] flex-col rounded-t-3xl border border-sf-divider border-b-0 bg-sf-drawer pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-12px_40px_rgba(0,0,0,0.18)] backdrop-blur-xl"
              role="dialog"
            >
              <div className="flex shrink-0 items-center justify-between gap-2 border-sf-divider border-b px-4 py-3">
                <div>
                  <p className="font-black text-[0.6rem] text-sf-muted uppercase tracking-wider">
                    干扰技能
                  </p>
                  <p className="font-bold text-sf-text text-xs">
                    剩余 <span className="text-sf-gold">{skillsRemaining}</span>
                    /{game.itemMax}
                    {silenced && (
                      <span className="ml-2 text-amber-300">· 禁言中</span>
                    )}
                  </p>
                </div>
                <button
                  className="rounded-full border border-sf-divider bg-sf-chip px-3 py-1.5 font-bold text-sf-muted text-xs active:opacity-80"
                  onClick={() => setSkillDrawerOpen(false)}
                  type="button"
                >
                  收起
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
                {cooldownLeftSec > 0 && (
                  <div className="mb-3">
                    <div className="mb-1 flex items-center justify-between font-bold text-[0.65rem] text-sf-warn-text">
                      <span>技能冷却</span>
                      <span>{cooldownLeftSec}s</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-sf-muted/25">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-sf-accent to-cyan-300 transition-[width] duration-200"
                        style={{
                          width: `${Math.min(100, cooldownProgress * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
                <p className="mb-2 font-bold text-[0.55rem] text-sf-muted/90 uppercase tracking-wider">
                  技能列表
                </p>
                <ul className="flex flex-col gap-2">
                  {SKILL_ROWS.map((s) => (
                    <li key={s.type}>
                      <button
                        className={skillDrawerRowBtn}
                        disabled={!canCastSkill}
                        onClick={() => {
                          sendGameItem(s.type);
                          setSkillDrawerOpen(false);
                        }}
                        type="button"
                      >
                        <span aria-hidden className="text-2xl leading-none">
                          {s.icon}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-black text-sf-text text-sm">
                            {s.label}
                          </span>
                          <span className="mt-0.5 block font-semibold text-[0.65rem] text-sf-muted leading-snug">
                            {s.hint}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </>
        )}

        {playing && game?.grid && game.givens && (
          <footer className="relative z-30 w-full shrink-0 border-sf-divider border-t bg-sf-footer px-3 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_28px_rgba(0,0,0,0.12)] backdrop-blur-2xl">
            <button
              className="flex w-full items-center justify-between gap-3 rounded-2xl border border-sf-magic/25 bg-gradient-to-r from-sf-magic/12 to-sf-accent/10 px-3 py-2.5 text-left active:brightness-110"
              onClick={() => setSkillDrawerOpen(true)}
              type="button"
            >
              <div className="min-w-0">
                <p className="font-black text-[0.55rem] text-sf-muted uppercase tracking-wider">
                  干扰技能
                </p>
                <p className="truncate font-bold text-sf-text text-sm">
                  {cooldownLeftSec > 0
                    ? `冷却中 ${cooldownLeftSec}s`
                    : silenced
                      ? "禁言中 · 无法施放"
                      : canUseItem
                        ? "点按打开技能库"
                        : "本局次数已用尽"}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-0.5">
                <span className="rounded-full border border-sf-gold/35 bg-sf-gold/10 px-2 py-0.5 font-black text-[0.65rem] text-sf-gold">
                  {skillsRemaining}/{game.itemMax}
                </span>
                <span aria-hidden className="font-black text-lg text-sf-muted">
                  ⌄
                </span>
              </div>
            </button>
          </footer>
        )}
      </div>
    </>
  );
}
