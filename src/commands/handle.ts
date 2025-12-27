import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js'
import { GameEngine } from '../game/engine.js'
import { TRIES_LIMIT } from '../logic/types.js'

export const data = new SlashCommandBuilder()
  .setName('handle')
  .setDescription('开始一局汉兜猜成语游戏')

export async function execute(interaction: ChatInputCommandInteraction) {
  const channelId = interaction.channelId

  // 检查是否已有进行中的游戏
  if (GameEngine.hasActiveGame(channelId)) {
    await interaction.reply({
      content: '❌ 当前频道已有进行中的游戏！请先完成或使用 `/giveup` 放弃。',
      ephemeral: true,
    })
    return
  }

  // 开始新游戏
  GameEngine.startGame(channelId)

  await interaction.reply({
    content: `🎮 **汉兜游戏开始！**\n\n` +
      `请使用 \`/guess 成语\` 来猜测四字成语\n` +
      `使用 \`/giveup\` 放弃\n` +
      `使用 \`/sheet\` 查看声母韵母速查表\n\n` +
      `⏳ 剩余猜测次数：${TRIES_LIMIT}`,
  })
}
