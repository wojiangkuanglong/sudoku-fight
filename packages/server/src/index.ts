import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { registerSocket } from "./socket.js";

const app = express();
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: true, methods: ["GET", "POST"] },
});

registerSocket(io);

const PORT = Number(process.env.PORT) || 3001;
httpServer.listen(PORT, () => {
  console.log(`[sudoku-fight] server listening on :${PORT}`);
});
