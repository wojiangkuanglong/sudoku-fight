import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import {
  allConflictKeys,
  filledCount,
  type Digit,
  type Grid9,
} from "@sudoku-fight/shared";
import { SudokuBoardPixi } from "./game/SudokuBoardPixi.js";

const SERVER =
  typeof import.meta.env.VITE_SERVER_URL === "string" && import.meta.env.VITE_SERVER_URL
    ? import.meta.env.VITE_SERVER_URL
    : "http://localhost:3001";

type Phase = "lobby" | "playing" | "done";

interface LobbyPlayer {
  id: string;
  name: string;
  ready: boolean;
}

interface GameStatePayload {
  phase: Phase;
  roomId: string;
  you: { id: string; name: string };
  givens: Grid9 | null;
  grid: Grid9 | null;
  frozenUntil: number;
  rowBlindUntil: number[];
  rivalName: string;
  rivalFilled: number;
  winnerId: string | null;
  winnerName: string | null;
  itemUses: number;
  itemReadyAt: number;
  itemMax: number;
  itemCooldownMs: number;
  gameStartedAt: number | null;
  finishedAt: number | null;
  puzzleId: string | null;
  rematchVotes: string[];
}

function noopSelectCell(_row: number, _col: number) {}

/** 手游风计时：始终 mm:ss */
function formatClock(ms: number): string {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

const popoverDigitBtn =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-gradient-to-b from-zinc-600 to-zinc-900 text-sm font-black text-white shadow-md active:scale-95 sm:h-9 sm:w-9 sm:text-base";

const popoverClearBtn =
  "col-span-3 mt-0.5 flex h-7 items-center justify-center rounded-lg border border-emerald-500/40 bg-emerald-900/50 text-[0.65rem] font-bold text-emerald-200 active:brightness-110 sm:h-8 sm:text-xs";

const skillBtn =
  "flex min-h-[3.25rem] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl border border-white/10 bg-gradient-to-b from-violet-600/50 to-indigo-950/80 px-1 py-2 text-[0.65rem] font-bold leading-tight text-white shadow-md active:scale-[0.98] disabled:pointer-events-none disabled:opacity-35 sm:text-xs";

const ctaPrimary =
  "flex min-h-14 w-full items-center justify-center rounded-2xl border border-teal-400/40 bg-gradient-to-r from-teal-400 via-cyan-500 to-teal-500 text-base font-black tracking-wide text-slate-950 shadow-[0_0_24px_rgba(45,212,191,0.35)] transition active:scale-[0.99] disabled:pointer-events-none disabled:opacity-40";

const ctaSecondary =
  "flex min-h-12 w-full items-center justify-center rounded-2xl border border-white/15 bg-white/5 text-sm font-bold text-white backdrop-blur-sm transition active:scale-[0.99] disabled:pointer-events-none disabled:opacity-40";

export default function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [name, setName] = useState("");
  const [roomIdInput, setRoomIdInput] = useState("");
  const [roomId, setRoomId] = useState<string | null>(null);
  const [roster, setRoster] = useState<LobbyPlayer[]>([]);
  const [game, setGame] = useState<GameStatePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [blindRow, setBlindRow] = useState(0);
  const [copyHint, setCopyHint] = useState(false);
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null);
  const boardWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const s = io(SERVER, { transports: ["websocket"] });
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
    if (!error) return;
    const t = window.setTimeout(() => setError(null), 4800);
    return () => window.clearTimeout(t);
  }, [error]);

  useEffect(() => {
    if (!game || (game.phase !== "playing" && game.phase !== "done")) return;
    const id = window.setInterval(() => setTick((x) => x + 1), 250);
    return () => window.clearInterval(id);
  }, [game?.phase]);

  void tick;
  const now = Date.now();
  const myId = socket?.id ?? "";
  const selfReady = roster.find((p) => p.id === myId)?.ready ?? false;

  const frozen = Boolean(game && game.frozenUntil > now);
  const blindRows =
    game?.rowBlindUntil.map((until) => until > now) ?? Array.from({ length: 9 }, () => false);

  const conflictSet = useMemo(() => {
    if (!game?.grid) return new Set<string>();
    return allConflictKeys(game.grid);
  }, [game?.grid]);

  const createRoom = () => {
    setError(null);
    socket?.emit("lobby:create", { name });
  };
  const joinRoom = () => {
    setError(null);
    socket?.emit("lobby:join", { roomId: roomIdInput.trim(), name });
  };
  const toggleReady = () => {
    setError(null);
    socket?.emit("lobby:ready", { ready: !selfReady });
  };

  const copyRoomId = async () => {
    if (!roomId) return;
    try {
      await navigator.clipboard.writeText(roomId);
      setCopyHint(true);
      window.setTimeout(() => setCopyHint(false), 2000);
    } catch {
      setError("无法复制，请手动选中房间号");
    }
  };

  const onSelectCell = useCallback(
    (row: number, col: number) => {
      if (!game?.givens) return;
      if (game.givens[row]![col]! !== 0) return;
      if (frozen) return;
      setSelectedCell({ row, col });
    },
    [game?.givens, frozen],
  );

  const applyDigit = useCallback(
    (value: Digit) => {
      if (!selectedCell || !socket || !game?.givens) return;
      if (game.givens[selectedCell.row]![selectedCell.col]! !== 0) return;
      socket.emit("game:cell", {
        row: selectedCell.row,
        col: selectedCell.col,
        value,
      });
      setSelectedCell(null);
    },
    [selectedCell, socket, game?.givens],
  );

  const canUseItem =
    game &&
    game.phase === "playing" &&
    game.itemUses < game.itemMax &&
    now >= game.itemReadyAt;

  const cooldownLeftSec =
    game && now < game.itemReadyAt ? Math.ceil((game.itemReadyAt - now) / 1000) : 0;

  const cooldownProgress =
    game && cooldownLeftSec > 0
      ? Math.max(0, 1 - (game.itemReadyAt - now) / game.itemCooldownMs)
      : 0;

  const useItem = useCallback(
    (type: "row_blind" | "undo_three" | "freeze", row?: number) => {
      setError(null);
      socket?.emit("game:item", { type, row });
    },
    [socket],
  );

  const requestRematch = () => {
    setError(null);
    socket?.emit("lobby:rematch");
  };

  const inLobby = Boolean(roomId) && game?.phase !== "playing" && game?.phase !== "done";
  const playing = game?.phase === "playing";
  const done = game?.phase === "done";

  useEffect(() => {
    if (!playing || !selectedCell || frozen) return;
    const wrap = boardWrapRef.current;
    if (!wrap) return;

    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (wrap.contains(t)) return;
      setSelectedCell(null);
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [playing, selectedCell, frozen]);

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

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* 顶栏：品牌 + 在线状态 */}
      <header className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="sf-glow-ring flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sf-accent to-teal-600 text-lg font-black text-slate-950 shadow-lg">
            9
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-[1.15rem] font-black tracking-tight text-white sm:text-xl">
              数独对决
            </h1>
            <p className="text-[0.6rem] font-semibold uppercase tracking-[0.22em] text-sf-muted">
              Battle
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-black/40 px-2.5 py-1.5 backdrop-blur-md">
          <span
            className={`h-2 w-2 rounded-full ${socket ? "bg-emerald-400 shadow-[0_0_10px_#34d399]" : "bg-zinc-600"}`}
          />
          <span className="text-[0.65rem] font-bold text-sf-muted">{socket ? "在线" : "连接中"}</span>
        </div>
      </header>

      {error && (
        <div
          className="fixed left-1/2 top-[max(5.5rem,env(safe-area-inset-top)+3.5rem)] z-60 max-w-[min(92vw,22rem)] -translate-x-1/2 rounded-xl border-2 border-sf-danger/60 bg-slate-950/95 px-4 py-2.5 text-center text-xs font-bold text-sf-danger shadow-[0_0_24px_rgba(251,113,133,0.25)] backdrop-blur-md"
          role="status"
        >
          {error}
        </div>
      )}

      <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-2">
        {/* 登录 / 开房 */}
        {!roomId && (
          <section className="sf-glass sf-glow-ring relative overflow-hidden rounded-3xl p-5">
            <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-sf-magic/20 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-10 -left-10 h-36 w-36 rounded-full bg-sf-accent/10 blur-3xl" />
            <p className="mb-1 text-[0.65rem] font-bold uppercase tracking-[0.2em] text-sf-accent">对战大厅</p>
            <h2 className="mb-4 text-2xl font-black text-white">开始匹配</h2>
            <label className="mb-4 block text-xs font-bold text-sf-muted">
              玩家昵称
              <input
                className="mt-1.5 min-h-12 w-full rounded-2xl border border-white/10 bg-black/40 px-4 text-base font-semibold text-white outline-none ring-sf-accent/30 placeholder:text-zinc-600 focus:ring-2"
                type="text"
                placeholder="输入昵称"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <div className="flex flex-col gap-3">
              <button type="button" className={ctaPrimary} onClick={createRoom} disabled={!socket}>
                创建房间
              </button>
              <div className="flex gap-2">
                <input
                  className="min-h-12 min-w-0 flex-1 rounded-2xl border border-white/10 bg-black/40 px-3 text-center font-mono text-base font-bold tracking-widest text-white outline-none ring-sf-magic/30 focus:ring-2"
                  type="text"
                  placeholder="房间码"
                  value={roomIdInput}
                  onChange={(e) => setRoomIdInput(e.target.value.toUpperCase())}
                />
                <button
                  type="button"
                  className={`${ctaSecondary} max-w-[6.5rem] shrink-0 px-2`}
                  onClick={joinRoom}
                  disabled={!socket}
                >
                  加入
                </button>
              </div>
            </div>
          </section>
        )}

        {roomId && (
          <section className="sf-glass rounded-3xl p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-[0.6rem] font-bold uppercase tracking-widest text-sf-muted">房间码</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-2xl font-black tracking-[0.35em] text-sf-accent sf-text-glow">
                    {roomId}
                  </span>
                  <button
                    type="button"
                    className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[0.65rem] font-bold text-sf-muted active:bg-white/10"
                    onClick={() => void copyRoomId()}
                  >
                    {copyHint ? "已复制" : "复制"}
                  </button>
                </div>
              </div>
              {game && (
                <div className="text-right">
                  <p className="text-[0.6rem] font-bold text-sf-muted">当前身份</p>
                  <p className="max-w-[9rem] truncate text-sm font-black text-white">{game.you.name}</p>
                </div>
              )}
            </div>

            {inLobby && (
              <div className="mt-5 space-y-4">
                <p className="text-center text-[0.65rem] font-bold uppercase tracking-widest text-sf-muted">
                  玩家席位
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {[0, 1].map((i) => {
                    const p = roster[i];
                    return (
                      <div
                        key={p?.id ?? `slot-${i}`}
                        className="flex flex-col items-center rounded-2xl border border-white/10 bg-black/35 p-3"
                      >
                        <div className="mb-2 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-sf-accent/25 to-sf-magic/20 text-2xl font-black text-white ring-2 ring-white/10">
                          {p ? p.name.slice(0, 1) : "?"}
                        </div>
                        <p className="w-full truncate text-center text-sm font-bold text-white">
                          {p?.name ?? "等待加入…"}
                        </p>
                        <p
                          className={`mt-1 text-[0.65rem] font-bold ${p?.ready ? "text-sf-accent" : "text-sf-muted"}`}
                        >
                          {p ? (p.ready ? "已准备" : "未准备") : "空位"}
                        </p>
                      </div>
                    );
                  })}
                </div>
                <button type="button" className={ctaPrimary} onClick={toggleReady} disabled={!socket}>
                  {selfReady ? "取消准备" : "准备开战"}
                </button>
              </div>
            )}
          </section>
        )}

        {playing && game?.grid && game.givens && (
          <>
            {frozen && (
              <div className="flex items-center justify-center gap-2 rounded-2xl border border-cyan-400/40 bg-gradient-to-r from-cyan-500/15 to-blue-600/15 px-3 py-3 text-center">
                <span className="text-xl" aria-hidden>
                  ❄️
                </span>
                <p className="text-sm font-bold text-cyan-100">冰冻中！暂时无法填数</p>
              </div>
            )}

            <div className="sf-glass flex flex-col gap-2 rounded-3xl p-3 sm:p-4">
              <div className="flex gap-2">
                <div className="sf-glow-ring flex flex-1 flex-col rounded-2xl border border-white/10 bg-black/40 px-3 py-2">
                  <span className="text-[0.55rem] font-black uppercase tracking-[0.2em] text-sf-muted">对局时间</span>
                  <span className="font-mono text-2xl font-black tabular-nums text-sf-accent sf-text-glow">
                    {formatClock(elapsedMs)}
                  </span>
                </div>
                <div className="flex flex-1 flex-col justify-center rounded-2xl border border-white/10 bg-black/40 px-3 py-2">
                  <span className="text-[0.55rem] font-black uppercase tracking-[0.2em] text-sf-muted">对手</span>
                  <span className="truncate text-sm font-black text-white">{game.rivalName}</span>
                  <span className="text-[0.65rem] font-bold text-sf-magic">{game.rivalFilled} 格</span>
                </div>
                <div className="flex w-[4.25rem] flex-col items-center justify-center rounded-2xl border border-sf-gold/30 bg-black/40 py-1">
                  <span className="text-[0.5rem] font-black text-sf-muted">技能</span>
                  <span className="text-2xl font-black text-sf-gold">{skillsRemaining}</span>
                </div>
              </div>
              {game.puzzleId && (
                <p className="text-center text-[0.6rem] font-bold text-sf-muted">
                  关卡 <span className="font-mono text-sf-text">{game.puzzleId}</span> · 已填{" "}
                  <span className="text-sf-accent">{selfFilled}</span>/81
                </p>
              )}
              <p className="text-center text-[0.6rem] leading-relaxed text-sf-muted">
                点可选格子弹出数字板；点空白外区域关闭。重复数字标红，终局须与标解一致。
              </p>
              <div
                ref={boardWrapRef}
                className="relative mx-auto w-full max-w-[min(100%,24rem)] touch-none"
              >
                <SudokuBoardPixi
                  grid={game.grid}
                  givens={game.givens}
                  blindRows={blindRows}
                  conflicts={conflictSet}
                  selected={selectedCell}
                  readOnly={false}
                  interactive={!frozen}
                  onSelectCell={onSelectCell}
                />
                {selectedCell && !frozen && (
                  <div
                    role="dialog"
                    aria-label="填入数字"
                    className="pointer-events-auto absolute z-20 w-[7.6rem] rounded-2xl border border-sf-accent/40 bg-[#0c0b14]/95 p-2 shadow-[0_8px_32px_rgba(0,0,0,0.55),0_0_0_1px_rgba(46,230,214,0.15)] backdrop-blur-md sm:w-[8.5rem]"
                    style={{
                      left: `${((selectedCell.col + 0.5) / 9) * 100}%`,
                      top: `${((selectedCell.row + 0.5) / 9) * 100}%`,
                      transform: popoverPlacementBelow
                        ? "translate(-50%, 10px)"
                        : "translate(-50%, calc(-100% - 10px))",
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <div className="mb-1 text-center text-[0.55rem] font-bold text-sf-muted">
                      填入
                    </div>
                    <div className="grid grid-cols-3 justify-items-center gap-1">
                      {([1, 2, 3, 4, 5, 6, 7, 8, 9] as const).map((n) => (
                        <button
                          key={n}
                          type="button"
                          className={popoverDigitBtn}
                          onClick={() => applyDigit(n as Digit)}
                        >
                          {n}
                        </button>
                      ))}
                      <button
                        type="button"
                        className={popoverClearBtn}
                        onClick={() => applyDigit(0 as Digit)}
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
              <p className="relative mb-1 text-[0.65rem] font-black uppercase tracking-[0.25em] text-sf-gold">
                本局结果
              </p>
              <p className="relative text-2xl font-black text-white sm:text-3xl">
                {game.winnerId === game.you.id ? (
                  <span className="bg-gradient-to-r from-sf-gold via-amber-200 to-sf-gold bg-clip-text text-transparent">
                    胜利
                  </span>
                ) : (
                  <span className="text-sf-muted">败北</span>
                )}
              </p>
              <p className="relative mt-1 text-sm font-bold text-sf-muted">
                {game.winnerId === game.you.id ? "干得漂亮！" : `胜者：${game.winnerName ?? "对手"}`}
              </p>
              {resultMs !== null && (
                <p className="relative mt-3 font-mono text-lg font-black text-sf-accent">
                  {formatClock(resultMs)}
                </p>
              )}
              {game.puzzleId && (
                <p className="relative mt-1 text-[0.65rem] text-sf-muted">
                  关卡 <span className="font-mono text-sf-text">{game.puzzleId}</span>
                </p>
              )}
              <div className="relative mt-4">
                <SudokuBoardPixi
                  grid={game.grid}
                  givens={game.givens}
                  blindRows={Array.from({ length: 9 }, () => false)}
                  conflicts={conflictSet}
                  selected={null}
                  readOnly
                  interactive={false}
                  onSelectCell={noopSelectCell}
                />
              </div>
            </section>
            <section className="sf-glass rounded-3xl p-4">
              <p className="mb-3 text-center text-[0.65rem] font-bold text-sf-muted">
                双方各点一次「再战」返回大厅
              </p>
              <button type="button" className={ctaPrimary} onClick={requestRematch} disabled={!socket}>
                {rematchMine ? "已就绪 · 等对手" : "再战一局"}
              </button>
              {rematchPartner && !rematchMine && (
                <p className="mt-2 text-center text-xs font-bold text-sf-accent">对手已确认</p>
              )}
            </section>
          </>
        )}

        {roomId && !playing && !done && game?.phase === "lobby" && roster.length === 2 && (
          <p className="text-center text-[0.65rem] font-bold text-sf-muted">双方准备后立即开局</p>
        )}
      </main>

      {/* 底部操控台：与棋盘同列 flex 排布，不再 fixed 遮挡 */}
      {playing && game?.grid && game.givens && (
        <footer className="w-full shrink-0 border-t border-white/10 bg-[#05040a]/95 px-3 pt-3 shadow-[0_-8px_32px_rgba(0,0,0,0.35)] backdrop-blur-2xl pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="mb-2">
            <p className="mb-1 text-[0.55rem] font-bold uppercase tracking-wider text-sf-muted/90">遮行目标</p>
            <div className="flex gap-1 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {Array.from({ length: 9 }, (_, r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setBlindRow(r)}
                  className={`shrink-0 rounded-xl border px-2.5 py-1.5 text-xs font-black ${
                    blindRow === r
                      ? "border-sf-accent/60 bg-sf-accent/20 text-sf-accent"
                      : "border-white/10 bg-black/40 text-sf-muted"
                  }`}
                >
                  {r + 1}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[0.55rem] font-black uppercase tracking-wider text-sf-muted/90">干扰技能</span>
              {cooldownLeftSec > 0 && (
                <span className="text-[0.6rem] font-bold text-sf-warn-text">冷却 {cooldownLeftSec}s</span>
              )}
            </div>
            {cooldownLeftSec > 0 && game && (
              <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-black/50">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-sf-accent to-cyan-300 transition-[width] duration-200"
                  style={{ width: `${Math.min(100, cooldownProgress * 100)}%` }}
                />
              </div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                className={skillBtn}
                disabled={!canUseItem}
                aria-label="遮行干扰"
                onClick={() => useItem("row_blind", blindRow)}
              >
                <span className="text-lg leading-none" aria-hidden>
                  🌫️
                </span>
                遮行
              </button>
              <button
                type="button"
                className={skillBtn}
                disabled={!canUseItem}
                aria-label="撤销对手三步"
                onClick={() => useItem("undo_three")}
              >
                <span className="text-lg leading-none" aria-hidden>
                  ↩️
                </span>
                撤销
              </button>
              <button
                type="button"
                className={skillBtn}
                disabled={!canUseItem}
                aria-label="冰冻对手"
                onClick={() => useItem("freeze")}
              >
                <span className="text-lg leading-none" aria-hidden>
                  ❄️
                </span>
                冰冻
              </button>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}
