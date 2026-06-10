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
  formatHostSecret,
  formatLobbyMessage,
  formatSpeechOrder,
  getRandomUndercoverWordPair,
  UndercoverEngine,
  UNDERCOVER_JOIN_EMOJI,
  type DisplayPlayer,
  type UndercoverAssignment,
  type UndercoverWordPair,
} from '../game/undercover.js'

const text = (content: string) => ({ type: 10, content })
const box = (children: any[]) => ({ type: 17, components: children })
const componentsV2Flags = ['IsComponentsV2'] as const
const panel = (content: string) => ({
  components: [box([text(content)])],
  flags: componentsV2Flags,
})

export const data = new SlashCommandBuilder()
  .setName('卧底')
  .setDescription('谁是卧底游戏')
  .addSubcommand(sub => sub
    .setName('开始')
    .setDescription('创建谁是卧底报名局')
  )
  .addSubcommand(sub => sub
    .setName('自定义发词')
    .setDescription('主持人填写平民词和卧底词后发词')
  )
  .addSubcommand(sub => sub
    .setName('随机发词')
    .setDescription('从词库随机抽词并发给玩家')
  )
  .addSubcommand(sub => sub
    .setName('结束')
    .setDescription('结束当前谁是卧底')
  )

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) {
    await interaction.reply({ content: '❌ 谁是卧底只能在服务器频道中使用。', ephemeral: true })
    return
  }

  const sub = interaction.options.getSubcommand()

  if (sub === '开始') {
    await handleStart(interaction)
    return
  }

  if (sub === '自定义发词') {
    await handleCustomDeal(interaction)
    return
  }

  if (sub === '随机发词') {
    await handleRandomDeal(interaction)
    return
  }

  if (sub === '结束') {
    await handleEnd(interaction)
  }
}

async function handleStart(interaction: ChatInputCommandInteraction) {
  const result = UndercoverEngine.startGame(interaction.channelId, interaction.user.id)
  if (!result.ok) {
    await interaction.reply({ content: `❌ ${result.error}`, ephemeral: true })
    return
  }

  const hostName = await resolveDisplayName(interaction, interaction.user.id)
  await interaction.reply(panel(formatLobbyMessage(hostName)))

  const message = await interaction.fetchReply()
  UndercoverEngine.setJoinMessage(interaction.channelId, message.id)

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

async function handleCustomDeal(interaction: ChatInputCommandInteraction) {
  const game = UndercoverEngine.getGame(interaction.channelId)
  if (!game) {
    await interaction.reply({ content: '❌ 当前频道没有进行中的谁是卧底。', ephemeral: true })
    return
  }

  if (game.hostId !== interaction.user.id) {
    await interaction.reply({ content: '❌ 只有主持人可以发词。', ephemeral: true })
    return
  }

  if (game.players.length < 3) {
    await interaction.reply({
      content: `❌ 至少需要 3 名玩家才能发词。当前玩家数：${game.players.length}`,
      ephemeral: true,
    })
    return
  }

  const modalId = `undercover_custom_words_${interaction.channelId}_${interaction.user.id}`
  const modal = new ModalBuilder()
    .setCustomId(modalId)
    .setTitle('谁是卧底自定义发词')

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

  await submitted.deferReply({ ephemeral: true })
  const pair: UndercoverWordPair = {
    civilian: submitted.fields.getTextInputValue('civilian_word').trim(),
    undercover: submitted.fields.getTextInputValue('undercover_word').trim(),
  }

  await dealAndNotify(submitted, pair)
}

async function handleRandomDeal(interaction: ChatInputCommandInteraction) {
  try {
    UndercoverEngine.assertHost(interaction.channelId, interaction.user.id)
  } catch (error: any) {
    await interaction.reply({ content: `❌ ${error.message}`, ephemeral: true })
    return
  }

  await interaction.deferReply({ ephemeral: true })
  await dealAndNotify(interaction, getRandomUndercoverWordPair())
}

async function handleEnd(interaction: ChatInputCommandInteraction) {
  const game = UndercoverEngine.getGame(interaction.channelId)
  if (!game) {
    await interaction.reply({ content: '❌ 当前频道没有进行中的谁是卧底。', ephemeral: true })
    return
  }

  if (game.hostId !== interaction.user.id) {
    await interaction.reply({ content: '❌ 只有主持人可以结束本局谁是卧底。', ephemeral: true })
    return
  }

  UndercoverEngine.endGame(interaction.channelId)
  await interaction.reply(panel('## 🏁 本局谁是卧底已结束。'))
}

async function dealAndNotify(
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
  pair: UndercoverWordPair,
) {
  const guild = interaction.guild
  const channel = interaction.channel
  const channelId = interaction.channelId

  if (!guild || !channel || !channelId || !('send' in channel)) {
    await interaction.editReply('❌ 无法在当前频道发词。')
    return
  }

  let result
  try {
    result = UndercoverEngine.dealWords(channelId, pair)
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
    const sent = await sendWordDm(interaction, assignment, displayName)
    if (!sent) failedDmNames.push(displayName)
  }

  const publicContent =
    `## 🎭 发词完成，请查看私信。\n` +
    `如果没收到私信，请联系主持人发词。\n\n` +
    formatSpeechOrder(displayPlayers)

  await channel.send(panel(publicContent))

  const undercoverName = displayPlayers.find(player => player.userId === result.undercoverUserId)?.displayName
    ?? '未知玩家'

  await interaction.editReply(panel(formatHostSecret({
    civilianWord: result.civilianWord,
    undercoverWord: result.undercoverWord,
    undercoverName,
    failedDmNames,
  })))
}

async function sendWordDm(
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
  assignment: UndercoverAssignment,
  displayName: string,
): Promise<boolean> {
  try {
    const user = await interaction.client.users.fetch(assignment.userId)
    await user.send(panel(
      `## 🎭 谁是卧底\n\n` +
      `你的词是：**${assignment.word}**`,
    ))
    return true
  } catch (error) {
    console.error(`[Undercover] 私信 ${assignment.userId} 失败:`, error)
    return false
  }
}

async function resolveDisplayName(
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
  userId: string,
): Promise<string> {
  const member = await interaction.guild?.members.fetch(userId).catch(() => null)
  if (member?.displayName) return member.displayName

  const user = await interaction.client.users.fetch(userId).catch(() => null)
  return user?.displayName ?? user?.username ?? '未知玩家'
}
