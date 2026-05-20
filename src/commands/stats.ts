import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js'
import { GameEngine } from '../game/engine.js'

export const data = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('查看游戏统计')
  .addUserOption(option =>
    option
      .setName('user')
      .setDescription('要查看的用户（不填则查看自己）')
      .setRequired(false)
  )

export async function execute(interaction: ChatInputCommandInteraction) {
  const targetUser = interaction.options.getUser('user') || interaction.user
  const stats = await GameEngine.getPlayerStats(targetUser.id)

  await interaction.reply({
    content: `📊 **玩家统计** - ${targetUser.username}\n\n` +
      `🎮 参与局数：${stats.oddsPlayedGames}\n` +
      `🏆 猜中局数：${stats.wonGames}\n` +
      `📈 胜率：${stats.winRate}`,
  })
}
