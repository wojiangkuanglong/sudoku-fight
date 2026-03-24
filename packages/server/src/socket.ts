import type { Difficulty, ItemType } from "@sudoku-fight/shared";
import type { Server } from "socket.io";
import { buildPersonalState, publicLobbyPlayers, Room } from "./room.js";

const rooms = new Map<string, Room>();
const socketRoom = new Map<string, string>();

const ITEM_TYPES: ItemType[] = [
  "area_blind",
  "undo_three",
  "freeze",
  "eraser_one",
  "silence",
  "lock_cell",
  "cooldown_hurt",
  "bomb_digit",
];

function randomRoomId(): string {
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
}

function broadcastGameState(io: Server, room: Room): void {
  const now = Date.now();
  for (const sid of room.players.keys()) {
    const s = io.sockets.sockets.get(sid);
    if (s) s.emit("game:state", buildPersonalState(room, sid, now));
  }
}

function dissolveRoom(io: Server, roomId: string, leaverId: string): void {
  const room = rooms.get(roomId);
  if (!room) return;
  room.removePlayer(leaverId);
  const others = [...room.players.keys()];
  rooms.delete(roomId);
  socketRoom.delete(leaverId);
  for (const sid of others) {
    socketRoom.delete(sid);
    const o = io.sockets.sockets.get(sid);
    o?.leave(roomId);
    o?.emit("room:closed", { reason: "房间已解散（有玩家离开）" });
  }
}

export function registerSocket(io: Server): void {
  io.on("connection", (socket) => {
    socket.on("lobby:create", (payload: { name?: string }) => {
      const name = String(payload?.name ?? "").slice(0, 20);
      let id = randomRoomId();
      while (rooms.has(id)) id = randomRoomId();
      const room = new Room(id);
      const add = room.addPlayer(socket.id, name);
      if (!add.ok) {
        socket.emit("app:error", { message: add.reason });
        return;
      }
      rooms.set(id, room);
      socketRoom.set(socket.id, id);
      void socket.join(id);
      socket.emit("lobby:created", { roomId: id });
      io.to(id).emit("lobby:roster", { players: publicLobbyPlayers(room) });
      broadcastGameState(io, room);
    });

    socket.on("lobby:join", (payload: { roomId?: string; name?: string }) => {
      const raw = String(payload?.roomId ?? "")
        .trim()
        .toUpperCase();
      const name = String(payload?.name ?? "").slice(0, 20);
      const room = rooms.get(raw);
      if (!room) {
        socket.emit("app:error", { message: "房间不存在" });
        return;
      }
      const add = room.addPlayer(socket.id, name);
      if (!add.ok) {
        socket.emit("app:error", { message: add.reason });
        return;
      }
      socketRoom.set(socket.id, raw);
      void socket.join(raw);
      socket.emit("lobby:joined", { roomId: raw });
      io.to(raw).emit("lobby:roster", { players: publicLobbyPlayers(room) });
      broadcastGameState(io, room);
    });

    socket.on("lobby:rematch", () => {
      const roomId = socketRoom.get(socket.id);
      if (!roomId) return;
      const room = rooms.get(roomId);
      if (!room) return;
      const res = room.voteRematch(socket.id);
      if (!res.ok) {
        socket.emit("app:error", { message: res.reason });
        return;
      }
      io.to(roomId).emit("lobby:roster", { players: publicLobbyPlayers(room) });
      broadcastGameState(io, room);
    });

    socket.on("lobby:difficulty", (payload: { difficulty?: string }) => {
      const roomId = socketRoom.get(socket.id);
      if (!roomId) return;
      const room = rooms.get(roomId);
      if (!room) return;
      const raw = String(payload?.difficulty ?? "").toLowerCase();
      if (raw !== "easy" && raw !== "medium" && raw !== "hard") {
        socket.emit("app:error", { message: "难度无效" });
        return;
      }
      const res = room.setLobbyDifficulty(socket.id, raw as Difficulty);
      if (!res.ok) {
        socket.emit("app:error", { message: res.reason });
        return;
      }
      io.to(roomId).emit("lobby:roster", { players: publicLobbyPlayers(room) });
      broadcastGameState(io, room);
    });

    socket.on("lobby:ready", (payload: { ready?: boolean }) => {
      const roomId = socketRoom.get(socket.id);
      if (!roomId) return;
      const room = rooms.get(roomId);
      if (!room) return;
      const r = room.setReady(socket.id, Boolean(payload?.ready));
      if (!r.ok) {
        socket.emit("app:error", { message: r.reason });
        return;
      }
      io.to(roomId).emit("lobby:roster", { players: publicLobbyPlayers(room) });
      const now = Date.now();
      const { started } = room.tryStart(now);
      if (started) {
        io.to(roomId).emit("game:started", { roomId });
      }
      broadcastGameState(io, room);
    });

    socket.on("game:cell", (payload: { row?: number; col?: number; value?: number }) => {
      const roomId = socketRoom.get(socket.id);
      if (!roomId) return;
      const room = rooms.get(roomId);
      if (!room) return;
      const now = Date.now();
      const res = room.applyCell(
        socket.id,
        Number(payload?.row),
        Number(payload?.col),
        Number(payload?.value),
        now,
      );
      if (!res.ok) {
        socket.emit("app:error", { message: res.reason });
        return;
      }
      broadcastGameState(io, room);
    });

    socket.on("game:item", (payload: { type?: string; row?: number }) => {
      const roomId = socketRoom.get(socket.id);
      if (!roomId) return;
      const room = rooms.get(roomId);
      if (!room) return;
      const t = payload?.type as ItemType | undefined;
      if (!t || !ITEM_TYPES.includes(t)) {
        socket.emit("app:error", { message: "无效道具" });
        return;
      }
      const row = payload?.row !== undefined ? Number(payload.row) : undefined;
      const now = Date.now();
      const res = room.applyItem(socket.id, t, row, now);
      if (!res.ok) {
        socket.emit("app:error", { message: res.reason });
        return;
      }
      broadcastGameState(io, room);
    });

    socket.on("disconnect", () => {
      const roomId = socketRoom.get(socket.id);
      if (!roomId) return;
      dissolveRoom(io, roomId, socket.id);
    });
  });
}
