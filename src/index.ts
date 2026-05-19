import {
  ChatInputCommandInteraction,
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  Partials,
} from "discord.js";
import { config } from "dotenv";
import { createServer } from "node:http";
import { commands } from "./commands/index.js";
import { initSoupDB } from "./game/soup-db.js";
import { handleReactionAdd, handleReactionRemove } from "./game/soup-reactions.js";

// 加载环境变量
config();

// 初始化海龟汤数据库
await initSoupDB();

// ============ Cloudflare WARP 代理设置 ============
// 当 wireproxy 运行时，所有出站流量走 Cloudflare WARP 的干净 IP
const WARP_PROXY = process.env.WARP_PROXY || "http://127.0.0.1:1080";
if (process.env.WARP_PRIVATE_KEY) {
  try {
    const { ProxyAgent, setGlobalDispatcher } = await import("undici");
    setGlobalDispatcher(new ProxyAgent(WARP_PROXY));
    console.log(`🛡️ WARP 代理已启用: ${WARP_PROXY}`);
  } catch (err: any) {
    console.warn(`⚠️ WARP 代理设置失败: ${err.message}，将使用直连`);
  }
} else {
  console.log("ℹ️ 未检测到 WARP_PRIVATE_KEY，使用直连模式（本地开发）");
}

// ============ Render 保活 HTTP 服务 ============
const PORT = parseInt(process.env.PORT || "10000", 10);
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL; // Render 自动注入的外部 URL

const server = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("OK");
});

server.listen(PORT, () => {
  console.log(`🌐 保活 HTTP 服务已启动，端口: ${PORT}`);

  // 每 13 分钟 ping 自己，防止 Render 15 分钟无流量休眠
  if (RENDER_EXTERNAL_URL) {
    setInterval(async () => {
      try {
        await fetch(`${RENDER_EXTERNAL_URL}/keepalive`);
        console.log("💓 保活 ping 成功");
      } catch {
        console.warn("⚠️ 保活 ping 失败");
      }
    }, 5 * 60 * 1000); // 5 分钟
    console.log(`💓 保活定时器已启动，每 5 分钟 ping: ${RENDER_EXTERNAL_URL}`);
  } else {
    console.log("ℹ️ 未检测到 RENDER_EXTERNAL_URL，保活定时器未启动（本地开发模式）");
  }
});

// 扩展 Client 类型以包含 commands 属性
declare module "discord.js" {
  interface Client {
    commands: Collection<string, (typeof commands)[number]>;
  }
}

// 创建 Discord 客户端
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [
    Partials.Message,
    Partials.Reaction,
    Partials.User,
  ],
});

// 注册命令到客户端
client.commands = new Collection();
for (const command of commands) {
  client.commands.set(command.data.name, command);
}

// Bot 上线事件
client.once(Events.ClientReady, async (readyClient) => {
  console.log(`✅ Bot 已上线！登录为 ${readyClient.user.tag}`);
  console.log(`📊 已加入 ${readyClient.guilds.cache.size} 个服务器`);
  console.log(`🎮 已加载 ${client.commands.size} 个命令`);

  // 设置 Bot 状态
  readyClient.user.setActivity("被禁闭在卡尔克萨的哈利湖中");

  // 预热 Puppeteer 浏览器 (Canvas 模式下无需预热)
  // await warmupBrowser()
});

// 处理斜杠命令
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);

  if (!command) {
    console.error(`❌ 未找到命令: ${interaction.commandName}`);
    return;
  }

  try {
    await command.execute(interaction as ChatInputCommandInteraction);
  } catch (error) {
    console.error(`❌ 执行命令 ${interaction.commandName} 时出错:`, error);

    // 尝试回复错误消息，但如果交互已过期则忽略
    try {
      const errorMessage = "❌ 执行命令时发生错误！";
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: errorMessage, ephemeral: true });
      } else {
        await interaction.reply({ content: errorMessage, ephemeral: true });
      }
    } catch {
      // 交互可能已过期，忽略错误
      console.error("⚠️ 无法回复错误消息（交互可能已过期）");
    }
  }
});

// 监听海龟汤 Reaction 事件
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  try {
    await handleReactionAdd(reaction, user);
  } catch (error) {
    console.error("Error handling MessageReactionAdd:", error);
  }
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
  try {
    await handleReactionRemove(reaction, user);
  } catch (error) {
    console.error("Error handling MessageReactionRemove:", error);
  }
});

// 登录
const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error("❌ 错误：未找到 DISCORD_TOKEN 环境变量");
  process.exit(1);
}

// 诊断日志：检查 Token 格式（不会泄露完整 Token）
console.log(`🔑 DISCORD_TOKEN 已读取，长度: ${token.length}，前缀: ${token.substring(0, 5)}...`);

if (token.length < 50) {
  console.error("⚠️ 警告：Token 长度异常短，可能填错了（客户端密钥 ≠ Bot Token）");
}

// 调试事件：监听 Discord.js 内部状态
client.on("debug", (msg) => {
  // 只打印关键的连接相关日志，过滤掉心跳噪音
  if (msg.includes("Manager") || msg.includes("Gate") || msg.includes("Shard") || msg.includes("connect") || msg.includes("error")) {
    console.log(`[Discord 调试] ${msg}`);
  }
});
client.on("warn", (msg) => console.warn(`[Discord 警告] ${msg}`));
client.on("error", (err) => console.error(`[Discord 错误]`, err));

console.log("🔄 正在连接 Discord...");

// 网络诊断：测试能否访问 Discord API
console.log("🔍 [诊断] 测试出站网络连接...");
(async () => {
  try {
    const testRes = await fetch("https://discord.com/api/v10/gateway", { signal: AbortSignal.timeout(10_000) });
    const body = await testRes.text();
    console.log(`🔍 [诊断] HTTP ${testRes.status} | 响应前500字符: ${body.substring(0, 500)}`);
  } catch (err: any) {
    console.error(`❌ [诊断] 请求失败: ${err.message}`);
  }
})();


// 设置 30 秒超时，如果连接卡住至少能看到提示
const loginTimeout = setTimeout(() => {
  console.error("❌ Discord 登录超时（30 秒内未完成），可能是网络问题");
}, 30_000);

client.login(token)
  .then(() => {
    clearTimeout(loginTimeout);
    console.log("✅ Discord login() Promise 已 resolve");
  })
  .catch((error) => {
    clearTimeout(loginTimeout);
    console.error("❌ 登录失败：", error.message);
    process.exit(1);
  });
