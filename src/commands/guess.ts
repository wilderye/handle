import { AttachmentBuilder, ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js'
import { GameEngine } from '../game/engine.js'
import { TRIES_LIMIT } from '../logic/types.js'
import { generateGameBoardScreenshot } from '../screenshot/index.js'

export const data = new SlashCommandBuilder()
  .setName('guess')
  .setDescription('猜测成语')
  .addStringOption(option =>
    option
      .setName('idiom')
      .setDescription('输入四字成语')
      .setRequired(true)
  )

export async function execute(interaction: ChatInputCommandInteraction) {
  const channelId = interaction.channelId
  const userId = interaction.user.id
  const input = interaction.options.getString('idiom', true)

  // 先延迟回复，防止超时
  await interaction.deferReply()

  // 检查是否有进行中的游戏
  if (!GameEngine.hasActiveGame(channelId)) {
    await interaction.editReply({
      content: '❌ 当前频道没有进行中的游戏！请先使用 `/handle` 开始游戏。',
    })
    return
  }

  // 处理猜测
  const result = GameEngine.processGuess(channelId, userId, input)

  if (!result.success) {
    await interaction.editReply({
      content: `❌ 你猜测的 **${input}** ${result.error}`,
    })
    return
  }



  try {
    // 获取游戏面板数据并生成截图
    const boardData = GameEngine.getGameBoardData(channelId)
    const game = GameEngine.getGame(channelId)
    const tryCount = game?.tries.length || 0

    let content = `📝 第 ${tryCount} 次猜测：**${input}**\n\n`
    let attachment: AttachmentBuilder | undefined

    if (boardData) {
      const screenshot = await generateGameBoardScreenshot(boardData)
      attachment = new AttachmentBuilder(screenshot, { name: 'game-board.png' })
    }

    if (result.isWin) {
      // 猜中了
      const endResult = await GameEngine.endGame(channelId, userId)
      content += `🎉 **恭喜猜中！** 答案是：**${endResult?.answer}**\n`
      content += `用了 ${tryCount} 次猜测`
    } else if (result.isFail) {
      // 满次数失败
      const endResult = await GameEngine.endGame(channelId)
      content += `😢 **游戏结束！** 已用完 ${TRIES_LIMIT} 次机会\n`
      content += `正确答案是：**${endResult?.answer}**`
    } else {
      // 继续游戏
      content += `⏳ 剩余猜测次数：${result.triesLeft}`
    }

    await interaction.editReply({
      content,
      files: attachment ? [attachment] : [],
    })
  } catch (error) {
    console.error('生成截图失败:', error)
    // 回退到文字模式
    const game = GameEngine.getGame(channelId)
    const tryCount = game?.tries.length || 0
    
    let content = `📝 第 ${tryCount} 次猜测：**${input}**\n\n`
    
    if (result.result) {
      const symbols = result.result.map(r => {
        if (r.char === 'exact') return '🟩'
        if (r.char === 'misplaced') return '🟨'
        return '⬜'
      })
      content += symbols.join('') + '\n\n'
    }

    if (result.isWin) {
      const endResult = await GameEngine.endGame(channelId, userId)
      content += `🎉 **恭喜猜中！** 答案是：**${endResult?.answer}**`
    } else if (result.isFail) {
      const endResult = await GameEngine.endGame(channelId)
      content += `😢 **游戏结束！** 正确答案是：**${endResult?.answer}**`
    } else {
      content += `⏳ 剩余猜测次数：${result.triesLeft}`
    }

    await interaction.editReply({ content })
  }
}
