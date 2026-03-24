# 微信小游戏迁移清单（前端 + 服务端）

> **原则**：迁移只做 **运行环境适配** 与 **通信层兼容**，**不修改** 现有可玩的游戏规则与状态机（`packages/shared` 的解题/出题/常量、`packages/server/src/room.ts` 的 `Room` 行为、`socket.ts` 里已有业务分支逻辑）。若必须改服务端，仅限 **新增并行入口**（例如多一种 WebSocket 握手方式），且 **复用现有 `Room` / `registerSocket` 内同一套处理函数**（抽取为共享函数），避免双份规则。

完成顺序建议自上而下；每一大阶段可在独立分支交付，并用 **H5 回归** 确认未被破坏。

---

## 阶段 0：范围与冻结

- [ ] **冻结「逻辑变更」**：除本清单明确允许的适配代码外，PR 不改动 `room.ts` / `shared` 内算法与平衡参数。
- [ ] **确认目标载体**：微信小游戏（非 WXML 小程序）；主画布为 **Canvas / WebGL**，无 DOM。
- [ ] **准备微信侧配置**：小游戏 AppID、服务器域名（request/socket 合法域名）、**HTTPS/WSS** 线上地址。

---

## 阶段 1：协议契约（文档优先，零逻辑改动）

将下列内容与代码对齐，写成单一事实来源（可放在本文档附录或 `packages/shared` 内仅类型/注释，**不改变运行时行为**）。

### 1.1 客户端 → 服务端（`emit`）

| 事件名 | 载荷（与现 H5 一致） | 实现参考 |
|--------|----------------------|----------|
| `lobby:create` | `{ name?: string }` | `App.tsx` → `socket.ts` |
| `lobby:join` | `{ roomId?: string; name?: string }` | 房间号为 6 位数字字符串 |
| `lobby:ready` | `{ ready?: boolean }` | |
| `lobby:difficulty` | `{ difficulty?: string }` | `"easy" \| "medium" \| "hard"` |
| `lobby:rematch` | 无载荷 | |
| `game:cell` | `{ row?, col?, value? }` | 数字格提交 |
| `game:item` | `{ type?: string; row?: number }` | `type` 为 `ItemType` 字符串 |

### 1.2 服务端 → 客户端（`on`）

| 事件名 | 载荷要点 | 备注 |
|--------|-----------|------|
| `lobby:created` | `{ roomId: string }` | |
| `lobby:joined` | `{ roomId: string }` | |
| `lobby:roster` | `{ players: { id, name, ready }[] }` | |
| `game:started` | `{ roomId }` | H5 未用载荷，小游戏可一致忽略 |
| `game:state` | 与 `App.tsx` 中 `GameStatePayload` 一致 | **每人一份**（已含 `you` / `grid` 等） |
| `app:error` | `{ message: string }` | |
| `room:closed` | `{ reason?: string }` | H5 固定文案展示，小游戏可展示 `reason` |

### 1.3 传输层现状（H5）

- H5 使用 **Socket.IO**，且 `io(SERVER, { transports: ["websocket"] })`（见 `App.tsx`），即 **Engine.IO over WebSocket**。

### 1.4 小游戏侧通信选型（二选一，建议先定案）

- [ ] **方案 A**：在微信环境使用 **兼容 Socket.IO（Engine.IO）的客户端**（需调研可用库与包体；须与当前服务端 Socket.IO 版本匹配）。
- [ ] **方案 B**：服务端 **新增** 裸 WebSocket + JSON 消息层，**消息体仍沿用上表事件名与字段**，内部转发到与现 `socket.on(...)` 相同的处理逻辑（**不复制 `Room` 规则**）。H5 仍走原 Socket.IO，**行为不变**。

---

## 阶段 2：服务端迁移 / 适配（不改对局逻辑）

- [ ] **合法域名与证书**：生产环境必须为 **WSS**；与微信后台配置的 socket 域名一致。
- [ ] **CORS**：仅 H5 需要；小游戏 WebSocket 不依赖浏览器 CORS，但 **HTTP 接口**（若有）需按微信要求配置。
- [ ] **健康检查**：保留现有 `GET /health`（`packages/server/src/index.ts`），便于运维与微信侧「服务端可用」探测（若用 HTTP 探活）。
- [ ] **若选方案 B**：实现 **连接鉴权/来源校验**（如 token、openid 后续再接），避免裸 WS 被滥用；**限流**可后续加，但不改 `Room` 判定。
- [ ] **（可选，与逻辑无关）** 为横向扩展预留：Socket.IO Redis Adapter、粘性会话——**不改变单局语义**。

**验收**：现有 H5 `pnpm dev` 全流程可玩；服务端仅增加配置或 **并行 WS 适配层**。

---

## 阶段 3：小游戏工程骨架（新目录，不动 H5）

- [ ] 在微信开发者工具创建 **小游戏** 工程（建议新目录，例如 `packages/minigame/` 或仓库外独立仓，由团队约定）。
- [ ] 配置 `game.json`：横竖屏、网络超时、是否使用插件等。
- [ ] **环境抽象**：封装 `getServerBaseUrl()`、`storage`（对应 `localStorage` 主题等）、`clipboard`（房间号复制），便于与 H5 行为对齐。

---

## 阶段 4：复用共享逻辑（无行为变更）

- [ ] 将 **`@sudoku-fight/shared`** 以构建产物或 npm workspace 依赖形式引入小游戏构建（TS → JS，路径按微信构建链调整）。
- [ ] 小游戏端 **仅调用** 与 H5 相同的纯函数：`allConflictKeys`、`filledCount`、类型等；**禁止** 在小游戏内复制一份数独规则。

---

## 阶段 5：棋盘渲染（Pixi / Canvas）

- [ ] **复用绘制数据模型**：`SudokuBoardVisualState`（见 `packages/web/src/game/renderSudokuBoardPixi.ts`）。
- [ ] **复用/移植绘制与命中**：
  - `renderSudokuBoardPixi`
  - `boardCellFromPointer` / `attachBoardInteraction` 的 **坐标数学**（微信触摸坐标 → 与 H5 `localX/localY` 一致）。
- [ ] **Pixi 初始化**：使用微信小游戏适配的 `PIXI` / `canvas`（按官方或社区 adapter 文档）；注意 **无 `window` / `ResizeObserver`**，尺寸来自 `wx.getSystemInfoSync` + 布局策略。
- [ ] **性能（不改变逻辑的前提下可逐步做）**：后续可将「全量 removeChildren + 重建」改为增量更新；**首版可先与 H5 行为一致**，保证可玩。

---

## 阶段 6：网络与状态机（对齐 H5，不写新规则）

- [ ] 连接成功后，按 H5 顺序监听：`lobby:created`、`lobby:joined`、`lobby:roster`、`game:started`、`game:state`、`app:error`、`room:closed`。
- [ ] 本地维护与 `App.tsx` 等价的 **UI 状态**（房间号、昵称、`game` 快照、`selectedCell`、技能抽屉开关等），**根据 `game:state` 更新**；计时器可用 `setInterval` 驱动 **仅 UI**（与 H5 250ms tick 类似），**不本地篡改 `grid` 权威数据**（仍以服务端 `game:state` 为准）。
- [ ] 发送操作：`lobby:create` / `join` / `ready` / `difficulty` / `rematch`、`game:cell`、`game:item`，载荷字段与 H5 **完全一致**。

---

## 阶段 7：UI 与交互（小游戏原生，逻辑同 H5）

- [ ] 大厅：昵称、创建房间、输入 6 位房间号加入（校验规则同 H5）。
- [ ] 大厅内：房间码展示、复制、难度三选一、双人 roster、准备按钮。
- [ ] 对局：顶栏信息与 H5 一致；棋盘 + 选格 + 数字面板（或等价交互）；技能入口与列表与 H5 **同一套 `ItemType`**。
- [ ] 结算：结果页 + 再战；行为依赖 `lobby:rematch` 与 `game:state` 中 `rematchVotes` 等字段，**勿自创规则**。

---

## 阶段 8：联调与回归

- [ ] **小游戏 ↔ 现服务端**：创建房间、加入、准备、开局、填数、技能、终局、再战、一方断线解散（与现服一致）。
- [ ] **H5 回归**：同一服务端版本下 H5 全流程再测一遍。
- [ ] **弱网**：断线重连策略若未做，应与现产品一致（当前为断线即解散）；**不改逻辑则不在此清单实现「保房重连」**。

---

## 阶段 9：发布前检查（平台要求）

- [ ] 微信后台 **socket 合法域名**、**request 合法域名** 已配置。
- [ ] 正式包使用 **WSS** 与正式服地址。
- [ ] 用户隐私与日志：不向日志打印完整对局状态与 openid（按平台规范）。

---

## 附录：代码锚点（便于检索）

| 用途 | 路径 |
|------|------|
| H5 状态与事件 | `packages/web/src/App.tsx` |
| Socket 服务端 | `packages/server/src/socket.ts` |
| 房间与状态机构建 | `packages/server/src/room.ts`（`buildPersonalState`） |
| 棋盘绘制纯逻辑 | `packages/web/src/game/renderSudokuBoardPixi.ts` |
| H5 Pixi 封装 | `packages/web/src/game/SudokuBoardPixi.tsx`（仅参考生命周期） |
| HTTP 入口 | `packages/server/src/index.ts` |

---

## 建议的 PR / 分支切分（一步一步）

1. **文档 + 协议表**（本清单阶段 0–1）— 可单独合并。  
2. **服务端**：仅配置 +（可选）裸 WS 适配 — 每步保证 H5 测试通过。  
3. **小游戏空壳 + shared 引入 + 连通性**（能收到 `game:state`）。  
4. **棋盘渲染 + 填数闭环**。  
5. **大厅 / 技能 / 结算**。  
6. **体验与性能优化**（仍不改 `Room` 规则）。

完成某项请在对应 `[ ]` 改为 `[x]` 或使用 issue/看板跟踪。
