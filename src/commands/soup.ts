import {
  ChatInputCommandInteraction,
  ButtonInteraction,
  SlashCommandBuilder,
  PermissionsBitField,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} from 'discord.js';
import { getSoupDB } from '../game/soup-db.js';
import {
  addHostRoleToMember,
  memberHasHostRole,
  removeHostRoleFromMember,
} from '../game/discord-roles.js';
import {
  consumeSoupRegistration,
  createSoupRegistration,
  formatSoupRegistrationDm,
  formatSoupRegistrationFailureNotice,
  formatSoupRegistrationMessage,
  hasSoupRegistration,
  SOUP_REGISTRATION_EMOJI,
} from '../game/soup-registration.js';

export const data = new SlashCommandBuilder()
  .setName('海龟汤')
  .setDescription('海龟汤情境推理游戏')
  .addSubcommand(sub => sub
    .setName('报名阶段')
    .setDescription('进入报名阶段，并在游戏开始后私信通知报名者。')
  )
  .addSubcommand(sub => sub
    .setName('开始')
    .setDescription('开一局新的海龟汤 (将会弹出输入框填写汤面)')
  )
  .addSubcommand(sub => sub.setName('查看汤面').setDescription('查看当前汤面'))
  // .addSubcommand(sub => sub.setName('查看猜测历史').setDescription('查看判定记录'))
  .addSubcommand(sub => sub.setName('开汤通知').setDescription('通知喝汤人开汤了'))
  .addSubcommand(sub => sub
    .setName('结束')
    .setDescription('结束当前海龟汤 (将会弹出输入框填写汤底)')
  )
  .addSubcommand(sub => sub.setName('帮助').setDescription('查看玩法与指令说明'));

// ── 常量 ──
const ANSWER_TYPES: Record<string, { label: string; emoji: string }> = {
  yes: { label: '是', emoji: '✅' },
  no: { label: '不是', emoji: '❌' },
  yes_and_no: { label: '是也不是', emoji: '⭕' },
  irrelevant: { label: '无关', emoji: '🚫' },
};
const PER_PAGE = 8;

// ── V2 组件工厂 ──
const text = (content: string) => ({ type: 10, content });
const sep = () => ({ type: 14, divider: true, spacing: 1 });
const box = (children: any[]) => ({
  type: 17, components: children,
});
const pageButtons = (page: number, total: number, uid: string) => ({
  type: 1,
  components: [
    { type: 2, style: 1, label: '上一页', custom_id: `soup_page_${page - 1}_${uid}`, disabled: page <= 1 },
    { type: 2, style: 1, label: '下一页', custom_id: `soup_page_${page + 1}_${uid}`, disabled: page >= total },
  ],
});

// ── 名字缓存（避免重复 REST 调用经 WARP 代理） ──
const nameCache = new Map<string, { name: string; ts: number }>();
const NAME_CACHE_TTL = 10 * 60 * 1000; // 10 分钟

async function resolveDisplayName(interaction: any, userId: string): Promise<string> {
  const cached = nameCache.get(userId);
  if (cached && Date.now() - cached.ts < NAME_CACHE_TTL) return cached.name;
  try {
    const member = await interaction.guild?.members.fetch(userId).catch(() => null);
    const raw = member?.displayName
      ?? (await interaction.client.users.fetch(userId).catch(() => null))?.displayName
      ?? '未知';
    const name = raw.length > 6 ? raw.slice(0, 6) + '...' : raw;
    nameCache.set(userId, { name, ts: Date.now() });
    return name;
  } catch { return '未知'; }
}

// ── 辅助：通过名称查找身份组（先 fetch 确保缓存） ──
async function findRoleByName(guild: any, name: string) {
  let role = guild.roles.cache.find((r: any) => r.name === name);
  if (!role) {
    await guild.roles.fetch();
    role = guild.roles.cache.find((r: any) => r.name === name);
  }
  return role ?? null;
}

// ── 构建历史页面 ──
async function buildHistoryPage(interaction: any, questions: any[], page: number, total: number) {
  if (questions.length === 0) {
    return box([text('### 📋 判定记录\n暂无记录。')]);
  }
  const start = (page - 1) * PER_PAGE;
  const slice = questions.slice(start, start + PER_PAGE);
  // 并行解析所有用户名（经 WARP 的 REST 调用）
  const names = await Promise.all(slice.map(q => resolveDisplayName(interaction, q.userId)));
  let lines = '';
  for (let i = 0; i < slice.length; i++) {
    const q = slice[i];
    const t = ANSWER_TYPES[q.answerType] ?? { emoji: '❓' };
    const important = q.isImportant ? ' ‼️' : '';
    lines += `${start + i + 1}. **${names[i]}**：${q.content} ${t.emoji}${important}\n`;
  }
  return box([
    text(`### 📋 判定记录 (${page}/${total})\n${lines}`),
  ]);
}

// ── 主命令处理 ──
export async function execute(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();
  const ch = interaction.channelId;
  const db = getSoupDB();

  // ── 报名阶段 ──
  if (sub === '报名阶段') {
    const existing = await db.getGame(ch);
    if (existing) {
      await interaction.reply({ content: '❌ 本频道已有进行中的海龟汤，不能开启新的报名阶段。', ephemeral: true });
      return;
    }

    if (hasSoupRegistration(ch)) {
      await interaction.reply({ content: '❌ 本频道已有海龟汤报名阶段。', ephemeral: true });
      return;
    }

    await interaction.reply({
      components: [box([text(formatSoupRegistrationMessage())])],
      flags: MessageFlags.IsComponentsV2,
    });

    const message = await interaction.fetchReply();
    const result = createSoupRegistration(ch, message.id);
    if (!result.ok) {
      await interaction.followUp({ content: '❌ 本频道已有海龟汤报名阶段。', ephemeral: true });
      return;
    }

    try {
      await message.react(SOUP_REGISTRATION_EMOJI);
    } catch (error) {
      console.error('[Soup] 添加报名反应失败:', error);
      await interaction.followUp({
        content: `⚠️ 无法添加 ${SOUP_REGISTRATION_EMOJI} 反应，请检查 Bot 的消息反应权限。`,
        ephemeral: true,
      });
    }
    return;
  }

  // ── 开始 ──
  if (sub === '开始') {
    const existing = await db.getGame(ch);
    if (existing) {
      await interaction.reply({ content: `❌ 本频道已有进行中的海龟汤（汤主：<@${existing.hostId}>）`, ephemeral: true });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId('soup_start_modal')
      .setTitle('海龟汤开局');

    const riddleInput = new TextInputBuilder()
      .setCustomId('riddle_input')
      .setLabel('请输入汤面 (支持换行)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);

    const actionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(riddleInput);
    modal.addComponents(actionRow);

    await interaction.showModal(modal);

    let submitted;
    try {
      submitted = await interaction.awaitModalSubmit({
        time: 300_000,
        filter: i => i.user.id === interaction.user.id && i.customId === 'soup_start_modal',
      });
    } catch (e) {
      return; // 超时或取消
    }

    await submitted.deferReply();
    const riddle = submitted.fields.getTextInputValue('riddle_input');
    await db.createGame(ch, submitted.user.id, riddle);

    const roleMsg = submitted.guild
      ? await addHostRoleToMember(submitted.guild, submitted.user.id, '海龟汤开局')
      : '';

    await submitted.editReply({
      components: [box([
        text(`## 🍲 海龟汤开局\n\n${riddle}\n\n汤主：<@${submitted.user.id}>\n表情判定：✅是  ❌/❎不是  ⭕是也不是  🚫无关  ‼️重要  📌标注${roleMsg}`),
      ])],
      flags: MessageFlags.IsComponentsV2,
    });

    const failedDmNames = await notifySoupRegistrants(submitted, ch);
    if (failedDmNames.length > 0) {
      await submitted.followUp({
        content: formatSoupRegistrationFailureNotice(failedDmNames),
        ephemeral: true,
      });
    }
    return;
  }

  // ── 查看汤面 ──
  if (sub === '查看汤面') {
    const game = await db.getGame(ch);
    if (!game) { await interaction.reply({ content: '❌ 当前没有进行中的海龟汤。', ephemeral: true }); return; }

    await interaction.reply({
      components: [box([
        text(`## 🍲 汤面\n\n${game.riddle}`),
      ])],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  /*
  // ── 查看猜测历史（已隐藏） ──
  if (sub === '查看猜测历史') {
    const game = await db.getGame(ch);
    if (!game) { await interaction.reply({ content: '❌ 当前没有进行中的海龟汤。', ephemeral: true }); return; }

    await interaction.deferReply();
    const questions = await db.getQuestionsForGame(ch);
    const totalPages = Math.max(1, Math.ceil(questions.length / PER_PAGE));
    const uid = interaction.user.id;
    const histContainer = await buildHistoryPage(interaction, questions, 1, totalPages);
    const components: any[] = [histContainer];
    if (totalPages > 1) components.push(pageButtons(1, totalPages, uid));

    await interaction.editReply({
      components,
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }
  */

  // ── 开汤通知（仅持有「海龟汤主持人」身份组可用） ──
  if (sub === '开汤通知') {
    const game = await db.getGame(ch);
    if (!game) { await interaction.reply({ content: '❌ 当前没有进行中的海龟汤。', ephemeral: true }); return; }

    // 检查身份组而非数据库记录
    const member = interaction.guild
      ? await interaction.guild.members.fetch(interaction.user.id).catch(() => null)
      : null;
    const hasHostRole = member ? memberHasHostRole(member) : false;
    if (!hasHostRole) {
      await interaction.reply({ content: '❌ 只有持有「主持人」身份组的人可以发送开汤通知。', ephemeral: true });
      return;
    }

    const guild = interaction.guild;
    let role = null;
    if (guild) {
      role = await findRoleByName(guild, '喝汤人');
    }
    if (!role) {
      await interaction.reply({ content: '⚠️ 未找到「喝汤人」身份组，请先在服务器设置中创建。', ephemeral: true });
      return;
    }
    await interaction.reply({
      content: `📢 <@&${role.id}> 海龟汤开局了，快来提问！`,
      allowedMentions: { parse: ['roles'] }
    });
    return;
  }

  // ── 结束 ──
  if (sub === '结束') {
    const game = await db.getGame(ch);
    if (!game) { await interaction.reply({ content: '❌ 当前没有进行中的海龟汤。', ephemeral: true }); return; }

    const isHost = interaction.user.id === game.hostId;
    const isAdmin = interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator);
    if (!isHost && !isAdmin) {
      await interaction.reply({ content: '❌ 只有汤主或管理员可以结束游戏。', ephemeral: true });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId('soup_end_modal')
      .setTitle('海龟汤结局');

    const answerInput = new TextInputBuilder()
      .setCustomId('answer_input')
      .setLabel('请输入汤底 (支持换行，不填则不显示)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false);

    const actionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(answerInput);
    modal.addComponents(actionRow);

    await interaction.showModal(modal);

    let submitted;
    try {
      submitted = await interaction.awaitModalSubmit({
        time: 300_000,
        filter: i => i.user.id === interaction.user.id && i.customId === 'soup_end_modal',
      });
    } catch (e) {
      return; // 超时或取消
    }

    await submitted.deferReply();
    await db.deleteGame(ch);

    const answerText = submitted.fields.getTextInputValue('answer_input');
    const answerSection = answerText ? `\n\n**汤底：**\n${answerText}` : '';

    await submitted.editReply({
      components: [box([
        text(`## 🏁 海龟汤结束\n\n**汤面：**\n${game.riddle}${answerSection}\n\n感谢各位参与！`),
      ])],
      flags: MessageFlags.IsComponentsV2,
    });

    // 异步移除身份组（不阻塞用户响应）
    if (submitted.guild) {
      const guildRef = submitted.guild;
      removeHostRoleFromMember(guildRef, game.hostId, '海龟汤结束').catch(() => { });
    }
    return;
  }

  // ── 帮助 ──
  if (sub === '帮助') {
    await interaction.reply({
      components: [box([
        text(`## 🐢 海龟汤玩法\n\n汤主出谜面，喝汤人提问，汤主用表情判定。`),
        sep(),
        // 已隐藏：`/海龟汤 查看猜测历史` 看判定记录
        text(`### 指令\n\`/海龟汤 报名阶段\` 可选流程。让想在本局开汤时收到私信提醒的人先报名；不使用报名阶段也可以直接 \`/海龟汤 开始\`。\n\`/海龟汤 开始 [汤面]\` 开局\n\`/海龟汤 查看汤面\` 看汤面\n\`/海龟汤 开汤通知\` 通知喝汤人\n\`/海龟汤 结束 [汤底]\` 结局\n\`/海龟汤 帮助\` 本说明`),
        sep(),
        text(`### 表情判定\n汤主在玩家提问消息下贴表情即可：\n✅ 是　❌/❎ 不是　⭕ 是也不是　🚫 无关　‼️ 重要　📌 标注消息`),
      ])],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }
}

async function notifySoupRegistrants(interaction: any, channelId: string): Promise<string[]> {
  const registration = consumeSoupRegistration(channelId);
  if (!registration) return [];

  const channel = interaction.channel;
  if (!channel || !('messages' in channel)) return [];

  const message = await channel.messages.fetch(registration.messageId).catch(() => null);
  if (!message) return [];

  const reaction = message.reactions.cache.find((candidate: any) => candidate.emoji.name === SOUP_REGISTRATION_EMOJI);
  if (!reaction) return [];

  const users = await reaction.users.fetch().catch(() => null);
  if (!users) return [];

  const failedNames: string[] = [];
  for (const user of users.filter((candidate: any) => !candidate.bot).values()) {
    try {
      await user.send({
        components: [box([text(formatSoupRegistrationDm())])],
        flags: MessageFlags.IsComponentsV2,
      });
    } catch (error) {
      console.error(`[Soup] 私信报名者 ${user.id} 失败:`, error);
      failedNames.push(await resolveDisplayName(interaction, user.id));
    }
  }

  return failedNames;
}

// ── 翻页按钮处理（由 index.ts 全局调用） ──
export async function handleSoupButton(interaction: ButtonInteraction) {
  // custom_id: soup_page_{targetPage}_{ownerId}
  const parts = interaction.customId.split('_');
  const targetPage = parseInt(parts[2], 10);
  const ownerId = parts[3];

  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: '❌ 只有发起查询的玩家可以翻页。', ephemeral: true });
    return;
  }

  await interaction.deferUpdate();

  const db = getSoupDB();
  const game = await db.getGame(interaction.channelId);
  if (!game) {
    await interaction.editReply({
      components: [box([text('### 📋 判定记录\n游戏已结束。')])],
    });
    return;
  }

  const questions = await db.getQuestionsForGame(interaction.channelId);
  const totalPages = Math.max(1, Math.ceil(questions.length / PER_PAGE));
  const page = Math.max(1, Math.min(targetPage, totalPages));

  const histContainer = await buildHistoryPage(interaction, questions, page, totalPages);
  const components: any[] = [histContainer];
  if (totalPages > 1) components.push(pageButtons(page, totalPages, ownerId));

  await interaction.editReply({ components });
}
