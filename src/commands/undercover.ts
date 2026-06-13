import {
  ActionRowBuilder,
  ChatInputCommandInteraction,
  ModalBuilder,
  ModalSubmitInteraction,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js'
import {
  formatBooleanRule,
  formatAudiencePeek,
  formatEndReveal,
  formatHostSecret,
  formatLobbyMessage,
  formatPreparedEnd,
  formatSpeechOrder,
  getRandomUndercoverWordPair,
  UndercoverEngine,
  UNDERCOVER_JOIN_EMOJI,
  UNDERCOVER_MIN_PLAYERS,
  type UndercoverAssignment,
  type UndercoverGame,
  type UndercoverWordPair,
  type UndercoverWordSource,
} from '../game/undercover.js'
import {
  addHostRoleToMember,
  removeHostRoleFromMember,
  UNDERCOVER_NOTIFY_ROLE_ID,
} from '../game/discord-roles.js'

const text = (content: string) => ({ type: 10, content })
const box = (children: any[]) => ({ type: 17, components: children })
const sep = () => ({ type: 14, divider: true, spacing: 1 })
const componentsV2Flags = ['IsComponentsV2'] as const
const panel = (content: string) => ({
  components: [box([text(content)])],
  flags: componentsV2Flags,
})

const WORD_SOURCE_OPTION = '词汇来源'
const ALLOW_LYING_OPTION = '可否撒谎'
const CUSTOM_WORD_SOURCE: UndercoverWordSource = 'custom'
const RANDOM_WORD_SOURCE: UndercoverWordSource = 'random'

type UndercoverInteraction = ChatInputCommandInteraction | ModalSubmitInteraction

export const data = new SlashCommandBuilder()
  .setName('卧底')
  .setDescription('谁是卧底游戏')
  .addSubcommand(sub => sub
    .setName('报名阶段')
    .setDescription('用户成为主持人，决定词汇并进入报名阶段。可以选择自定义发词或随机发词，也可以设置参与者是否允许撒谎。')
    .addStringOption(option => option
      .setName(WORD_SOURCE_OPTION)
      .setDescription('选择本局词汇来源，不填默认自定义发词')
      .setRequired(false)
      .addChoices(
        { name: '自定义发词', value: CUSTOM_WORD_SOURCE },
        { name: '随机发词', value: RANDOM_WORD_SOURCE },
      )
    )
    .addBooleanOption(option => option
      .setName(ALLOW_LYING_OPTION)
      .setDescription('参与者是否允许撒谎，不填默认否')
      .setRequired(false)
    )
  )
  .addSubcommand(sub => sub
    .setName('正式开始')
    .setDescription('停止报名，BOT将词汇私信给参与者')
  )
  .addSubcommand(sub => sub
    .setName('游戏通知')
    .setDescription('通知“小心她人！”身份组成员前来玩游戏！')
  )
  .addSubcommand(sub => sub
    .setName('观众偷看')
    .setDescription('旁观者查看本局答案，请不要泄露词汇和卧底身份')
  )
  .addSubcommand(sub => sub
    .setName('结束')
    .setDescription('结束当前谁是卧底')
  )
  .addSubcommand(sub => sub
    .setName('帮助')
    .setDescription('查看谁是卧底规则与命令说明')
  )

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) {
    await interaction.reply({ content: '❌ 谁是卧底只能在服务器频道中使用。', ephemeral: true })
    return
  }

  const sub = interaction.options.getSubcommand()

  if (sub === '报名阶段') {
    await handlePrepare(interaction)
    return
  }

  if (sub === '正式开始') {
    await handleOfficialStart(interaction)
    return
  }

  if (sub === '游戏通知') {
    await handleRegistrationNotice(interaction)
    return
  }

  if (sub === '观众偷看') {
    await handleAudiencePeek(interaction)
    return
  }

  if (sub === '结束') {
    await handleEnd(interaction)
    return
  }

  if (sub === '帮助') {
    await handleHelp(interaction)
  }
}

async function handlePrepare(interaction: ChatInputCommandInteraction) {
  const existing = UndercoverEngine.getGame(interaction.channelId)
  if (existing) {
    await interaction.reply({ content: '❌ 当前频道已有进行中的谁是卧底。', ephemeral: true })
    return
  }

  const wordSource = (interaction.options.getString(WORD_SOURCE_OPTION) as UndercoverWordSource | null)
    ?? CUSTOM_WORD_SOURCE
  const allowLying = interaction.options.getBoolean(ALLOW_LYING_OPTION) ?? false

  if (wordSource === RANDOM_WORD_SOURCE) {
    let pair: UndercoverWordPair
    try {
      pair = getRandomUndercoverWordPair()
    } catch (error: any) {
      await interaction.reply({ content: `❌ ${error.message}`, ephemeral: true })
      return
    }

    await interaction.deferReply()
    await createPreparedGame(interaction, pair, wordSource, allowLying)
    return
  }

  const modalId = `undercover_prepare_words_${interaction.channelId}_${interaction.user.id}`
  const modal = new ModalBuilder()
    .setCustomId(modalId)
    .setTitle('谁是卧底报名阶段')

  const civilianInput = new TextInputBuilder()
    .setCustomId('civilian_word')
    .setLabel('平民词')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)

  const undercoverInput = new TextInputBuilder()
    .setCustomId('undercover_word')
    .setLabel('卧底词')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(civilianInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(undercoverInput),
  )

  await interaction.showModal(modal)

  let submitted: ModalSubmitInteraction
  try {
    submitted = await interaction.awaitModalSubmit({
      time: 300_000,
      filter: i => i.user.id === interaction.user.id && i.customId === modalId,
    })
  } catch {
    return
  }

  await submitted.deferReply()
  await createPreparedGame(
    submitted,
    {
      civilian: submitted.fields.getTextInputValue('civilian_word').trim(),
      undercover: submitted.fields.getTextInputValue('undercover_word').trim(),
    },
    wordSource,
    allowLying,
  )
}

async function createPreparedGame(
  interaction: UndercoverInteraction,
  pair: UndercoverWordPair,
  wordSource: UndercoverWordSource,
  allowLying: boolean,
) {
  const channelId = interaction.channelId
  if (!channelId) {
    await interaction.editReply('❌ 无法在当前频道创建谁是卧底。')
    return
  }

  const result = await UndercoverEngine.startGame(channelId, interaction.user.id, {
    wordSource,
    civilianWord: pair.civilian,
    undercoverWord: pair.undercover,
    allowLying,
  })

  if (!result.ok) {
    await interaction.editReply(`❌ ${result.error}`)
    return
  }

  const hostName = await resolveDisplayName(interaction, interaction.user.id)
  const roleMsg = interaction.guild
    ? await addHostRoleToMember(interaction.guild, interaction.user.id, '谁是卧底报名阶段')
    : ''

  await interaction.editReply(panel(formatLobbyMessage({
    hostName,
    wordSource,
    allowLying,
  }) + roleMsg))

  const message = await interaction.fetchReply()
  await UndercoverEngine.setJoinMessage(channelId, message.id)

  try {
    await message.react(UNDERCOVER_JOIN_EMOJI)
  } catch (error) {
    console.error('[Undercover] 添加报名反应失败:', error)
    await interaction.followUp({
      content: `⚠️ 无法添加 ${UNDERCOVER_JOIN_EMOJI} 反应，请检查 Bot 的消息反应权限。`,
      ephemeral: true,
    })
  }
}

async function handleOfficialStart(interaction: ChatInputCommandInteraction) {
  const game = UndercoverEngine.getGame(interaction.channelId)
  if (!game) {
    await interaction.reply({ content: '❌ 当前频道没有进行中的谁是卧底。', ephemeral: true })
    return
  }

  if (game.hostId !== interaction.user.id) {
    await interaction.reply({ content: '❌ 只有本局主持人可以正式开始谁是卧底。', ephemeral: true })
    return
  }

  if (game.dealtAt) {
    await interaction.reply({ content: '❌ 本局已经正式开始。', ephemeral: true })
    return
  }

  if (game.players.length < UNDERCOVER_MIN_PLAYERS) {
    await interaction.reply({
      content: `❌ 至少需要 ${UNDERCOVER_MIN_PLAYERS} 名玩家才能正式开始。当前玩家数：${game.players.length}`,
      ephemeral: true,
    })
    return
  }

  await interaction.deferReply({ ephemeral: true })
  await dealAndNotify(interaction)
}

async function handleRegistrationNotice(interaction: ChatInputCommandInteraction) {
  const game = UndercoverEngine.getGame(interaction.channelId)
  if (!game) {
    await interaction.reply({ content: '❌ 当前频道没有进行中的谁是卧底。', ephemeral: true })
    return
  }

  if (game.hostId !== interaction.user.id) {
    await interaction.reply({ content: '❌ 只有本局主持人可以发送游戏通知。', ephemeral: true })
    return
  }

  if (game.dealtAt) {
    await interaction.reply({ content: '❌ 本局已经正式开始，不能再发送游戏通知。', ephemeral: true })
    return
  }

  await interaction.deferReply()

  const role = await interaction.guild?.roles.fetch(UNDERCOVER_NOTIFY_ROLE_ID).catch(() => null)
  if (!role) {
    await interaction.editReply({
      content: `⚠️ 未找到「小心她人！」身份组：${UNDERCOVER_NOTIFY_ROLE_ID}`,
    })
    return
  }

  await interaction.editReply({
    content: `📢 <@&${UNDERCOVER_NOTIFY_ROLE_ID}> 谁是卧底开玩啦，来报名！`,
    allowedMentions: { roles: [UNDERCOVER_NOTIFY_ROLE_ID] },
  })
}

async function handleAudiencePeek(interaction: ChatInputCommandInteraction) {
  const game = UndercoverEngine.getGame(interaction.channelId)
  if (!game) {
    await interaction.reply({ content: '❌ 当前频道没有进行中的谁是卧底。', ephemeral: true })
    return
  }

  if (game.hostId === interaction.user.id) {
    await interaction.reply({ content: '❌ 主持人已经知道答案，不能使用观众偷看。', ephemeral: true })
    return
  }

  if (game.players.some(player => player.userId === interaction.user.id)) {
    await interaction.reply({ content: '❌ 参与者不能使用观众偷看。', ephemeral: true })
    return
  }

  if (!game.deal) {
    await interaction.reply({
      content: '❌ 本局尚未正式开始，发词后旁观者才可以偷看答案。',
      ephemeral: true,
    })
    return
  }

  await interaction.deferReply({ ephemeral: true })
  const undercoverName = await resolveDisplayName(interaction, game.deal.undercoverUserId)
  await interaction.editReply(panel(formatAudiencePeek({
    civilianWord: game.deal.civilianWord,
    undercoverWord: game.deal.undercoverWord,
    undercoverName,
  })))
}

async function handleEnd(interaction: ChatInputCommandInteraction) {
  const game = UndercoverEngine.getGame(interaction.channelId)
  if (!game) {
    await interaction.reply({ content: '❌ 当前频道没有进行中的谁是卧底。', ephemeral: true })
    return
  }

  if (game.hostId !== interaction.user.id) {
    await interaction.reply({ content: '❌ 只有本局主持人可以结束本局谁是卧底。', ephemeral: true })
    return
  }

  await interaction.deferReply()
  const endContent = await buildEndContent(interaction, game)
  await interaction.editReply(panel(endContent))
  await UndercoverEngine.endGame(interaction.channelId)

  if (interaction.guild) {
    await removeHostRoleFromMember(interaction.guild, game.hostId, '谁是卧底结束')
  }
}

async function buildEndContent(
  interaction: ChatInputCommandInteraction,
  game: UndercoverGame,
): Promise<string> {
  if (!game.deal) {
    return formatPreparedEnd()
  }

  const undercoverName = await resolveDisplayName(interaction, game.deal.undercoverUserId)
  return formatEndReveal({
    civilianWord: game.deal.civilianWord,
    undercoverWord: game.deal.undercoverWord,
    undercoverName,
  })
}

async function handleHelp(interaction: ChatInputCommandInteraction) {
  await interaction.reply({
    components: [box([
      text(
        `## 🎭 “谁是卧底”游戏说明\n\n` +
        `多数玩家会拿到同一个平民词，只有 1 名玩家拿到不同但相近的卧底词。\n\n` +
        `玩家轮流描述自己的词，不能直接说出词语本身。平民要找出卧底，卧底要隐藏身份、混入平民。本局是否允许撒谎，以主持人设置为准。\n\n` +
        `讨论结束后，由大家自行投票或由主持人组织判断。游戏结束时，Bot 会公布平民词、卧底词和卧底是谁。`,
      ),
      sep(),
      text(
        `### 命令\n` +
        `\`/卧底 报名阶段\`\n` +
        `用户成为主持人，决定词汇并进入报名阶段。\n\n` +
        `\`/卧底 正式开始\`\n` +
        `停止报名，Bot 将词汇私信给参与者，并公布建议发言顺序。仅本局主持人可用。\n\n` +
        `\`/卧底 游戏通知\`\n` +
        `通知\`小心她人！\`身份组成员前来玩游戏！仅本局主持人可用。\n\n` +
        `\`/卧底 观众偷看\`\n` +
        `旁观者查看本局平民词、卧底词和卧底是谁。请不要泄露词汇和卧底身份。仅非主持人、非参与者可用。\n\n` +
        `\`/卧底 结束\`\n` +
        `结束当前谁是卧底，并公布答案。仅本局主持人可用。`,
      ),
    ])],
    flags: componentsV2Flags,
  })
}

async function dealAndNotify(interaction: ChatInputCommandInteraction) {
  const guild = interaction.guild
  const channel = interaction.channel
  const channelId = interaction.channelId

  if (!guild || !channel || !channelId || !('send' in channel)) {
    await interaction.editReply('❌ 无法在当前频道发词。')
    return
  }

  let result
  try {
    result = await UndercoverEngine.dealWords(channelId)
  } catch (error: any) {
    await interaction.editReply(`❌ ${error.message}`)
    return
  }

  const game = UndercoverEngine.getGame(channelId)
  if (!game) {
    await interaction.editReply('❌ 当前频道没有进行中的谁是卧底。')
    return
  }

  const displayPlayers = await Promise.all(
    game.players.map(async player => ({
      userId: player.userId,
      displayName: await resolveDisplayName(interaction, player.userId),
    })),
  )

  const failedDmNames: string[] = []
  for (const assignment of result.assignments) {
    const displayName = displayPlayers.find(player => player.userId === assignment.userId)?.displayName
      ?? '未知玩家'
    const sent = await sendWordDm(interaction, assignment, game.allowLying)
    if (!sent) failedDmNames.push(displayName)
  }

  const failedSection = failedDmNames.length > 0
    ? `\n\n**私信失败：**${failedDmNames.join('、')}\n请联系主持人补发。`
    : `\n如果没收到私信，请联系主持人发词。`

  const publicContent =
    `## 🎭 正式开始，请查看私信。\n` +
    `**可否撒谎：**${formatBooleanRule(game.allowLying)}${failedSection}\n\n` +
    formatSpeechOrder(displayPlayers)

  await channel.send(panel(publicContent))

  const undercoverName = displayPlayers.find(player => player.userId === result.undercoverUserId)?.displayName
    ?? '未知玩家'

  await interaction.editReply(panel(formatHostSecret({
    civilianWord: result.civilianWord,
    undercoverWord: result.undercoverWord,
    undercoverName,
    allowLying: game.allowLying,
    failedDmNames,
  })))
}

async function sendWordDm(
  interaction: ChatInputCommandInteraction,
  assignment: UndercoverAssignment,
  allowLying: boolean,
): Promise<boolean> {
  try {
    const user = await interaction.client.users.fetch(assignment.userId)
    await user.send(panel(
      `## 🎭 谁是卧底\n\n` +
      `你的词是：**${assignment.word}**\n` +
      `本局可否撒谎：**${formatBooleanRule(allowLying)}**`,
    ))
    return true
  } catch (error) {
    console.error(`[Undercover] 私信 ${assignment.userId} 失败:`, error)
    return false
  }
}

async function resolveDisplayName(
  interaction: UndercoverInteraction,
  userId: string,
): Promise<string> {
  const member = await interaction.guild?.members.fetch(userId).catch(() => null)
  if (member?.displayName) return member.displayName

  const user = await interaction.client.users.fetch(userId).catch(() => null)
  return user?.displayName ?? user?.username ?? '未知玩家'
}
