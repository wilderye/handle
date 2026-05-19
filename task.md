# 海龟汤功能集成任务列表

- [x] `[x]` 准备阶段
  - [x] 更新 `package.json` 依赖并运行 `npm install`
  - [x] 创建根目录 `.gitignore` 和 `.antigravityignore` 保护隐私
  - [x] 编写核心持久化存储 `src/game/soup-db.ts`
- [x] `[x]` 编写核心逻辑
  - [x] 编写 Emoji 反应监听逻辑 `src/game/soup-reactions.ts`
  - [x] 实现斜杠命令 `/海龟汤`并接入 V2 面板与 `/海龟汤 帮助` `src/commands/soup.ts`
- [x] `[x]` 接入并配置 Bot
  - [x] 修改 `src/index.ts` 启用 Reactions Intents 与 Partials，并挂载监听器
  - [x] 在 `src/commands/index.ts` 中注册新命令
  - [x] 运行本地构建与命令部署 `npm run build && npm run deploy`
- [x] `[x]` 系统验证
  - [x] 本地运行测试，验证数据库自动降级/连通逻辑
  - [x] 验证 Emoji 动态归档与 `/海龟汤 查看猜测历史` V2 翻页及安全交互
  - [x] 验证 `/海龟汤 结束` 总结与身份组清理
