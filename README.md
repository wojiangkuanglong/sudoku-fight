# Sudoku Fight（双人实时对战数独）

Monorepo：`packages/shared`（规则与题目）、`packages/server`（Socket.IO 房间与道具权威逻辑）、`packages/web`（React + Vite）。

## 玩法摘要

- 两名玩家进入同一房间并**准备**后，服务端下发**同一道**标准数独。
- **先填完且与标准解一致者胜**。
- 道具（每局次数与冷却由服务端限制）：
  - **遮行 30s**：指定一行，对手该行被遮罩（仅表现层；答题逻辑仍在自己网格上）。
  - **撤销 3 步**：撤销对手最近 3 次填写（不含题目给定格）。
  - **冰冻 8s**：对手暂时无法提交填数。

## 本地运行

需要 [pnpm](https://pnpm.io) 9+。

```bash
pnpm install
pnpm dev
```

- 前端：<http://localhost:5173>
- 后端：<http://localhost:3001>（健康检查：`GET /health`）

双开两个浏览器窗口（或普通 + 无痕）各进同一房间号即可对战。

### 环境变量

- 服务端：`PORT`（默认 `3001`）
- 前端：`VITE_SERVER_URL`（默认 `http://localhost:3001`；生产部署时改为实际 API 地址）

## 构建

```bash
pnpm build
```

## 文档

- 设计：`docs/superpowers/specs/2026-03-24-sudoku-fight-design.md`
- 实施计划：`docs/superpowers/plans/2026-03-24-sudoku-fight.md`
