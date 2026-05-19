import { 
  ChatInputCommandInteraction, 
  SlashCommandBuilder, 
  PermissionsBitField,
  ComponentType
} from 'discord.js';
import { getSoupDB } from '../game/soup-db.js';

export const data = new SlashCommandBuilder()
  .setName('海龟汤')
  .setDescription('海龟汤情境推理游戏')
  .addSubcommand(subcommand =>
    subcommand
      .setName('开始')
      .setDescription('开始一局新的海龟汤')
      .addStringOption(option =>
        option
          .setName('汤面')
          .setDescription('输入海龟汤的谜面（汤面）')
          .setRequired(true)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('查看汤面')
      .setDescription('查看当前频道的海龟汤汤面')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('查看猜测历史')
      .setDescription('查看当前的猜测判定历史')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('开汤通知')
      .setDescription('艾特“喝汤人”通知大家开汤啦')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('结束')
      .setDescription('结束当前海龟汤游戏并公布最终汤底')
      .addStringOption(option =>
        option
          .setName('汤底')
          .setDescription('输入海龟汤的谜底（汤底，可选）')
          .setRequired(false)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('帮助')
      .setDescription('查看海龟汤游戏玩法说明与指令指南')
  );

// 表情与判定名称映射
const typeMapping = {
  yes: { name: '是', emoji: '✅' },
  no: { name: '不是', emoji: '❌' },
  yes_and_no: { name: '是也不是', emoji: '⭕' },
  irrelevant: { name: '无关', emoji: '🚫' },
  highlight: { name: '线索', emoji: '📌' }
};

const ITEMS_PER_PAGE = 8; // 每页展示的提问判定条数
const FLAG_COMPONENTS_V2 = 32768; // IS_COMPONENTS_V2 flag

// 辅助函数：构建猜测历史的 V2 Container 组件
async function buildHistoryV2Container(
  interaction: any,
  game: any,
  questions: any[],
  page: number,
  totalPages: number
): Promise<any> {
  const containerComponents: any[] = [
    {
      type: 10,
      content: `## 📖 《海龟汤》猜测与判定历史\n\n**汤面：**\n> ${game.riddle.replace(/\n/g, '\n> ')}`
    },
    {
      type: 14,
      divider: true,
      spacing: 1
    }
  ];

  if (questions.length === 0) {
    containerComponents.push({
      type: 10,
      content: `### 判定历史\n目前还没有记录任何判定。\n\n💡 **汤主快捷指南**：在喝汤人的提问消息下直接添加表情进行判定：\n✅ 是 | ❌ 不是 | ⭕ 是也不是 | 🚫 无关 | 📌 线索\n如果在表情旁附加 \`❗\` 或 \`‼️\`，则会被高亮归档为**重要线索**！`
    });
  } else {
    const startIndex = (page - 1) * ITEMS_PER_PAGE;
    const pageQuestions = questions.slice(startIndex, startIndex + ITEMS_PER_PAGE);

    let historyText = '';
    for (let i = 0; i < pageQuestions.length; i++) {
      const q = pageQuestions[i];
      const answerTypeKey = q.answerType as keyof typeof typeMapping;
      const typeInfo = typeMapping[answerTypeKey] || { name: '未知', emoji: '❓' };
      const importancePrefix = q.isImportant ? '🔥 **[重要线索]** ' : '';
      
      // 预解析用户名
      let rawName = '未知玩家';
      try {
        const member = await interaction.guild?.members.fetch(q.userId).catch(() => null);
        if (member) {
          rawName = member.displayName;
        } else {
          const user = await interaction.client.users.fetch(q.userId).catch(() => null);
          if (user) {
            rawName = user.displayName || user.username;
          }
        }
      } catch (err) {
        console.error('Failed to fetch user:', err);
      }

      // 名字截断逻辑：超过 6 个字截断，后面加上 ...
      const displayName = rawName.length > 6 ? rawName.substring(0, 6) + '...' : rawName;
      const globalIndex = startIndex + i + 1;
      
      historyText += `${globalIndex}. **${displayName}**: "${q.content}" ➡️ ${importancePrefix}${typeInfo.emoji} **${typeInfo.name}**\n`;
    }

    containerComponents.push({
      type: 10,
      content: `### 历史判定历史 (第 ${page}/${totalPages} 页，共 ${questions.length} 条)\n${historyText}`
    });
  }

  let hostName = '未知主持';
  try {
    const hostMember = await interaction.guild?.members.fetch(game.hostId).catch(() => null);
    hostName = hostMember?.displayName || '未知主持';
  } catch {}

  containerComponents.push(
    {
      type: 14,
      divider: true,
      spacing: 1
    },
    {
      type: 10,
      content: `*页码: ${page}/${totalPages} | 汤主: ${hostName} | 总计 ${questions.length} 条判定*`
    }
  );

  return {
    type: 17,
    accent_color: 15966994, // #f39c12
    components: containerComponents
  };
}

// 辅助函数：构建 V2 翻页按钮行
function buildHistoryV2ButtonsRow(page: number, totalPages: number, creatorId: string): any {
  return {
    type: 1,
    components: [
      {
        type: 2,
        style: 1, // Primary
        label: '上一页',
        custom_id: `soup_prev_${page - 1}_${creatorId}`,
        disabled: page <= 1
      },
      {
        type: 2,
        style: 1, // Primary
        label: '下一页',
        custom_id: `soup_next_${page + 1}_${creatorId}`,
        disabled: page >= totalPages
      }
    ]
  };
}

// 辅助函数：构建 V2 禁用状态下的翻页按钮行
function buildHistoryV2ButtonsRowDisabled(): any {
  return {
    type: 1,
    components: [
      {
        type: 2,
        style: 2, // Secondary
        label: '上一页',
        custom_id: 'disabled_prev',
        disabled: true
      },
      {
        type: 2,
        style: 2, // Secondary
        label: '下一页',
        custom_id: 'disabled_next',
        disabled: true
      }
    ]
  };
}

export async function execute(interaction: ChatInputCommandInteraction) {
  const subcommand = interaction.options.getSubcommand();
  const channelId = interaction.channelId;
  const db = getSoupDB();

  if (subcommand === '开始') {
    // 1. 开始新游戏
    const activeGame = await db.getGame(channelId);
    if (activeGame) {
      await interaction.reply({
        content: `❌ 当前频道已有一局进行中的海龟汤！主持人是 <@${activeGame.hostId}>。请先结束那一局。`,
        ephemeral: true
      });
      return;
    }

    const riddle = interaction.options.getString('汤面', true);
    await db.createGame(channelId, interaction.user.id, riddle);

    // 2. 赋予“海龟汤主持人”身份组
    let roleName = '海龟汤主持人';
    let role = interaction.guild?.roles.cache.find(r => r.name === roleName);
    if (!role && interaction.guild?.members.me?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      try {
        role = await interaction.guild.roles.create({
          name: roleName,
          color: '#f1c40f', // 金黄色
          reason: '海龟汤游戏自动创建的主持人身份组'
        });
      } catch (err: any) {
        console.error('自动创建身份组失败:', err.message);
      }
    }

    if (role) {
      const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
      if (member) {
        await member.roles.add(role).catch(err => console.error('赋予身份组失败:', err.message));
      }
    }

    // 3. 构建 V2 Container 界面并回复
    const v2Container = {
      type: 17,
      accent_color: 3066993, // #2ecc71 Green
      components: [
        {
          type: 10,
          content: `## 🟢 海龟汤开汤啦！\n\n**汤面：**\n> ${riddle.replace(/\n/g, '\n> ')}`
        },
        {
          type: 14,
          divider: true,
          spacing: 1
        },
        {
          type: 10,
          content: `**汤主（主持人）：** <@${interaction.user.id}>\n\n**如何参与？**\n喝汤人可以直接在频道发送提问消息，汤主通过在消息上贴表情进行表态，Bot 将自动归档！\n\n**💡 快捷表态指南：**\n\`✅\` 是 | \`❌\` 不是 | \`⭕\` 是也不是 | \`🚫\` 无关 | \`📌\` 线索\n如果在以上表情的基础上额外附加 \`❗\` 或 \`‼️\`，该问答会被归档为**重要线索**！`
        }
      ]
    };

    await interaction.reply({
      flags: FLAG_COMPONENTS_V2,
      components: [v2Container]
    });
    return;
  }

  if (subcommand === '查看汤面') {
    const game = await db.getGame(channelId);
    if (!game) {
      await interaction.reply({ content: '❌ 当前频道没有进行中的海龟汤！', ephemeral: true });
      return;
    }

    const v2Container = {
      type: 17,
      accent_color: 3447003, // #3498db Blue
      components: [
        {
          type: 10,
          content: `## 🍜 当前海龟汤汤面\n\n**汤主：** <@${game.hostId}>\n\n> ${game.riddle.replace(/\n/g, '\n> ')}`
        },
        {
          type: 14,
          divider: true,
          spacing: 1
        },
        {
          type: 10,
          content: `💡 *使用 \`/海龟汤 查看猜测历史\` 随时查看已判定和线索历史！*`
        }
      ]
    };

    await interaction.reply({
      flags: FLAG_COMPONENTS_V2,
      components: [v2Container]
    });
    return;
  }

  if (subcommand === '查看猜测历史') {
    const game = await db.getGame(channelId);
    if (!game) {
      await interaction.reply({ content: '❌ 当前频道没有进行中的海龟汤！', ephemeral: true });
      return;
    }

    const questions = await db.getQuestionsForGame(channelId);
    const totalPages = Math.ceil(questions.length / ITEMS_PER_PAGE) || 1;
    const initialPage = 1;
    const creatorId = interaction.user.id;

    // 构建初始 V2 Container 和 V2 按钮行
    const v2Container = await buildHistoryV2Container(interaction, game, questions, initialPage, totalPages);
    const v2ButtonsRow = buildHistoryV2ButtonsRow(initialPage, totalPages, creatorId);

    const response = await interaction.reply({
      flags: FLAG_COMPONENTS_V2,
      components: totalPages > 1 ? [v2Container, v2ButtonsRow] : [v2Container],
      fetchReply: true
    });

    if (totalPages > 1) {
      const collector = response.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 120_000 // 2分钟交互时长
      });

      collector.on('collect', async i => {
        // 提取翻页操作的 customId: soup_[prev/next]_[page]_[creatorId]
        const parts = i.customId.split('_');
        const targetPage = parseInt(parts[2], 10);
        const ownerId = parts[3];

        // 应对多个玩家操作一个面板的核心安全交互逻辑
        if (i.user.id !== ownerId) {
          await i.reply({
            content: '❌ 只有开启此面板的玩家才能翻页！您可以输入 `/海龟汤 查看猜测历史` 创建专属您的交互面板。',
            ephemeral: true
          });
          return;
        }

        // 重新获取最新的数据库数据（应对翻页时可能产生的新提问归档）
        const latestGame = await db.getGame(channelId);
        if (!latestGame) {
          await i.update({
            content: '❌ 游戏已结束。',
            embeds: [],
            components: []
          });
          collector.stop();
          return;
        }

        const latestQuestions = await db.getQuestionsForGame(channelId);
        const latestTotalPages = Math.ceil(latestQuestions.length / ITEMS_PER_PAGE) || 1;

        // 边界保护
        let activePage = targetPage;
        if (activePage > latestTotalPages) activePage = latestTotalPages;
        if (activePage < 1) activePage = 1;

        const updatedV2Container = await buildHistoryV2Container(i, latestGame, latestQuestions, activePage, latestTotalPages);
        const updatedV2Buttons = buildHistoryV2ButtonsRow(activePage, latestTotalPages, ownerId);

        await i.update({
          flags: FLAG_COMPONENTS_V2,
          components: [updatedV2Container, updatedV2Buttons]
        });
      });

      collector.on('end', async () => {
        // 交互超时后自动禁用按钮，保持美观且避免死锁
        const latestGame = await db.getGame(channelId);
        if (latestGame) {
          const latestQuestions = await db.getQuestionsForGame(channelId);
          const latestTotalPages = Math.ceil(latestQuestions.length / ITEMS_PER_PAGE) || 1;
          const expiredContainer = await buildHistoryV2Container(interaction, latestGame, latestQuestions, 1, latestTotalPages);
          const disabledV2Buttons = buildHistoryV2ButtonsRowDisabled();
          await interaction.editReply({
            flags: FLAG_COMPONENTS_V2,
            components: [expiredContainer, disabledV2Buttons]
          }).catch(() => {});
        }
      });
    }
    return;
  }

  if (subcommand === '开汤通知') {
    const game = await db.getGame(channelId);
    if (!game) {
      await interaction.reply({ content: '❌ 当前频道没有进行中的海龟汤！', ephemeral: true });
      return;
    }

    const playRole = interaction.guild?.roles.cache.find(r => r.name === '喝汤人');
    const pingText = playRole ? `<@&${playRole.id}>` : '@喝汤人';

    await interaction.reply({
      content: `📢 ${pingText} **汤主已开汤，快来喝汤！**\n\n**汤面：**\n> ${game.riddle.replace(/\n/g, '\n> ')}\n\n💡 *使用 \`/海龟汤 查看汤面\` 随时查看汤面，直接提问即可参与推理！*`
    });
    return;
  }

  if (subcommand === '结束') {
    const game = await db.getGame(channelId);
    if (!game) {
      await interaction.reply({ content: '❌ 当前频道没有进行中的海龟汤！', ephemeral: true });
      return;
    }

    // 权限校验：只有主持人或者管理员可以结束游戏
    const isHost = interaction.user.id === game.hostId;
    const isAdmin = interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator);
    if (!isHost && !isAdmin) {
      await interaction.reply({
        content: '❌ 只有主持人（或服务器管理员）才能结束这局海龟汤！',
        ephemeral: true
      });
      return;
    }

    // 1. 获取判定历史以进行结案汇总
    const questions = await db.getQuestionsForGame(channelId);

    // 2. 清除游戏状态（级联删除 questions）
    await db.deleteGame(channelId);

    // 3. 剥夺“海龟汤主持人”身份组
    const role = interaction.guild?.roles.cache.find(r => r.name === '海龟汤主持人');
    if (role) {
      const hostMember = await interaction.guild?.members.fetch(game.hostId).catch(() => null);
      if (hostMember) {
        await hostMember.roles.remove(role).catch(err => console.error('移除身份组失败:', err.message));
      }
    }

    // 4. 构建 V2 结算总结界面并回复
    const answer = interaction.options.getString('汤底') || '*由主持人线下公布或未设置汤底*';

    let historyText = '';
    if (questions.length > 0) {
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const answerTypeKey = q.answerType as keyof typeof typeMapping;
        const typeInfo = typeMapping[answerTypeKey] || { name: '未知', emoji: '❓' };
        const importancePrefix = q.isImportant ? '🔥 **[重要线索]** ' : '';
        
        let rawName = '未知玩家';
        try {
          const member = await interaction.guild?.members.fetch(q.userId).catch(() => null);
          if (member) {
            rawName = member.displayName;
          } else {
            const user = await interaction.client.users.fetch(q.userId).catch(() => null);
            if (user) {
              rawName = user.displayName || user.username;
            }
          }
        } catch {}
        const displayName = rawName.length > 6 ? rawName.substring(0, 6) + '...' : rawName;
        
        historyText += `${i + 1}. **${displayName}**: "${q.content}" ➡️ ${importancePrefix}${typeInfo.emoji} **${typeInfo.name}**\n`;
      }
      
      if (historyText.length > 1000) {
        historyText = historyText.substring(0, 970) + '\n...（历史记录过长已截断）';
      }
    }

    const v2Container = {
      type: 17,
      accent_color: 10181046, // #9b59b6 Purple
      components: [
        {
          type: 10,
          content: `## 🏁 海龟汤结汤啦！\n\n**汤面：**\n> ${game.riddle.replace(/\n/g, '\n> ')}\n\n**汤底（谜底）：**\n> ${answer.replace(/\n/g, '\n> ')}`
        },
        {
          type: 14,
          divider: true,
          spacing: 1
        },
        {
          type: 10,
          content: `### 📊 喝汤历史回顾\n${historyText || '本局没有任何判定的提问。'}`
        },
        {
          type: 14,
          divider: true,
          spacing: 1
        },
        {
          type: 10,
          content: `**游戏总结：**\n本局汤主：<@${game.hostId}>\n感谢所有喝汤人的积极提问与精彩推理！`
        }
      ]
    };

    await interaction.reply({
      flags: FLAG_COMPONENTS_V2,
      components: [v2Container]
    });
    return;
  }

  if (subcommand === '帮助') {
    // 5. 构建 V2 帮助说明界面并回复
    const v2Container = {
      type: 17,
      accent_color: 1940636, // #1d9c9c Teal
      components: [
        {
          type: 10,
          content: `## 🐢 海龟汤情境推理游戏说明\n\n海龟汤是一款情境推理游戏。汤主（主持人）会给出一个不完整且难以理解的事件（**汤面**），喝汤人（玩家）通过提出只能用“是”、“不是”或“无关”回答的提问来揭开谜底（**汤底**）。`
        },
        {
          type: 14,
          divider: true,
          spacing: 1
        },
        {
          type: 10,
          content: `### 📝 快捷指令一览\n* \`/海龟汤 开始 [汤面]\` —— 开始一局新的海龟汤并成为汤主\n* \`/海龟汤 查看汤面\` —— 随时查看当前的汤面\n* \`/海龟汤 查看猜测历史\` —— 查看包含所有归档提问的分页历史面板\n* \`/海龟汤 开汤通知\` —— 艾特 \`@喝汤人\` 通知大家来猜谜\n* \`/海龟汤 结束 [汤底]\` —— 结汤并公布最终谜底与历史回顾（仅汤主或管理员可用）\n* \`/海龟汤 帮助\` —— 显示此帮助说明`
        },
        {
          type: 14,
          divider: true,
          spacing: 1
        },
        {
          type: 10,
          content: `### 🎯 汤主 Emoji 快捷判定指南\n汤主不需要使用任何繁杂的命令，只需**直接在玩家提问的消息下贴表情**，Bot 就会自动识别并归档：\n* \`✅\` ➡️ **是**\n* \`❌\` ➡️ **不是**\n* \`⭕\` ➡️ **是也不是**\n* \`🚫\` ➡️ **无关**\n* \`📌\` ➡️ **线索**（仅划重点）\n\n🔥 **重要线索判定：**\n如果汤主对某条玩家消息同时贴上了以上核心表情之一以及 \`❗\` 或 \`‼️\`（感叹号），Bot 就会将该项归档为**重要线索**，并在历史中高亮显示！`
        }
      ]
    };

    await interaction.reply({
      flags: FLAG_COMPONENTS_V2,
      components: [v2Container]
    });
    return;
  }
}
