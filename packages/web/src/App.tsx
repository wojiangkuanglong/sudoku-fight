import { useCallback, useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { Digit, Grid9 } from "@sudoku-fight/shared";

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
}

function cellClass(row: number, col: number, extra?: string): string {
  const parts = ["cell"];
  if (col === 2 || col === 5) parts.push("thick-r");
  if (row === 2 || row === 5) parts.push("thick-b");
  if (extra) parts.push(extra);
  return parts.join(" ");
}

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
      setError("房间已解散，请重新开局");
    });

    return () => {
      s.disconnect();
    };
  }, []);

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

  const onCellChange = (row: number, col: number, raw: string) => {
    if (!game?.grid || !game.givens) return;
    if (game.givens[row]![col]! !== 0) return;
    const v = raw.replace(/\D/g, "").slice(0, 1);
    const value = v === "" ? 0 : (Number(v) as Digit);
    socket?.emit("game:cell", { row, col, value });
  };

  const canUseItem =
    game &&
    game.phase === "playing" &&
    game.itemUses < game.itemMax &&
    now >= game.itemReadyAt;

  const cooldownLeftSec =
    game && now < game.itemReadyAt ? Math.ceil((game.itemReadyAt - now) / 1000) : 0;

  const useItem = useCallback(
    (type: "row_blind" | "undo_three" | "freeze", row?: number) => {
      setError(null);
      socket?.emit("game:item", { type, row });
    },
    [socket],
  );

  const inLobby = Boolean(roomId) && game?.phase !== "playing" && game?.phase !== "done";
  const playing = game?.phase === "playing";
  const done = game?.phase === "done";

  return (
    <>
      <h1>Sudoku Fight</h1>
      <p className="sub">双人实时对战标准数独 · 道具干扰 · 先完成者胜</p>

      {!roomId && (
        <section className="panel">
          <div className="row" style={{ marginBottom: "0.75rem" }}>
            <label htmlFor="name">昵称</label>
            <input
              id="name"
              type="text"
              placeholder="例如：棋手A"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="row">
            <button type="button" className="primary" onClick={createRoom} disabled={!socket}>
              创建房间
            </button>
          </div>
          <div className="row" style={{ marginTop: "0.75rem" }}>
            <input
              type="text"
              placeholder="房间号"
              value={roomIdInput}
              onChange={(e) => setRoomIdInput(e.target.value)}
            />
            <button type="button" onClick={joinRoom} disabled={!socket}>
              加入房间
            </button>
          </div>
          {error && !roomId && <p className="error">{error}</p>}
        </section>
      )}

      {roomId && (
        <section className="panel">
          <div className="meta">
            房间号 <span className="badge">{roomId}</span>
            {game && (
              <>
                {" "}
                · 你：<strong>{game.you.name}</strong>
              </>
            )}
          </div>
          {inLobby && (
            <>
              <p className="meta" style={{ marginTop: "0.5rem" }}>
                玩家：{roster.map((p) => `${p.name}${p.ready ? " ✓" : ""}`).join(" · ")}
              </p>
              <div className="row" style={{ marginTop: "0.75rem" }}>
                <button type="button" className="primary" onClick={toggleReady} disabled={!socket}>
                  {selfReady ? "取消准备" : "准备"}
                </button>
              </div>
            </>
          )}
          {error && roomId && <p className="error">{error}</p>}
        </section>
      )}

      {playing && game?.grid && game.givens && (
        <>
          {frozen && (
            <div className="banner">你被冰冻了！暂时无法填数（效果由服务端校验）</div>
          )}
          <section className="panel board-wrap">
            <div className="meta">
              对手 <strong>{game.rivalName}</strong> 已填{" "}
              <strong>{game.rivalFilled}</strong> 格
              <span className="badge" style={{ marginLeft: "0.5rem" }}>
                道具 {game.itemUses}/{game.itemMax}
                {cooldownLeftSec > 0 ? ` · 冷却 ${cooldownLeftSec}s` : ""}
              </span>
            </div>
            <div className="sudoku">
              {game.grid.map((rowArr, row) =>
                rowArr.map((val, col) => {
                  const given = game.givens![row]![col]! !== 0;
                  const display = given ? game.givens![row]![col]! : val;
                  const blind = Boolean(blindRows[row]);
                  return (
                    <div
                      key={`${row}-${col}`}
                      className={cellClass(
                        row,
                        col,
                        [given ? "given" : "", blind ? "blind" : ""].filter(Boolean).join(" "),
                      )}
                    >
                      {given ? (
                        display
                      ) : (
                        <input
                          inputMode="numeric"
                          disabled={frozen}
                          value={display === 0 ? "" : String(display)}
                          onChange={(e) => onCellChange(row, col, e.target.value)}
                        />
                      )}
                    </div>
                  );
                }),
              )}
            </div>
          </section>

          <section className="panel">
            <div className="meta" style={{ marginBottom: "0.5rem" }}>
              对对手使用道具（服务端权威）
            </div>
            <div className="items">
              <select
                value={blindRow}
                onChange={(e) => setBlindRow(Number(e.target.value))}
                aria-label="遮罩行"
              >
                {Array.from({ length: 9 }, (_, r) => (
                  <option key={r} value={r}>
                    第 {r + 1} 行
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!canUseItem}
                onClick={() => useItem("row_blind", blindRow)}
              >
                遮行 30s
              </button>
              <button type="button" disabled={!canUseItem} onClick={() => useItem("undo_three")}>
                撤销对手 3 步
              </button>
              <button type="button" disabled={!canUseItem} onClick={() => useItem("freeze")}>
                冰冻输入 8s
              </button>
            </div>
          </section>
        </>
      )}

      {done && game && (
        <section className="panel">
          <p className="win">
            {game.winnerId === game.you.id ? "你赢了！" : `胜者：${game.winnerName ?? "对手"}`}
          </p>
          <p className="meta">关闭页签或刷新即可重新开局。</p>
        </section>
      )}
    </>
  );
}
