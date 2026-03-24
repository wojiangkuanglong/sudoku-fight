# 从 H5 迁移到微信小游戏的架构说明

**分步执行清单（含服务端适配与验收顺序）见：[wechat-minigame-migration-checklist.md](./wechat-minigame-migration-checklist.md)。**

## 分层建议

| 层级 | 当前 H5 | 微信小游戏侧 |
|------|-----------|----------------|
| 规则与数据 | `packages/shared` | 原样复用（TS 编译为 JS 或同逻辑手抄） |
| 实时通信 | `socket.io-client` | 换 `wx.connectSocket` + 相同事件名与 JSON 载荷 |
| 棋盘渲染 | `renderSudokuBoardPixi.ts`（Pixi `Graphics`/`Text`） | 使用适配器提供的 `PIXI` 或 **Canvas 2D** 按同一套「格尺寸 + 状态」重绘 |
| UI 壳子 | React + Tailwind | 小游戏无 DOM：用 **原生布局组件** 或 **独立 Canvas UI**；Tailwind 仅服务 H5 |

## 为何选 Pixi 而不是 react-three-fiber

- 数独盘面本质是 **2D 格子 + 数字**，Pixi 与微信侧的 **Canvas/WebGL** 模型一致，包体与功耗通常优于 3D 栈。
- **react-three-fiber** 适合强 3D 表现；若未来要做「立体棋盘 / 镜头动效」再单独加 3D 包即可，不必为了数独强上 R3F。

## 建议迁移步骤

1. 保留服务端协议：`lobby:*`（含 `lobby:difficulty` 选难度）、`game:state`、`game:cell`、`game:item` 等事件名与字段不变。
2. 将 `SudokuBoardVisualState` + `renderSudokuBoardPixi` 的绘制逻辑迁到小游戏的 `Game` 场景里（每帧或状态变更时 `removeChildren` + 重绘，与现 H5 一致）。
3. 触摸命中：复用 `boardCellFromPointer` 的数学（`localX/localY` → `row/col`），数据源改为触摸事件的本地坐标。
4. 大厅、房间号、按钮等：用小游戏 UI 系统重做；**不要**依赖 Tailwind 运行时。

## 当前仓库入口

- 绘制纯函数：`packages/web/src/game/renderSudokuBoardPixi.ts`
- React 封装：`packages/web/src/game/SudokuBoardPixi.tsx`（仅 H5）
