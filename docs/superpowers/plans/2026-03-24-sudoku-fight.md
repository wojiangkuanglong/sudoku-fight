# Sudoku Fight 实施计划

> **For agentic workers:** 可按任务勾选执行；本仓库首版已在主会话落地实现。

**Goal:** 可运行的双人实时对战数独 monorepo（TS + Socket.IO + React）。

**Architecture:** shared 规则与类型；server 房间与权威状态；web 棋盘与道具 UI。

**Tech Stack:** pnpm、TypeScript、socket.io、Express、React、Vite。

---

### Task 1: Monorepo 与 shared

**Files:** `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `packages/shared/**`

- [ ] 初始化 workspace 与 `shared` 包导出
- [ ] 实现网格类型、`isValidMove`、`isSolvedAgainst`、题目常量

### Task 2: Server

**Files:** `packages/server/**`

- [ ] Express + Socket.IO、CORS
- [ ] `Room`：玩家、网格、历史栈、道具冷却、遮行/冻结截止时间
- [ ] 事件：`createRoom`、`joinRoom`、`playerReady`、`cell:set`、`item:use`、`state` 同步

### Task 3: Web

**Files:** `packages/web/**`

- [ ] 创建/加入房间、昵称、准备
- [ ] 9×9 棋盘、对手进度摘要、道具按钮与遮罩/冻结提示
- [ ] 连接 `VITE_SERVER_URL`

### Task 4: 根脚本与文档

- [ ] `pnpm dev` 并行启动 server + web
- [ ] `README.md` 使用说明

**验证:** `pnpm install && pnpm build && pnpm dev`（手动双开浏览器测一局）
