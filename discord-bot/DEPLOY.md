# 汉兜 Discord Bot 部署指南 (Zeabur)

## 第一步：准备 GitHub 仓库

### 1.1 提交代码
在项目根目录运行：
```bash
cd e:\游戏文档\酒馆\antigravity\handle\handle
git add .
git commit -m "feat: discord bot ready for deployment"
git push origin main
```

### 1.2 确认仓库结构
确保您的 GitHub 仓库包含 `discord-bot` 子目录。

---

## 第二步：在 Zeabur 创建项目

1. 打开 [Zeabur 控制台](https://dash.zeabur.com/)
2. 登录您的账号（可用 GitHub 授权）
3. 点击 **Create Project**（创建项目）
4. 选择一个区域（推荐：东京或新加坡）

---

## 第三步：连接 GitHub 仓库

1. 在项目页面，点击 **Deploy New Service** → **Git**
2. 授权 Zeabur 访问您的 GitHub
3. 选择您的仓库（例如 `handle`）
4. **重要**：因为 Bot 代码在子目录，点击 **Advanced** 展开高级选项：
   - **Root Directory**: 填写 `discord-bot`
   - 这告诉 Zeabur 只构建 `discord-bot` 目录
5. 点击 **Deploy**

---

## 第四步：配置环境变量

1. 等待服务创建完成后，点击服务卡片
2. 进入 **Variables** 标签
3. 添加以下环境变量：

| Key             | Value                    |
| --------------- | ------------------------ |
| `DISCORD_TOKEN` | 您的 Discord Bot Token   |
| `CLIENT_ID`     | 您的 Discord 应用程序 ID |

4. 点击 **Redeploy** 使变量生效

---

## 第五步：检查部署状态

1. 进入 **Deployments** 标签查看构建日志
2. 如果一切正常，您会看到：
   ```
   ✅ Bot 已上线！登录为 YourBot#1234
   📊 已加入 X 个服务器
   🎮 已加载 5 个命令
   ```

---

## 常见问题

### Q1: 部署失败，提示找不到 Puppeteer/Chrome
Zeabur 的默认 Node.js 镜像可能不包含 Chrome。解决方案：
- 在 `discord-bot` 目录创建 `Dockerfile`（见下方）
- 或者联系 Zeabur 支持启用 Puppeteer 支持

### Q2: 截图中的中文变成方块
确保 HTML 模板中引入了 Google Fonts（已完成）。

### Q3: Bot 无法响应命令
- 确保 `DISCORD_TOKEN` 和 `CLIENT_ID` 正确
- 检查 Bot 是否有足够的权限
- 运行一次 `npx tsx src/deploy-commands.ts` 来注册命令

---

## 附录：Dockerfile（如果需要）

如果 Zeabur 默认镜像不支持 Puppeteer，使用此 Dockerfile：

```dockerfile
FROM node:20-slim

# 安装 Puppeteer 依赖和中文字体
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-noto-cjk \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# 设置 Puppeteer 使用系统 Chrome
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# 复制项目文件
COPY package*.json ./
RUN npm install --production

COPY . .
RUN npm run build

CMD ["npm", "start"]
```

将此文件保存为 `discord-bot/Dockerfile`，Zeabur 会自动使用它构建。
