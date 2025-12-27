import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js'
import { GameEngine } from '../game/engine.js'

export const data = new SlashCommandBuilder()
  .setName('hint')
  .setDescription('获取提示（显示答案中的一个字）')

export async function execute(interaction: ChatInputCommandInteraction) {
  const channelId = interaction.channelId

  // 检查是否有进行中的游戏
  if (!GameEngine.hasActiveGame(channelId)) {
    await interaction.reply({
      content: '❌ 当前频道没有进行中的游戏！请先使用 `/handle` 开始游戏。',
      ephemeral: true,
    })
    return
  }

  const hint = GameEngine.getHint(channelId)

  await interaction.reply({
    content: `💡 **提示**：答案中包含「**${hint}**」字`,
  })
}
