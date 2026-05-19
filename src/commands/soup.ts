import {
  ChatInputCommandInteraction,
  ButtonInteraction,
  SlashCommandBuilder,
  PermissionsBitField,
  MessageFlags,
} from 'discord.js';
import { getSoupDB } from '../game/soup-db.js';

export const data = new SlashCommandBuilder()
  .setName('海龟汤')
  .setDescription('海龟汤情境推理游戏')
  .addSubcommand(sub => sub
    .setName('开始')
    .setDescription('开一局新的海龟汤')
    .addStringOption(opt => opt.setName('汤面').setDescription('谜面内容').setRequired(true))
  )
  .addSubcommand(sub => sub.setName('查看汤面').setDescription('查看当前汤面'))
  .addSubcommand(sub => sub.setName('查看猜测历史').setDescription('查看判定记录'))
  .addSubcommand(sub => sub.setName('开汤通知').setDescription('通知喝汤人开汤了'))
  .addSubcommand(sub => sub
    .setName('结束')
    .setDescription('结束当前海龟汤')
    .addStringOption(opt => opt.setName('汤底').setDescription('谜底内容（可选）').setRequired(false))
  )
  .addSubcommand(sub => sub.setName('帮助').setDescription('查看玩法与指令说明'));

// ── 常量 ──
const ANSWER_TYPES: Record<string, { label: string; emoji: string }> = {
  yes:         { label: '是',     emoji: '✅' },
  no:          { label: '不是',   emoji: '❌' },
  yes_and_no:  { label: '是也不是', emoji: '⭕' },
  irrelevant:  { label: '无关',   emoji: '🚫' },
  highlight:   { label: '线索',   emoji: '📌' },
};
const PER_PAGE = 8;

// ── V2 组件工厂 ──
const text = (content: string) => ({ type: 10, content });
const sep  = ()                => ({ type: 14, divider: true, spacing: 1 });
const container = (color: number, children: any[]) => ({
  type: 17, accent_color: color, components: children,
});
const pageButtons = (page: number, total: number, uid: string) => ({
  type: 1,
  components: [
    { type: 2, style: 1, label: '上一页', custom_id: `soup_page_${page - 1}_${uid}`, disabled: page <= 1 },
    { type: 2, style: 1, label: '下一页', custom_id: `soup_page_${page + 1}_${uid}`, disabled: page >= total },
  ],
});

// ── 名字解析（截断 6 字） ──
async function resolveDisplayName(interaction: any, userId: string): Promise<string> {
  try {
    const member = await interaction.guild?.members.fetch(userId).catch(() => null);
    const name = member?.displayName
      ?? (await interaction.client.users.fetch(userId).catch(() => null))?.displayName
      ?? '未知';
    return name.length > 6 ? name.slice(0, 6) + '...' : name;
  } catch { return '未知'; }
}

// ── 构建历史页面 ──
async function buildHistoryPage(interaction: any, questions: any[], page: number, total: number) {
  if (questions.length === 0) {
    return container(0xf39c12, [text('### 📋 判定记录\n暂无记录。')]);
  }
  const start = (page - 1) * PER_PAGE;
  const slice = questions.slice(start, start + PER_PAGE);
  let lines = '';
  for (let i = 0; i < slice.length; i++) {
    const q = slice[i];
    const t = ANSWER_TYPES[q.answerType] ?? { label: '?', emoji: '❓' };
    const name = await resolveDisplayName(interaction, q.userId);
    const important = q.isImportant ? ' 🔥' : '';
    lines += `${start + i + 1}. **${name}**：${q.content} → ${t.emoji} ${t.label}${important}\n`;
  }
  return container(0xf39c12, [
    text(`### 📋 判定记录 (${page}/${total})\n${lines}`),
  ]);
}

// ── 主命令处理 ──
export async function execute(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();
  const ch = interaction.channelId;
  const db = getSoupDB();

  // ── 开始 ──
  if (sub === '开始') {
    const existing = await db.getGame(ch);
    if (existing) {
      await interaction.reply({ content: `❌ 本频道已有进行中的海龟汤（汤主：<@${existing.hostId}>）`, ephemeral: true });
      return;
    }

    const riddle = interaction.options.getString('汤面', true);
    await db.createGame(ch, interaction.user.id, riddle);

    // 赋予身份组
    let roleMsg = '';
    const guild = interaction.guild;
    if (guild) {
      let role = guild.roles.cache.find(r => r.name === '海龟汤主持人');
      if (!role && guild.members.me?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        try {
          role = await guild.roles.create({ name: '海龟汤主持人', color: 0xf1c40f, reason: '海龟汤游戏' });
        } catch (e: any) { roleMsg = `\n⚠️ 无法创建身份组：${e.message}`; }
      }
      if (role) {
        const member = await guild.members.fetch(interaction.user.id).catch(() => null);
        if (member) {
          await member.roles.add(role).catch((e: any) => { roleMsg = `\n⚠️ 无法赋予身份组：${e.message}`; });
        }
      } else if (!roleMsg) {
        roleMsg = '\n⚠️ 未找到"海龟汤主持人"身份组，且 Bot 无权创建。';
      }
    }

    await interaction.reply({
      components: [container(0x2ecc71, [
        text(`## 🍲 海龟汤开局\n\n> ${riddle.replace(/\n/g, '\n> ')}\n\n汤主：<@${interaction.user.id}>\n表情判定：✅是 ❌不是 ⭕是也不是 🚫无关 📌线索${roleMsg}`),
      ])],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  // ── 查看汤面 ──
  if (sub === '查看汤面') {
    const game = await db.getGame(ch);
    if (!game) { await interaction.reply({ content: '❌ 当前没有进行中的海龟汤。', ephemeral: true }); return; }

    await interaction.reply({
      components: [container(0x3498db, [
        text(`## 🍲 汤面\n\n> ${game.riddle.replace(/\n/g, '\n> ')}`),
      ])],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  // ── 查看猜测历史 ──
  if (sub === '查看猜测历史') {
    const game = await db.getGame(ch);
    if (!game) { await interaction.reply({ content: '❌ 当前没有进行中的海龟汤。', ephemeral: true }); return; }

    // 手动 defer（discord.js deferReply 类型不支持 IsComponentsV2）
    const appId = interaction.client.application?.id ?? interaction.client.user?.id;
    await interaction.client.rest.post(
      `/interactions/${interaction.id}/${interaction.token}/callback`,
      { body: { type: 5, data: { flags: 1 << 15 } } }
    );

    const questions = await db.getQuestionsForGame(ch);
    const totalPages = Math.max(1, Math.ceil(questions.length / PER_PAGE));
    const uid = interaction.user.id;
    const histContainer = await buildHistoryPage(interaction, questions, 1, totalPages);
    const components: any[] = [histContainer];
    if (totalPages > 1) components.push(pageButtons(1, totalPages, uid));

    await interaction.client.rest.patch(
      `/webhooks/${appId}/${interaction.token}/messages/@original`,
      { body: { components } }
    );
    return;
  }

  // ── 开汤通知 ──
  if (sub === '开汤通知') {
    const game = await db.getGame(ch);
    if (!game) { await interaction.reply({ content: '❌ 当前没有进行中的海龟汤。', ephemeral: true }); return; }

    const role = interaction.guild?.roles.cache.find(r => r.name === '喝汤人');
    const ping = role ? `<@&${role.id}>` : '@喝汤人';
    await interaction.reply({ content: `📢 ${ping} 海龟汤开局了，快来提问！` });
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

    await db.deleteGame(ch);

    // 移除身份组
    const role = interaction.guild?.roles.cache.find(r => r.name === '海龟汤主持人');
    if (role) {
      const host = await interaction.guild?.members.fetch(game.hostId).catch(() => null);
      if (host) await host.roles.remove(role).catch(() => {});
    }

    const answer = interaction.options.getString('汤底') || '（未公布）';

    await interaction.reply({
      components: [container(0x9b59b6, [
        text(`## 🏁 海龟汤结束\n\n**汤面：**\n> ${game.riddle.replace(/\n/g, '\n> ')}\n\n**汤底：**\n> ${answer.replace(/\n/g, '\n> ')}\n\n感谢各位参与！`),
      ])],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  // ── 帮助 ──
  if (sub === '帮助') {
    await interaction.reply({
      components: [container(0x1d9c9c, [
        text(`## 🐢 海龟汤玩法\n\n汤主出谜面，喝汤人提问，汤主用表情判定。`),
        sep(),
        text(`### 指令\n\`/海龟汤 开始 [汤面]\` 开局\n\`/海龟汤 查看汤面\` 看汤面\n\`/海龟汤 查看猜测历史\` 看判定记录\n\`/海龟汤 开汤通知\` 通知喝汤人\n\`/海龟汤 结束 [汤底]\` 结局\n\`/海龟汤 帮助\` 本说明`),
        sep(),
        text(`### 表情判定\n汤主在玩家提问消息下贴表情即可：\n✅ 是　❌ 不是　⭕ 是也不是　🚫 无关　📌 线索\n附加 ❗ 或 ‼️ → 标记为**重要线索**`),
      ])],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }
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
      components: [container(0x95a5a6, [text('### 📋 判定记录\n游戏已结束。')])],
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
