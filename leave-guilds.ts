import { Client, GatewayIntentBits } from 'discord.js';
import * as dotenv from 'dotenv';

dotenv.config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log(`✅ 已登录: ${client.user?.tag}`);
  
  const guilds = client.guilds.cache;
  console.log(`🤖 机器人当前共加入了 ${guilds.size} 个服务器。`);

  if (guilds.size === 0) {
    console.log('没有需要退出的服务器。');
    process.exit(0);
  }

  for (const guild of guilds.values()) {
    try {
      console.log(`准备退出服务器: [${guild.name}] (ID: ${guild.id})...`);
      await guild.leave();
      console.log(`✅ 成功退出: ${guild.name}`);
    } catch (error) {
      console.error(`❌ 退出服务器 ${guild.name} 失败:`, error);
    }
  }

  console.log('🎉 所有服务器已退出完毕！如果你还要测试，请记得去 Discord 开发者后台重新生成邀请链接把 Bot 拉回你的主服务器。');
  process.exit(0);
});

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('找不到 DISCORD_TOKEN 环境变量');
  process.exit(1);
}

client.login(token);
