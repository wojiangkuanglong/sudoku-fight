# Sudoku Fight（双人实时对战数独）

Monorepo：`packages/shared`（规则与题目）、`packages/server`（Socket.IO 房间与道具权威逻辑）、`packages/web`（React + Vite + **Tailwind CSS v4** + **PixiJS** 棋盘）。

- 微信小游戏迁移说明见 [`docs/wechat-minigame-port.md`](docs/wechat-minigame-port.md)。

## 玩法摘要

- 两名玩家进入同一房间，在**大厅选择本局难度**（简 / 中 / 难）后**准备**，服务端按该难度生成**同一道**标准数独。
- **先填完且与标准解一致者胜**。
- 道具（每局次数与冷却由服务端限制）：
  - **随机遮盖 30s**：随机遮挡对手一整行、一整列或一个宫格（仅表现层）。
  - **撤销 3 步**：撤销对手最近 3 次填写（不含题目给定格）。
  - **冰冻 8s**：对手暂时无法提交填数。
  - **炸弹**：随机清空对手一格非题面手写数字（并剔除该格相关历史，避免撤销错乱）。
- **本局计时**：对局中显示已用时间；终局显示决胜用时。
- **冲突高亮**：行/列/九宫出现重复数字时标红（仍可继续填，终局须与标解一致）。
- **6 位数字房间号**（便于口述/打字分享），一键复制；错误提示约 5 秒后自动消失。
- **浅色 / 深色主题**：顶栏切换，偏好保存在本地。
- **再来一局**：结束后双方各点一次确认，回到同一房间大厅并重新准备开局。
- 开发模式下前端使用 `vite --host`，便于局域网其他设备访问（控制台会打印 Network URL）。

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
