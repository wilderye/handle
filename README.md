# 汉兜 Discord Bot

基于 [汉兜 (Handle)](https://github.com/antfu/handle) 的 Discord 机器人版本 —— 中文成语猜词游戏。

## 功能

- 🎮 `/handle` - 开始新游戏
- 💡 `/guess <成语>` - 猜测成语
- 🔍 `/hint` - 获取提示
- 📊 `/sheet` - 查看声母/韵母速查表
- 📈 `/stats` - 查看个人统计
- 🏳️ `/giveup` - 放弃当前游戏

## 本地开发

### 前提条件

- Node.js >= 18
- Discord Bot Token（从 [Discord Developer Portal](https://discord.com/developers/applications) 获取）

### 安装

```bash
npm install
```

### 配置环境变量

创建 `.env` 文件：

```env
DISCORD_TOKEN=your_discord_bot_token
CLIENT_ID=your_discord_application_id
```

### 注册斜杠命令

```bash
npm run deploy
```

### 运行开发模式

```bash
npm run dev
```

### 构建生产版本

```bash
npm run build
npm start
```

## 部署

详见 [DEPLOY.md](./DEPLOY.md)

## 技术栈

- [Discord.js](https://discord.js.org/) - Discord API 封装
- [Puppeteer](https://pptr.dev/) - 游戏界面截图
- [pinyin](https://www.npmjs.com/package/pinyin) - 拼音处理

## 原始项目

本项目基于 [antfu/handle](https://github.com/antfu/handle)，感谢原作者的开源贡献。

## License

[MIT](./LICENSE) License
