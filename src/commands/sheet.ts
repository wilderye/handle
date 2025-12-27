import { AttachmentBuilder, ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js'
import { GameEngine } from '../game/engine.js'
import { generateCheatsheetScreenshot } from '../screenshot/index.js'

export const data = new SlashCommandBuilder()
  .setName('sheet')
  .setDescription('显示声母韵母速查表')

export async function execute(interaction: ChatInputCommandInteraction) {
  const channelId = interaction.channelId

  // 先延迟回复，防止超时
  await interaction.deferReply()

  // 检查是否有进行中的游戏
  if (!GameEngine.hasActiveGame(channelId)) {
    await interaction.editReply({
      content: '❌ 当前频道没有进行中的游戏！速查表需要在游戏中使用。',
    })
    return
  }

  try {
    // 获取符号状态并生成截图
    const states = GameEngine.getSymbolStates(channelId)
    const screenshot = await generateCheatsheetScreenshot(states)
    const attachment = new AttachmentBuilder(screenshot, { name: 'cheatsheet.png' })

    await interaction.editReply({
      content: '📋 **速查表**\n🟩 正确位置  🟨 存在但位置不对  ⬜ 已排除',
      files: [attachment],
    })
  } catch (error) {
    console.error('生成速查表截图失败:', error)
    
    // 回退到文字模式
    const states = GameEngine.getSymbolStates(channelId)
    
    let content = '📋 **速查表**\n\n'
    content += '**声母状态：**\n'
    for (const [symbol, state] of Object.entries(states.initials)) {
      const icon = state === 'exact' ? '🟩' : state === 'misplaced' ? '🟨' : '⬜'
      content += `${icon}${symbol} `
    }
    
    content += '\n\n**韵母状态：**\n'
    for (const [symbol, state] of Object.entries(states.finals)) {
      const icon = state === 'exact' ? '🟩' : state === 'misplaced' ? '🟨' : '⬜'
      content += `${icon}${symbol} `
    }

    await interaction.editReply({ content })
  }
}
