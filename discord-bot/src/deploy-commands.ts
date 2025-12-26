import { REST, Routes } from 'discord.js'
import { config } from 'dotenv'
import { commands } from './commands/index.js'

// 加载环境变量
config()

const token = process.env.DISCORD_TOKEN
const clientId = process.env.CLIENT_ID

if (!token || !clientId) {
  console.error('❌ 错误：缺少 DISCORD_TOKEN 或 CLIENT_ID 环境变量')
  process.exit(1)
}

// 构建命令数据
const commandsData = commands.map(cmd => cmd.data.toJSON())

// 创建 REST 客户端
const rest = new REST({ version: '10' }).setToken(token)

async function deployCommands() {
  try {
    console.log(`🔄 正在注册 ${commandsData.length} 个斜杠命令...`)

    // 注册全局命令（所有服务器可用）
    const data = await rest.put(
      Routes.applicationCommands(clientId!),
      { body: commandsData },
    )

    console.log(`✅ 成功注册 ${(data as any[]).length} 个斜杠命令！`)
    console.log('命令列表：')
    commandsData.forEach(cmd => {
      console.log(`  - /${cmd.name}: ${cmd.description}`)
    })
  } catch (error) {
    console.error('❌ 注册命令失败：', error)
  }
}

deployCommands()
