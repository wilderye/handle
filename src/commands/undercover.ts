import {
  ActionRowBuilder,
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  ModalBuilder,
  ModalSubmitInteraction,
  SlashCommandBuilder,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js'
import {
  formatBooleanRule,
  formatAudiencePeek,
  escapeDiscordMarkdownText,
  formatDiscordDisplayName,
  formatEndReveal,
  formatHostSecret,
  formatLobbyMessage,
  formatUndercoverPlayerList,
  formatUndercoverPlayerVoteList,
  formatUndercoverVoteOptions,
  formatUndercoverVoteStatus,
  formatPreparedEnd,
  getVoteReminderOffsets,
  getRandomUndercoverWordPair,
  shouldSendVoteEndingSoon,
  UndercoverEngine,
  UNDERCOVER_JOIN_EMOJI,
  UNDERCOVER_MIN_PLAYERS,
  type UndercoverAssignment,
  type UndercoverCurrentSpeech,
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
const panelWithRows = (content: string, rows: any[] = []) => ({
  components: [box([text(content)]), ...rows],
  flags: componentsV2Flags,
})

const WORD_SOURCE_OPTION = '词汇来源'
const ALLOW_LYING_OPTION = '可否撒谎'
const DISCUSSION_MINUTES_OPTION = '讨论时间'
const UNDERCOVER_COUNT_OPTION = '卧底数量'
const CUSTOM_WORD_SOURCE: UndercoverWordSource = 'custom'
const RANDOM_WORD_SOURCE: UndercoverWordSource = 'random'
const UNDERCOVER_START_BUTTON_ID = 'undercover_official_start'
const UNDERCOVER_SPEECH_BUTTON_ID = 'undercover_speech_submit'
const UNDERCOVER_SKIP_SPEECH_BUTTON_ID = 'undercover_speech_skip'
const UNDERCOVER_SPEECH_MODAL_ID = 'undercover_speech_modal'
const UNDERCOVER_SPEECH_INPUT_ID = 'speech_content'
const UNDERCOVER_VOTE_BUTTON_ID = 'undercover_vote_open'
const UNDERCOVER_VOTE_SELECT_ID = 'undercover_vote_select'
const UNDERCOVER_HISTORY_BUTTON_ID = 'undercover_history_open'
const UNDERCOVER_HISTORY_PAGE_PREFIX = 'undercover_history_page_'
const UNDERCOVER_CLOSE_VOTE_BUTTON_ID = 'undercover_vote_close'

type UndercoverInteraction = ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction
type UndercoverRuntimeContext = UndercoverInteraction | {
  client: Client
  channel: any
  channelId: string
  guild?: any
}

const VOTE_ENDING_SOON_MS = 30_000
const voteTimers = new Map<string, Array<ReturnType<typeof setTimeout>>>()

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
    .addIntegerOption(option => option
      .setName(UNDERCOVER_COUNT_OPTION)
      .setDescription('可选卧底数量，不填默认 1；按钮正式开始固定为 1')
      .setRequired(false)
      .setMinValue(1)
    )
  )
  .addSubcommand(sub => sub
    .setName('开始发言')
    .setDescription('主持人开启一轮面板化发言')
  )
  .addSubcommand(sub => sub
    .setName('投票')
    .setDescription('主持人开启一轮投票')
    .addIntegerOption(option => option
      .setName(DISCUSSION_MINUTES_OPTION)
      .setDescription('可选讨论时间，单位分钟；时间到后自动结算')
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(240)
    )
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

  if (sub === '开始发言') {
    await handleStartSpeech(interaction)
    return
  }

  if (sub === '投票') {
    await handleStartVote(interaction)
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

  await interaction.editReply(panelWithRows(formatLobbyMessage({
    hostName,
    wordSource,
    allowLying,
  }) + roleMsg, [officialStartButtonRow()]))

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

  const undercoverCount = interaction.options.getInteger(UNDERCOVER_COUNT_OPTION) ?? 1
  await interaction.deferReply({ ephemeral: true })
  await dealAndNotify(interaction, undercoverCount)
}

async function handleStartSpeech(interaction: ChatInputCommandInteraction) {
  const game = UndercoverEngine.getGame(interaction.channelId)
  if (!game) {
    await interaction.reply({ content: '❌ 当前频道没有进行中的谁是卧底。', ephemeral: true })
    return
  }

  if (game.hostId !== interaction.user.id) {
    await interaction.reply({ content: '❌ 只有本局主持人可以开始发言。', ephemeral: true })
    return
  }

  if (!game.dealtAt) {
    await interaction.reply({ content: '❌ 请先正式开始并完成发词。', ephemeral: true })
    return
  }

  const result = await UndercoverEngine.startSpeechRound(interaction.channelId)
  if (!result.ok || !result.speech) {
    await interaction.reply({ content: `❌ ${result.error ?? '无法开始发言。'}`, ephemeral: true })
    return
  }

  await sendSpeechPanel(interaction, result.speech, 'reply')
}

async function handleStartVote(interaction: ChatInputCommandInteraction) {
  const game = UndercoverEngine.getGame(interaction.channelId)
  if (!game) {
    await interaction.reply({ content: '❌ 当前频道没有进行中的谁是卧底。', ephemeral: true })
    return
  }

  if (game.hostId !== interaction.user.id) {
    await interaction.reply({ content: '❌ 只有本局主持人可以发起投票。', ephemeral: true })
    return
  }

  if (!game.dealtAt) {
    await interaction.reply({ content: '❌ 请先正式开始并完成发词。', ephemeral: true })
    return
  }

  const discussionMinutes = interaction.options.getInteger(DISCUSSION_MINUTES_OPTION)
  if (game.currentVote) {
    await interaction.reply(await buildVotePanel(interaction, game))
    const message = await interaction.fetchReply()
    const previousMessageId = await UndercoverEngine.setVoteMessage(interaction.channelId, message.id)
    await deleteChannelMessage(interaction, previousMessageId)
    await interaction.followUp({
      content: discussionMinutes
        ? '当前投票已在进行中，已重新发布投票面板，讨论时间不变。'
        : '已重新发布当前投票面板。',
      ephemeral: true,
    })
    return
  }

  const result = await UndercoverEngine.startVote(interaction.channelId, discussionMinutes)
  if (!result.ok) {
    await interaction.reply({ content: `❌ ${result.error ?? '无法开始投票。'}`, ephemeral: true })
    return
  }

  const voteGame = UndercoverEngine.getGame(interaction.channelId)
  if (!voteGame) {
    await interaction.reply({ content: '❌ 当前频道没有进行中的谁是卧底。', ephemeral: true })
    return
  }

  await interaction.reply(await buildVotePanel(interaction, voteGame))
  const message = await interaction.fetchReply()
  await UndercoverEngine.setVoteMessage(interaction.channelId, message.id)
  scheduleVoteTimers(interaction, interaction.channelId, voteGame.currentVote?.endsAt)
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

  const guild = interaction.guild
  if (!guild) {
    await interaction.reply({ content: '❌ 谁是卧底只能在服务器频道中使用。', ephemeral: true })
    return
  }

  const role = guild.roles.cache.get(UNDERCOVER_NOTIFY_ROLE_ID)
    ?? await guild.roles.fetch(UNDERCOVER_NOTIFY_ROLE_ID).catch(() => null)
  if (!role) {
    await interaction.reply({
      content: `⚠️ 未找到「小心她人！」身份组：${UNDERCOVER_NOTIFY_ROLE_ID}`,
      ephemeral: true,
    })
    return
  }

  await interaction.reply({
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
  const undercoverNames = await Promise.all(
    game.deal.undercoverUserIds.map(userId => resolveDisplayName(interaction, userId)),
  )
  await interaction.editReply(panel(formatAudiencePeek({
    civilianWord: game.deal.civilianWord,
    undercoverWord: game.deal.undercoverWord,
    undercoverNames,
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
  clearVoteTimers(interaction.channelId)
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

  const undercoverNames = await Promise.all(
    game.deal.undercoverUserIds.map(userId => resolveDisplayName(interaction, userId)),
  )
  return formatEndReveal({
    civilianWord: game.deal.civilianWord,
    undercoverWord: game.deal.undercoverWord,
    undercoverNames,
  })
}

async function handleHelp(interaction: ChatInputCommandInteraction) {
  await interaction.reply({
    components: [box([
      text(
        `## 🎭 “谁是卧底”游戏说明\n\n` +
        `多数玩家会拿到同一个平民词，一名或多名玩家会拿到不同但相近的卧底词。\n\n` +
        `玩家轮流描述自己的词，不能直接说出词语本身。平民要找出卧底，卧底要隐藏身份、混入平民。本局是否允许撒谎，以主持人设置为准。\n\n` +
        `讨论结束后，由大家投票或由主持人组织判断；Bot 只负责记录淘汰结果，胜负由主持人宣布。游戏结束时，Bot 会公布平民词、卧底词和卧底是谁。`,
      ),
      sep(),
      text(
        `### 命令\n` +
        `\`/卧底 报名阶段\`\n` +
        `用户成为主持人，决定词汇并进入报名阶段。\n\n` +
        `\`/卧底 正式开始\`\n` +
        `停止报名，Bot 将词汇私信给参与者，并公布固定发言顺序；可选卧底数量，不填默认 1。仅本局主持人可用。\n\n` +
        `\`/卧底 开始发言\`\n` +
        `开启一轮面板化发言，当前轮已发言内容会显示在面板上。仅本局主持人可用。\n\n` +
        `\`/卧底 投票\`\n` +
        `开启或重新唤出投票面板；讨论时间到后自动结算，主持人也可以提前结束。仅本局主持人可用。\n\n` +
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

function officialStartButtonRow() {
  return {
    type: 1,
    components: [
      { type: 2, style: 1, label: '正式开始', custom_id: UNDERCOVER_START_BUTTON_ID },
    ],
  }
}

function speechButtonRow() {
  return {
    type: 1,
    components: [
      { type: 2, style: 1, label: '发言', custom_id: UNDERCOVER_SPEECH_BUTTON_ID },
      { type: 2, style: 2, label: '查看历史', custom_id: UNDERCOVER_HISTORY_BUTTON_ID },
      { type: 2, style: 2, label: '跳过', custom_id: UNDERCOVER_SKIP_SPEECH_BUTTON_ID },
    ],
  }
}

function voteActionRow(disabled = false) {
  return {
    type: 1,
    components: [
      { type: 2, style: 1, label: '投票', custom_id: UNDERCOVER_VOTE_BUTTON_ID, disabled },
      { type: 2, style: 2, label: '查看历史', custom_id: UNDERCOVER_HISTORY_BUTTON_ID, disabled },
      { type: 2, style: 4, label: '结束投票', custom_id: UNDERCOVER_CLOSE_VOTE_BUTTON_ID, disabled },
    ],
  }
}

function historyPageRow(page: number, total: number, ownerId: string) {
  return {
    type: 1,
    components: [
      {
        type: 2,
        style: 2,
        label: '上一页',
        custom_id: `${UNDERCOVER_HISTORY_PAGE_PREFIX}${page - 1}_${ownerId}`,
        disabled: page <= 1,
      },
      {
        type: 2,
        style: 2,
        label: '下一页',
        custom_id: `${UNDERCOVER_HISTORY_PAGE_PREFIX}${page + 1}_${ownerId}`,
        disabled: page >= total,
      },
    ],
  }
}

function voteSelectRow(players: Array<{ userId: string; number: number; displayName: string }>) {
  return {
    type: 1,
    components: [
      {
        type: 3,
        custom_id: UNDERCOVER_VOTE_SELECT_ID,
        placeholder: '选择你要投票的玩家',
        min_values: 1,
        max_values: 1,
        options: formatUndercoverVoteOptions(players).slice(0, 25),
      },
    ],
  }
}

async function getDisplayNumberedPlayers(
  interaction: UndercoverRuntimeContext,
  game: UndercoverGame,
  userIds?: string[],
) {
  const fixedPlayers = game.fixedPlayers && game.fixedPlayers.length > 0
    ? game.fixedPlayers
    : game.players.map((player, index) => ({ ...player, number: index + 1 }))
  const filter = userIds ? new Set(userIds) : null
  return Promise.all(
    fixedPlayers
      .filter(player => !filter || filter.has(player.userId))
      .map(async player => ({
        userId: player.userId,
        number: player.number,
        displayName: await resolveDisplayName(interaction, player.userId),
      })),
  )
}

async function buildSpeechPanel(
  interaction: UndercoverInteraction,
  game: UndercoverGame,
  speech: UndercoverCurrentSpeech,
) {
  const orderPlayers = await getDisplayNumberedPlayers(interaction, game, speech.order)
  const byUserId = new Map(orderPlayers.map(player => [player.userId, player]))
  const orderedPlayers = speech.order
    .map(userId => byUserId.get(userId))
    .filter((player): player is NonNullable<typeof player> => Boolean(player))
  const currentUserId = speech.order[speech.currentIndex]
  const spokenSection = formatSpeechEntriesForPanel(speech.entries, byUserId)
  const currentSpeechContent = spokenSection
    ? `\n\n---\n\n**本轮发言：**\n${spokenSection}`
    : ''
  return panelWithRows(
    `## 🎙️ 第 ${speech.round} 轮发言\n\n` +
    `当前发言：<@${currentUserId}>\n\n` +
    `**发言顺序：**\n${formatUndercoverPlayerList(orderedPlayers)}` +
    currentSpeechContent,
    [speechButtonRow()],
  )
}

function formatSpeechEntriesForPanel(
  entries: UndercoverCurrentSpeech['entries'],
  playersByUserId: Map<string, { number: number; displayName: string }>,
): string {
  return entries.map(entry => {
    const player = playersByUserId.get(entry.userId)
    const label = player
      ? `${player.number}. ${formatDiscordDisplayName(player.displayName)}`
      : `<@${entry.userId}>`
    return `**${label}：**${escapeDiscordMarkdownText(entry.content)}`
  }).join('\n')
}

function formatCompletedSpeechEntriesForPanel(
  entries: UndercoverCurrentSpeech['entries'],
  playersByUserId: Map<string, { number: number; displayName: string }>,
): string {
  const formatted = formatSpeechEntriesForPanel(entries, playersByUserId)
  return formatted || '暂无发言。'
}

async function buildCompletedSpeechPanel(
  interaction: UndercoverInteraction,
  game: UndercoverGame,
  round: NonNullable<UndercoverGame['speechRounds']>[number],
) {
  const players = await getDisplayNumberedPlayers(interaction, game, round.order)
  const byUserId = new Map(players.map(player => [player.userId, player]))
  const entries = formatCompletedSpeechEntriesForPanel(round.entries, byUserId)
  return panel(
    `## ✅ 第 ${round.round} 轮发言完毕\n\n` +
    `**本轮发言：**\n${entries}`,
  )
}

async function sendSpeechPanel(
  interaction: UndercoverInteraction,
  speech: UndercoverCurrentSpeech,
  mode: 'reply' | 'send',
) {
  const channelId = interaction.channelId
  if (!channelId) return
  const game = UndercoverEngine.getGame(channelId)
  if (!game) {
    if ('reply' in interaction) {
      await interaction.reply({ content: '❌ 当前频道没有进行中的谁是卧底。', ephemeral: true })
    }
    return
  }

  const payload = await buildSpeechPanel(interaction, game, speech)
  let message: any
  if (mode === 'reply' && 'reply' in interaction && 'fetchReply' in interaction) {
    await interaction.reply(payload)
    message = await interaction.fetchReply()
  } else {
    const channel = interaction.channel
    if (!channel || !('send' in channel)) return
    message = await channel.send(payload)
  }

  await UndercoverEngine.setSpeechMessage(channelId, message.id)
}

async function buildVotePanel(interaction: UndercoverRuntimeContext, game: UndercoverGame) {
  const aliveUserIds = game.aliveUserIds && game.aliveUserIds.length > 0
    ? game.aliveUserIds
    : game.players.map(player => player.userId)
  const candidates = await getDisplayNumberedPlayers(interaction, game, aliveUserIds)
  const vote = game.currentVote
  const timeLine = vote?.endsAt
    ? `\n**讨论截止：**<t:${Math.floor(vote.endsAt / 1000)}:R>\n`
    : '\n'

  return panelWithRows(
    `## 🗳️ 谁是卧底投票\n\n` +
    `**当前存活玩家：**\n${formatUndercoverPlayerVoteList(candidates, vote?.votes ?? {})}\n` +
    timeLine +
    `\n${formatUndercoverVoteStatus({ candidates, votes: vote?.votes ?? {} })}`,
    [voteActionRow()],
  )
}

async function replaceCurrentVotePanel(
  context: UndercoverRuntimeContext,
  channelId: string,
  expectedEndsAt?: number,
) {
  const game = UndercoverEngine.getGame(channelId)
  if (!game?.currentVote) return
  if (expectedEndsAt !== undefined && game.currentVote.endsAt !== expectedEndsAt) return

  const channel = context.channel
  if (!channel || !('send' in channel)) return

  const message = await channel.send(await buildVotePanel(context, game))
  const previousMessageId = await UndercoverEngine.setVoteMessage(channelId, message.id)
  await deleteChannelMessage(context, previousMessageId)
}

function clearVoteTimers(channelId: string) {
  const timers = voteTimers.get(channelId)
  if (!timers) return
  for (const timer of timers) {
    clearTimeout(timer)
  }
  voteTimers.delete(channelId)
}

function rememberVoteTimer(channelId: string, timer: ReturnType<typeof setTimeout>) {
  const timers = voteTimers.get(channelId) ?? []
  timers.push(timer)
  voteTimers.set(channelId, timers)
}

function scheduleVoteTimers(
  context: UndercoverRuntimeContext,
  channelId: string,
  endsAt?: number,
) {
  clearVoteTimers(channelId)
  if (!endsAt) return

  const now = Date.now()
  const remainingMs = endsAt - now
  if (remainingMs <= 0) {
    void sendVoteTimeUp(context, channelId, endsAt).catch(error => {
      console.error('[Undercover] 发送投票到点提醒失败:', error)
    })
    return
  }

  const game = UndercoverEngine.getGame(channelId)
  const totalMs = game?.currentVote?.startedAt
    ? endsAt - game.currentVote.startedAt
    : remainingMs

  for (const offset of getVoteReminderOffsets(totalMs)) {
    const delay = remainingMs - offset
    if (delay <= 0) continue
    rememberVoteTimer(channelId, setTimeout(() => {
      void replaceCurrentVotePanel(context, channelId, endsAt).catch(error => {
        console.error('[Undercover] 下沉投票面板失败:', error)
      })
    }, delay))
  }

  const shouldSendEndingSoon = shouldSendVoteEndingSoon(totalMs)
  const endingSoonDelay = remainingMs - VOTE_ENDING_SOON_MS
  if (shouldSendEndingSoon && endingSoonDelay > 0) {
    rememberVoteTimer(channelId, setTimeout(() => {
      void sendVoteEndingSoon(context, channelId, endsAt).catch(error => {
        console.error('[Undercover] 发送投票结束提醒失败:', error)
      })
    }, endingSoonDelay))
  }

  rememberVoteTimer(channelId, setTimeout(() => {
    void sendVoteTimeUp(context, channelId, endsAt).catch(error => {
      console.error('[Undercover] 发送投票到点提醒失败:', error)
    })
  }, remainingMs))
}

async function sendVoteEndingSoon(
  context: UndercoverRuntimeContext,
  channelId: string,
  expectedEndsAt: number,
) {
  const game = UndercoverEngine.getGame(channelId)
  if (!game?.currentVote || game.currentVote.endsAt !== expectedEndsAt) return
  const channel = context.channel
  if (!channel || !('send' in channel)) return
  await channel.send('投票即将在 **30** 秒后结束。').catch(() => undefined)
}

async function sendVoteTimeUp(
  context: UndercoverRuntimeContext,
  channelId: string,
  expectedEndsAt: number,
) {
  const game = UndercoverEngine.getGame(channelId)
  if (!game?.currentVote || game.currentVote.endsAt !== expectedEndsAt) return

  clearVoteTimers(channelId)
  const voteMessageId = game.currentVote.messageId
  const result = await UndercoverEngine.closeVote(channelId)
  await editVoteMessageClosed(context, voteMessageId)
  await announceVoteResult(context, game, result.result)
}

export async function resumeUndercoverVoteTimers(client: Client) {
  for (const game of UndercoverEngine.getActiveGames()) {
    const endsAt = game.currentVote?.endsAt
    if (!endsAt) continue

    const channel = await client.channels.fetch(game.channelId).catch(() => null)
    if (!channel || !('send' in channel)) continue

    const context: UndercoverRuntimeContext = {
      client,
      channel,
      channelId: game.channelId,
      guild: 'guild' in channel ? channel.guild : undefined,
    }
    scheduleVoteTimers(context, game.channelId, endsAt)
  }
}

async function buildHistoryPanel(
  interaction: UndercoverInteraction,
  game: UndercoverGame,
  page: number,
  ownerId: string,
) {
  const rounds = [...(game.speechRounds ?? [])]
  const total = Math.max(1, rounds.length)
  const safePage = Math.max(1, Math.min(page, total))
  const round = rounds[safePage - 1]

  if (!round) {
    return panelWithRows('## 📜 发言历史\n\n暂无发言记录。')
  }

  const players = await getDisplayNumberedPlayers(interaction, game, round.order)
  const byUserId = new Map(players.map(player => [player.userId, player]))
  const entries = formatCompletedSpeechEntriesForPanel(round.entries, byUserId)

  const rows = total > 1 ? [historyPageRow(safePage, total, ownerId)] : []
  return panelWithRows(
    `## 📜 发言历史 (${safePage}/${total})\n\n${entries}`,
    rows,
  )
}

async function dealAndNotify(interaction: UndercoverInteraction, undercoverCount: number) {
  const guild = interaction.guild
  const channel = interaction.channel
  const channelId = interaction.channelId

  if (!guild || !channel || !channelId || !('send' in channel)) {
    await interaction.editReply('❌ 无法在当前频道发词。')
    return
  }

  let result
  try {
    result = await UndercoverEngine.dealWords(channelId, { undercoverCount })
  } catch (error: any) {
    await interaction.editReply(`❌ ${error.message}`)
    return
  }

  const game = UndercoverEngine.getGame(channelId)
  if (!game) {
    await interaction.editReply('❌ 当前频道没有进行中的谁是卧底。')
    return
  }

  const displayPlayers = await getDisplayNumberedPlayers(interaction, game)

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
    `**发言顺序：**\n${formatUndercoverPlayerList(displayPlayers)}`

  await channel.send(panel(publicContent))

  const displayNameByUserId = new Map(displayPlayers.map(player => [player.userId, player.displayName]))
  const undercoverNames = result.undercoverUserIds.map(userId => displayNameByUserId.get(userId) ?? '未知玩家')

  await sendHostSecretWithFallback(interaction, game, formatHostSecret({
    civilianWord: result.civilianWord,
    undercoverWord: result.undercoverWord,
    undercoverNames,
    allowLying: game.allowLying,
    failedDmNames,
  }))
}

async function sendHostSecretWithFallback(
  interaction: UndercoverInteraction,
  game: UndercoverGame,
  hostSecretContent: string,
) {
  const secretPayload = panel(hostSecretContent)

  try {
    await interaction.editReply(secretPayload)
    return
  } catch (error) {
    console.error('[Undercover] 编辑主持人答案私密回复失败:', error)
  }

  if ('followUp' in interaction && typeof interaction.followUp === 'function') {
    try {
      await interaction.followUp({ ...secretPayload, ephemeral: true })
      return
    } catch (error) {
      console.error('[Undercover] 补发主持人答案私密回复失败:', error)
    }

    try {
      await interaction.followUp({
        content: '❌ 主持人答案发送失败，请使用 `/卧底 观众偷看` 查看本局答案。',
        ephemeral: true,
      })
      return
    } catch (error) {
      console.error('[Undercover] 补发主持人答案失败提示失败:', error)
    }
  }

  const sentDm = await sendHostSecretDm(interaction, game.hostId, hostSecretContent)
  if (sentDm) return

  await sendPublicHostSecretRecoveryHint(interaction)
}

async function sendHostSecretDm(
  interaction: UndercoverInteraction,
  hostId: string,
  hostSecretContent: string,
): Promise<boolean> {
  try {
    const user = await interaction.client.users.fetch(hostId)
    await user.send(panel(hostSecretContent))
    return true
  } catch (error) {
    console.error(`[Undercover] 私信主持人 ${hostId} 答案失败:`, error)
    return false
  }
}

async function sendPublicHostSecretRecoveryHint(interaction: UndercoverInteraction) {
  const channel = interaction.channel
  if (!channel || !('send' in channel)) return

  await channel.send(panel(
    '## ⚠️ 主持人答案发送失败\n\n' +
    '主持人请使用 `/卧底 观众偷看` 查看本局答案。',
  )).catch(error => {
    console.error('[Undercover] 发送主持人答案公开兜底提示失败:', error)
  })
}

async function sendWordDm(
  interaction: UndercoverInteraction,
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

export async function handleUndercoverButton(interaction: ButtonInteraction) {
  if (interaction.customId === UNDERCOVER_START_BUTTON_ID) {
    await handleOfficialStartButton(interaction)
    return
  }

  if (interaction.customId === UNDERCOVER_SPEECH_BUTTON_ID) {
    await handleSpeechButton(interaction)
    return
  }

  if (interaction.customId === UNDERCOVER_SKIP_SPEECH_BUTTON_ID) {
    await handleSkipSpeechButton(interaction)
    return
  }

  if (interaction.customId === UNDERCOVER_VOTE_BUTTON_ID) {
    await handleVoteButton(interaction)
    return
  }

  if (interaction.customId === UNDERCOVER_HISTORY_BUTTON_ID) {
    await handleHistoryButton(interaction, 1)
    return
  }

  if (interaction.customId.startsWith(UNDERCOVER_HISTORY_PAGE_PREFIX)) {
    const suffix = interaction.customId.slice(UNDERCOVER_HISTORY_PAGE_PREFIX.length)
    const [pageText, ownerId] = suffix.split('_')
    if (interaction.user.id !== ownerId) {
      await interaction.reply({ content: '❌ 只有打开历史的玩家可以翻页。', ephemeral: true })
      return
    }
    await handleHistoryButton(interaction, Number(pageText) || 1, true)
    return
  }

  if (interaction.customId === UNDERCOVER_CLOSE_VOTE_BUTTON_ID) {
    await handleCloseVoteButton(interaction)
  }
}

export async function handleUndercoverSelect(interaction: StringSelectMenuInteraction) {
  if (interaction.customId !== UNDERCOVER_VOTE_SELECT_ID) return

  const channelId = interaction.channelId
  if (!channelId) {
    await interaction.update({ content: '❌ 无法在当前频道投票。', components: [] })
    return
  }

  const targetUserId = interaction.values[0]
  const result = await UndercoverEngine.castVote(channelId, interaction.user.id, targetUserId)
  if (!result.ok) {
    await interaction.update({ content: `❌ ${result.error ?? '投票失败。'}`, components: [] })
    return
  }

  await refreshVoteMessage(interaction)
  const game = UndercoverEngine.getGame(channelId)
  const target = game
    ? (await getDisplayNumberedPlayers(interaction, game, [targetUserId]))[0]
    : null
  const targetLabel = target ? `${target.number}. ${formatDiscordDisplayName(target.displayName)}` : `<@${targetUserId}>`
  await interaction.update({ content: `✅ 已投给 ${targetLabel}。再次点击投票可以改票。`, components: [] })
}

export async function handleUndercoverModal(interaction: ModalSubmitInteraction) {
  if (!interaction.customId.startsWith(UNDERCOVER_SPEECH_MODAL_ID)) return

  await interaction.deferReply({ ephemeral: true })
  const channelId = interaction.channelId
  if (!channelId) {
    await interaction.editReply('❌ 无法在当前频道提交发言。')
    return
  }
  const content = interaction.fields.getTextInputValue(UNDERCOVER_SPEECH_INPUT_ID)
  const beforeGame = UndercoverEngine.getGame(channelId)
  const previousMessageId = beforeGame?.currentSpeech?.messageId
  const result = await UndercoverEngine.submitSpeech(channelId, interaction.user.id, content)

  if (!result.ok) {
    await interaction.editReply(`❌ ${result.error ?? '发言提交失败。'}`)
    return
  }

  await deleteChannelMessage(interaction, previousMessageId)

  if (result.completed) {
    const channel = interaction.channel
    const game = UndercoverEngine.getGame(channelId)
    const round = game?.speechRounds?.find(item => item.round === result.round)
    if (channel && 'send' in channel && game && round) {
      await channel.send(await buildCompletedSpeechPanel(interaction, game, round))
    }
    await interaction.editReply('✅ 发言已记录，本轮发言已结束。')
    return
  }

  const game = UndercoverEngine.getGame(channelId)
  if (game?.currentSpeech) {
    await sendSpeechPanel(interaction, game.currentSpeech, 'send')
  }
  await interaction.editReply('✅ 发言已记录，已轮到下一位玩家。')
}

async function handleOfficialStartButton(interaction: ButtonInteraction) {
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
  await dealAndNotify(interaction, 1)
}

async function handleSpeechButton(interaction: ButtonInteraction) {
  const game = UndercoverEngine.getGame(interaction.channelId)
  const currentUserId = game?.currentSpeech?.order[game.currentSpeech.currentIndex]
  if (!game?.currentSpeech || !currentUserId) {
    await interaction.reply({ content: '❌ 当前没有进行中的发言轮。', ephemeral: true })
    return
  }

  if (interaction.user.id !== currentUserId) {
    await interaction.reply({ content: '❌ 还没有轮到你发言。', ephemeral: true })
    return
  }

  const modal = new ModalBuilder()
    .setCustomId(`${UNDERCOVER_SPEECH_MODAL_ID}_${interaction.channelId}_${interaction.user.id}`)
    .setTitle('谁是卧底发言')
  const speechInput = new TextInputBuilder()
    .setCustomId(UNDERCOVER_SPEECH_INPUT_ID)
    .setLabel('请输入你的发言')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(speechInput))
  await interaction.showModal(modal)
}

async function handleSkipSpeechButton(interaction: ButtonInteraction) {
  const channelId = interaction.channelId
  const beforeGame = UndercoverEngine.getGame(channelId)
  if (!beforeGame?.currentSpeech) {
    await interaction.reply({ content: '❌ 当前没有进行中的发言轮。', ephemeral: true })
    return
  }

  if (beforeGame.hostId !== interaction.user.id) {
    await interaction.reply({ content: '❌ 只有本局主持人可以跳过发言。', ephemeral: true })
    return
  }

  const previousMessageId = beforeGame.currentSpeech.messageId
  await interaction.deferUpdate()
  const result = await UndercoverEngine.skipCurrentSpeech(channelId, interaction.user.id)
  if (!result.ok) {
    await interaction.followUp({ content: `❌ ${result.error ?? '跳过发言失败。'}`, ephemeral: true })
    return
  }

  await deleteChannelMessage(interaction, previousMessageId)

  if (result.completed) {
    const channel = interaction.channel
    const game = UndercoverEngine.getGame(channelId)
    const round = game?.speechRounds?.find(item => item.round === result.round)
    if (channel && 'send' in channel && game && round) {
      await channel.send(await buildCompletedSpeechPanel(interaction, game, round))
    }
    await interaction.followUp({ content: '✅ 已跳过当前发言人，本轮发言已结束。', ephemeral: true })
    return
  }

  const game = UndercoverEngine.getGame(channelId)
  if (game?.currentSpeech) {
    await sendSpeechPanel(interaction, game.currentSpeech, 'send')
  }
  await interaction.followUp({ content: '✅ 已跳过当前发言人，已轮到下一位玩家。', ephemeral: true })
}

async function handleVoteButton(interaction: ButtonInteraction) {
  const game = UndercoverEngine.getGame(interaction.channelId)
  if (!game?.currentVote) {
    await interaction.reply({ content: '❌ 当前没有进行中的投票。', ephemeral: true })
    return
  }

  const aliveUserIds = game.aliveUserIds ?? []
  if (!aliveUserIds.includes(interaction.user.id)) {
    await interaction.reply({ content: '❌ 只有当前存活玩家可以投票。', ephemeral: true })
    return
  }

  const candidates = await getDisplayNumberedPlayers(interaction, game, aliveUserIds)
  await interaction.reply({
    content: '请选择你要投票的玩家。再次投票会覆盖之前的选择。',
    components: [voteSelectRow(candidates)],
    ephemeral: true,
  })
}

async function handleHistoryButton(
  interaction: ButtonInteraction,
  page: number,
  update = false,
) {
  if (update) await interaction.deferUpdate()
  else await interaction.deferReply({ ephemeral: true })

  try {
    const game = UndercoverEngine.getGame(interaction.channelId)
    if (!game) {
      await interaction.editReply({ content: '❌ 当前频道没有进行中的谁是卧底。', components: [] })
      return
    }

    const payload = await buildHistoryPanel(interaction, game, page, interaction.user.id)
    await interaction.editReply(payload)
  } catch (error) {
    console.error('[Undercover] 查看发言历史失败:', error)
    await interaction.editReply({
      content: '❌ 查看历史失败，请稍后再试。',
      components: [],
    }).catch(() => undefined)
  }
}

async function handleCloseVoteButton(interaction: ButtonInteraction) {
  const game = UndercoverEngine.getGame(interaction.channelId)
  if (!game) {
    await interaction.reply({ content: '❌ 当前频道没有进行中的谁是卧底。', ephemeral: true })
    return
  }

  if (game.hostId !== interaction.user.id) {
    await interaction.reply({ content: '❌ 只有本局主持人可以结束投票。', ephemeral: true })
    return
  }

  if (!game.currentVote) {
    await interaction.reply({ content: '❌ 当前没有进行中的投票。', ephemeral: true })
    return
  }

  await interaction.deferUpdate()
  clearVoteTimers(interaction.channelId)
  const voteMessageId = game.currentVote.messageId
  const result = await UndercoverEngine.closeVote(interaction.channelId)
  await editVoteMessageClosed(interaction, voteMessageId)
  await announceVoteResult(interaction, game, result.result)
}

async function refreshVoteMessage(interaction: UndercoverInteraction) {
  const channelId = interaction.channelId
  if (!channelId) return
  const game = UndercoverEngine.getGame(channelId)
  const messageId = game?.currentVote?.messageId
  if (!game || !messageId) return

  const channel = interaction.channel
  if (!channel || !('messages' in channel)) return
  const message = await channel.messages.fetch(messageId).catch(() => null)
  if (!message) return
  await message.edit(await buildVotePanel(interaction, game)).catch(() => undefined)
}

async function editVoteMessageClosed(interaction: UndercoverRuntimeContext, messageId?: string) {
  if (!messageId) return
  const channel = interaction.channel
  if (!channel || !('messages' in channel)) return
  const message = await channel.messages.fetch(messageId).catch(() => null)
  if (!message) return
  await message.edit(panelWithRows('## 🗳️ 投票已结束\n\n本轮投票已经结算。', [voteActionRow(true)])).catch(() => undefined)
}

async function deleteChannelMessage(interaction: UndercoverRuntimeContext, messageId?: string) {
  if (!messageId) return
  const channel = interaction.channel
  if (!channel || !('messages' in channel)) return
  const message = await channel.messages.fetch(messageId).catch(() => null)
  if (!message) return
  await message.delete().catch(() => undefined)
}

async function announceVoteResult(
  interaction: UndercoverRuntimeContext,
  gameBeforeClose: UndercoverGame,
  result?: Awaited<ReturnType<typeof UndercoverEngine.closeVote>>['result'],
) {
  const channel = interaction.channel
  if (!channel || !('send' in channel) || !result) return

  if (result.type === 'tie') {
    const tiedPlayers = await getDisplayNumberedPlayers(interaction, gameBeforeClose, result.tiedUserIds)
    await channel.send(panel(
      `## 🟰 投票平局\n\n` +
      `当前是 ${tiedPlayers.map(player => `**${formatDiscordDisplayName(player.displayName)}**`).join(' 和 ')} 平局。`,
    ))
    return
  }

  const eliminated = (await getDisplayNumberedPlayers(interaction, gameBeforeClose, [result.eliminatedUserId]))[0]
  const label = eliminated ? formatDiscordDisplayName(eliminated.displayName) : `<@${result.eliminatedUserId}>`
  await channel.send(panel(
    `## 🗳️ 投票结果\n\n` +
    `**${label}** 遗憾出局。`,
  ))
}

async function resolveDisplayName(
  interaction: UndercoverRuntimeContext,
  userId: string,
): Promise<string> {
  const member = await interaction.guild?.members.fetch(userId).catch(() => null)
  if (member?.displayName) return member.displayName

  const user = await interaction.client.users.fetch(userId).catch(() => null)
  return user?.displayName ?? user?.username ?? '未知玩家'
}
