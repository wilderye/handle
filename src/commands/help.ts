import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("help")
  .setDescription("查看汉兜游戏的玩法说明");

export async function execute(interaction: ChatInputCommandInteraction) {
  const embed = new EmbedBuilder()
    .setColor(0x1d9c9c)
    .setTitle("🎮 汉兜游戏说明")
    .setDescription("猜出隐藏的四字成语，每次猜测后会显示匹配情况。")
    .addFields(
      {
        name: "🎨 颜色含义",
        value:
          "🟢 **绿色**：完全正确\n🟠 **橙色**：存在但位置错误\n⚪ **灰色**：不存在于答案中",
        inline: true,
      },
      {
        name: "🔤 拼音组成",
        value:
          "**声母**（zh, ch, sh...）\n**韵母**（ang, ing...）\n**声调**（1-4 声）",
        inline: true,
      },
      {
        name: "📝 可用命令",
        value:
          "`/handle` 开始新游戏\n`/guess 成语` 猜测\n`/sheet` 速查表\n`/giveup` 放弃\n`/stats` 统计",
        inline: false,
      },
      {
        name: "💡 小技巧",
        value: "• 先猜常见成语排除拼音\n• 善用速查表分析\n• 注意声调线索！",
        inline: false,
      }
    )
    .setFooter({ text: "祝你玩得开心！🎉" });

  await interaction.reply({
    embeds: [embed],
  });
}
