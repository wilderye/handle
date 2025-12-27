# 汉兜 Discord Bot 部署指南

## 部署到 Zeabur

### 第一步：准备 GitHub 仓库

```bash
git add .
git commit -m "feat: discord bot ready for deployment"
git push origin main
```

---

### 第二步：在 Zeabur 创建项目

1. 打开 [Zeabur 控制台](https://dash.zeabur.com/)
2. 登录您的账号（可用 GitHub 授权）
3. 点击 **Create Project**（创建项目）
4. 选择一个区域（推荐：东京或新加坡）

---

### 第三步：连接 GitHub 仓库

1. 在项目页面，点击 **Deploy New Service** → **Git**
2. 授权 Zeabur 访问您的 GitHub
3. 选择您的仓库
4. 点击 **Deploy**

---

### 第四步：配置环境变量

1. 等待服务创建完成后，点击服务卡片
2. 进入 **Variables** 标签
3. 添加以下环境变量：

| Key             | Value                    |
| --------------- | ------------------------ |
| `DISCORD_TOKEN` | 您的 Discord Bot Token   |
| `CLIENT_ID`     | 您的 Discord 应用程序 ID |

4. 点击 **Redeploy** 使变量生效

---

### 第五步：检查部署状态

1. 进入 **Deployments** 标签查看构建日志
2. 如果一切正常，您会看到：
   ```
   ✅ Bot 已上线！登录为 YourBot#1234
   📊 已加入 X 个服务器
   🎮 已加载 6 个命令
   ```

---

## 使用 Docker 部署

### 本地构建

```bash
docker build -t handle-discord-bot .
docker run -e DISCORD_TOKEN=your_token -e CLIENT_ID=your_client_id handle-discord-bot
```

### 使用 Dockerfile

项目已包含 `Dockerfile`，支持 Puppeteer 和中文字体。

---

## 常见问题

### Q1: 部署失败，提示找不到 Puppeteer/Chrome

确保部署平台支持 Chromium。使用项目自带的 `Dockerfile` 可解决此问题。

### Q2: 截图中的中文变成方块

HTML 模板中已引入 Google Fonts（思源黑体），确保部署环境可访问外网。

### Q3: Bot 无法响应命令

- 确保 `DISCORD_TOKEN` 和 `CLIENT_ID` 正确
- 检查 Bot 是否有足够的权限
- 运行 `npm run deploy` 来注册斜杠命令
