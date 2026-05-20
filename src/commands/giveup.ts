import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js'
import { GameEngine } from '../game/engine.js'

export const data = new SlashCommandBuilder()
  .setName('giveup')
  .setDescription('放弃当前游戏并公布答案')

export async function execute(interaction: ChatInputCommandInteraction) {
  const channelId = interaction.channelId

  // 检查是否有进行中的游戏
  if (!GameEngine.hasActiveGame(channelId)) {
    await interaction.reply({
      content: '❌ 当前频道没有进行中的游戏！',
      ephemeral: true,
    })
    return
  }

  const game = GameEngine.getGame(channelId)
  const tryCount = game?.tries.length || 0
  const endResult = await GameEngine.endGame(channelId)

  await interaction.reply({
    content: `🏳️ **游戏已放弃**\n\n` +
      `正确答案是：**${endResult?.answer}**\n` +
      `共猜测了 ${tryCount} 次`,
  })
}
