import assert from 'node:assert/strict'
import {
  data as undercoverCommandData,
  execute as executeUndercoverCommand,
  handleUndercoverButton,
  handleUndercoverModal,
} from './commands/undercover.js'
import {
  UndercoverEngine,
  formatAudiencePeek,
  formatEndReveal,
  formatHostSecret,
  formatLobbyMessage,
  formatUndercoverPlayerList,
  formatUndercoverVoteOptions,
  formatPreparedEnd,
  formatSpeechOrder,
  getVoteReminderOffsets,
  parseUndercoverWordPairs,
  shuffleSpeechOrder,
  shouldSendVoteEndingSoon,
} from './game/undercover.js'

console.log('🧪 开始谁是卧底核心逻辑测试...\n')

function getPanelText(payload: any): string {
  return payload?.components?.[0]?.components?.[0]?.content ?? ''
}

function sequenceRng(values: number[]): () => number {
  let index = 0
  return () => values[index++] ?? 0
}

await UndercoverEngine.resetAllForTest()

const parsedPairs = parseUndercoverWordPairs(`
苹果 梨
脸盆 水桶

手机	电脑
`)

assert.deepEqual(parsedPairs, [
  { civilian: '苹果', undercover: '梨' },
  { civilian: '脸盆', undercover: '水桶' },
  { civilian: '手机', undercover: '电脑' },
])
console.log('✅ 词库解析支持空行、Tab 和特殊空格')

const channelId = 'undercover-test-channel'
const hostId = 'host-user'

const start = await UndercoverEngine.startGame(channelId, hostId, {
  wordSource: 'custom',
  civilianWord: '苹果',
  undercoverWord: '梨',
  allowLying: true,
})
assert.equal(start.ok, true)
assert.equal(UndercoverEngine.hasActiveGame(channelId), true)
assert.equal(start.game?.hostId, hostId)
assert.equal(start.game?.wordSource, 'custom')
assert.equal(start.game?.civilianWord, '苹果')
assert.equal(start.game?.undercoverWord, '梨')
assert.equal(start.game?.allowLying, true)
console.log('✅ 报名阶段保存主持人、词汇来源、词语和撒谎规则')

assert.throws(
  () => UndercoverEngine.assertHost(channelId, 'not-host'),
  /只有主持人/,
)
assert.doesNotThrow(() => UndercoverEngine.assertHost(channelId, hostId))
console.log('✅ 主持人权限通过创建者数字 ID 判断')

assert.equal((await UndercoverEngine.addPlayer(channelId, 'u1')).added, true)
assert.equal((await UndercoverEngine.addPlayer(channelId, 'u1')).added, false)
assert.equal((await UndercoverEngine.addPlayer(channelId, 'u2')).added, true)

await assert.rejects(
  () => UndercoverEngine.dealWords(channelId, () => 0),
  /至少需要 3 名玩家/,
)

assert.equal((await UndercoverEngine.addPlayer(channelId, 'u3')).added, true)
console.log('✅ 报名状态支持去重，并阻止少于 3 人正式开始')

const dealResult = await UndercoverEngine.dealWords(channelId, sequenceRng([0, 0]))

assert.equal(dealResult.undercoverUserId, 'u1')
assert.deepEqual(
  dealResult.assignments.map(a => ({ userId: a.userId, role: a.role, word: a.word })),
  [
    { userId: 'u1', role: 'undercover', word: '梨' },
    { userId: 'u2', role: 'civilian', word: '苹果' },
    { userId: 'u3', role: 'civilian', word: '苹果' },
  ],
)
assert.equal((await UndercoverEngine.addPlayer(channelId, 'u4')).reason, 'already_dealt')
assert.equal((await UndercoverEngine.removePlayer(channelId, 'u2')).removed, false)
console.log('✅ 正式开始会随机选出 1 名卧底、生成词语分配，并冻结报名')

const commandNames = undercoverCommandData.toJSON().options?.map((option: any) => option.name)
assert.deepEqual(
  commandNames,
  ['报名阶段', '正式开始', '开始发言', '投票', '游戏通知', '观众偷看', '结束', '帮助'],
)
console.log('✅ 谁是卧底保留原命令并注册开始发言、投票命令')

const dealtGame = UndercoverEngine.getGame(channelId)
assert.deepEqual(
  dealtGame?.fixedPlayers?.map(player => ({ userId: player.userId, number: player.number })),
  [
    { userId: 'u2', number: 1 },
    { userId: 'u3', number: 2 },
    { userId: 'u1', number: 3 },
  ],
)
assert.deepEqual(dealtGame?.aliveUserIds, ['u2', 'u3', 'u1'])
assert.deepEqual(dealtGame?.eliminatedUserIds, [])
console.log('✅ 正式开始会按随机发言顺序固定玩家序号并初始化存活名单')

const numberedPlayers = [
  { userId: 'u1', number: 1, displayName: '用户A' },
  { userId: 'u2', number: 2, displayName: '用户B' },
  { userId: 'u3', number: 3, displayName: '用户C' },
]
assert.equal(
  formatUndercoverPlayerList(numberedPlayers),
  '**1.** 用户A\n**2.** 用户B\n**3.** 用户C',
)
assert.deepEqual(
  formatUndercoverVoteOptions(numberedPlayers),
  [
    { label: '1. 用户A', value: 'u1' },
    { label: '2. 用户B', value: 'u2' },
    { label: '3. 用户C', value: 'u3' },
  ],
)
console.log('✅ 玩家列表和投票下拉选项使用固定序号加玩家名')

const speechStart = await UndercoverEngine.startSpeechRound(channelId, () => 0)
assert.equal(speechStart.ok, true)
assert.deepEqual(speechStart.speech?.order, ['u2', 'u3', 'u1'])
assert.equal((await UndercoverEngine.submitSpeech(channelId, 'u1', '抢话')).ok, false)
assert.deepEqual(await UndercoverEngine.submitSpeech(channelId, 'u2', '我是第一位'), {
  ok: true,
  completed: false,
  round: 1,
  currentUserId: 'u3',
})
assert.deepEqual(await UndercoverEngine.submitSpeech(channelId, 'u3', '我是第二位'), {
  ok: true,
  completed: false,
  round: 1,
  currentUserId: 'u1',
})
assert.deepEqual(await UndercoverEngine.submitSpeech(channelId, 'u1', '我是第三位'), {
  ok: true,
  completed: true,
  round: 1,
})
const afterSpeech = UndercoverEngine.getGame(channelId)
assert.equal(afterSpeech?.currentSpeech, undefined)
assert.deepEqual(
  afterSpeech?.speechRounds?.[0].entries.map(entry => ({ userId: entry.userId, content: entry.content })),
  [
    { userId: 'u2', content: '我是第一位' },
    { userId: 'u3', content: '我是第二位' },
    { userId: 'u1', content: '我是第三位' },
  ],
)
console.log('✅ 发言流程只允许当前玩家发言，并按整轮保存历史')

let voteStart = await UndercoverEngine.startVote(channelId, 5)
assert.equal(voteStart.ok, true)
assert.equal(voteStart.vote?.endsAt !== undefined, true)
assert.deepEqual(await UndercoverEngine.castVote(channelId, 'u1', 'u2'), { ok: true })
assert.deepEqual(await UndercoverEngine.castVote(channelId, 'u2', 'u1'), { ok: true })
let voteClose = await UndercoverEngine.closeVote(channelId)
assert.equal(voteClose.ok, true)
assert.equal(voteClose.result?.type, 'tie')
assert.deepEqual(voteClose.result?.tiedUserIds, ['u2', 'u1'])
assert.deepEqual(UndercoverEngine.getGame(channelId)?.aliveUserIds, ['u2', 'u3', 'u1'])

voteStart = await UndercoverEngine.startVote(channelId)
assert.equal(voteStart.ok, true)
assert.deepEqual(await UndercoverEngine.castVote(channelId, 'u1', 'u2'), { ok: true })
assert.deepEqual(await UndercoverEngine.castVote(channelId, 'u2', 'u2'), { ok: true })
assert.deepEqual(await UndercoverEngine.castVote(channelId, 'u3', 'u1'), { ok: true })
assert.deepEqual(await UndercoverEngine.castVote(channelId, 'u3', 'u2'), { ok: true })
voteClose = await UndercoverEngine.closeVote(channelId)
assert.equal(voteClose.result?.type, 'eliminated')
assert.equal(voteClose.result?.eliminatedUserId, 'u2')
assert.deepEqual(UndercoverEngine.getGame(channelId)?.aliveUserIds, ['u3', 'u1'])
assert.deepEqual(UndercoverEngine.getGame(channelId)?.fixedPlayers?.map(player => player.number), [1, 2, 3])
console.log('✅ 投票支持改票、平票不淘汰、唯一最高票淘汰且不重排序号')

assert.deepEqual(getVoteReminderOffsets(60_000), [])
assert.deepEqual(getVoteReminderOffsets(3 * 60_000), [60_000])
assert.deepEqual(getVoteReminderOffsets(5 * 60_000), [60_000])
assert.deepEqual(getVoteReminderOffsets(8 * 60_000), [5 * 60_000, 60_000])
assert.deepEqual(getVoteReminderOffsets(20 * 60_000), [10 * 60_000, 5 * 60_000, 60_000])
assert.equal(shouldSendVoteEndingSoon(59_999), false)
assert.equal(shouldSendVoteEndingSoon(60_000), true)
console.log('✅ 投票面板下沉提醒按总时长分档，并避免开票时立刻重复下沉')

const nextSpeech = await UndercoverEngine.startSpeechRound(channelId, () => 0)
assert.equal(nextSpeech.ok, true)
assert.deepEqual(nextSpeech.speech?.order, ['u3', 'u1'])
console.log('✅ 下一轮发言只包含存活玩家但继续沿用固定序号')

const speechPanelChannelId = 'undercover-speech-panel-channel'
await UndercoverEngine.startGame(speechPanelChannelId, hostId, {
  wordSource: 'custom',
  civilianWord: '白天',
  undercoverWord: '黑夜',
  allowLying: false,
})
await UndercoverEngine.addPlayer(speechPanelChannelId, 's1')
await UndercoverEngine.addPlayer(speechPanelChannelId, 's2')
await UndercoverEngine.addPlayer(speechPanelChannelId, 's3')
await UndercoverEngine.dealWords(speechPanelChannelId, sequenceRng([0, 0, 0]))
let speechPanelReply: any
const originalRandom = Math.random
Math.random = sequenceRng([0, 0])
await executeUndercoverCommand({
  guild: {
    members: {
      fetch: async (userId: string) => ({ displayName: `玩家${userId}` }),
    },
  },
  client: {
    users: {
      fetch: async (userId: string) => ({ displayName: `玩家${userId}`, username: userId }),
    },
  },
  channelId: speechPanelChannelId,
  user: { id: hostId },
  options: { getSubcommand: () => '开始发言' },
  reply: async (payload: any) => {
    speechPanelReply = payload
  },
  fetchReply: async () => ({ id: 'speech-panel-message' }),
} as any)
Math.random = originalRandom
const speechPanelButtons = speechPanelReply.components?.[1]?.components?.map((component: any) => component.label)
assert.deepEqual(speechPanelButtons, ['发言', '查看历史'])
assert.equal(getPanelText(speechPanelReply).includes('本轮发言'), false)
let deletedSpeechPanel = false
let nextSpeechPanel: any
await handleUndercoverModal({
  customId: 'undercover_speech_modal_undercover-speech-panel-channel_s2',
  channelId: speechPanelChannelId,
  user: { id: 's2' },
  fields: {
    getTextInputValue: () => '本轮第一段发言',
  },
  guild: {
    members: {
      fetch: async (userId: string) => ({ displayName: `玩家${userId}` }),
    },
  },
  client: {
    users: {
      fetch: async (userId: string) => ({ displayName: `玩家${userId}`, username: userId }),
    },
  },
  channel: {
    messages: {
      fetch: async (messageId: string) => {
        assert.equal(messageId, 'speech-panel-message')
        return {
          delete: async () => {
            deletedSpeechPanel = true
          },
        }
      },
    },
    send: async (payload: any) => {
      nextSpeechPanel = payload
      return { id: 'speech-panel-message-2' }
    },
  },
  deferReply: async (payload: any) => {
    assert.equal(payload.ephemeral, true)
  },
  editReply: async () => undefined,
} as any)
assert.equal(deletedSpeechPanel, true)
assert.equal(getPanelText(nextSpeechPanel).includes('本轮第一段发言'), true)
assert.equal(getPanelText(nextSpeechPanel).includes('---'), true)
let speechHistoryReply: any
await handleUndercoverButton({
  customId: 'undercover_history_open',
  channelId: speechPanelChannelId,
  user: { id: 's3' },
  guild: {
    members: {
      fetch: async (userId: string) => ({ displayName: `玩家${userId}` }),
    },
  },
  client: {
    users: {
      fetch: async (userId: string) => ({ displayName: `玩家${userId}`, username: userId }),
    },
  },
  reply: async (payload: any) => {
    speechHistoryReply = payload
  },
} as any)
assert.equal(speechHistoryReply.ephemeral, true)
assert.equal(getPanelText(speechHistoryReply).includes('暂无发言记录'), true)
assert.equal(speechHistoryReply.components.length, 1)
await UndercoverEngine.endGame(speechPanelChannelId)
console.log('✅ 发言面板直接展示本轮发言，历史只展示已完成轮次')

const speechOrder = formatSpeechOrder([
  { userId: 'u1', displayName: '用户A' },
  { userId: 'u2', displayName: '用户B' },
  { userId: 'u3', displayName: '用户C' },
])

assert.equal(
  speechOrder,
  '**建议发言顺序：**\n**1.** 用户A\n**2.** 用户B\n**3.** 用户C',
)
assert.equal(speechOrder.includes('<@'), false)
console.log('✅ 公开发言顺序使用服务器昵称，不艾特玩家')

const originalSpeechPlayers = [
  { userId: 'u1', displayName: '用户A' },
  { userId: 'u2', displayName: '用户B' },
  { userId: 'u3', displayName: '用户C' },
]
const shuffledSpeechPlayers = shuffleSpeechOrder(originalSpeechPlayers, sequenceRng([0, 0]))
assert.deepEqual(
  shuffledSpeechPlayers.map(player => player.userId),
  ['u2', 'u3', 'u1'],
)
assert.deepEqual(
  originalSpeechPlayers.map(player => player.userId),
  ['u1', 'u2', 'u3'],
)
console.log('✅ 发言顺序工具会随机打乱且不修改原数组')

const lobbyMessage = formatLobbyMessage({
  hostName: '主持人A',
  wordSource: 'custom',
  allowLying: true,
})
assert.equal(
  lobbyMessage,
  '## 🎭 谁是卧底报名开始\n\n**主持人：**主持人A\n**词汇来源：**自定义发词\n**可否撒谎：**是\n请点击 ✅ 报名。\n主持人使用 `/卧底 正式开始` 停止报名并发词。',
)
console.log('✅ 报名面板展示词汇来源、撒谎规则和正式开始命令')

const officialPanelChannelId = 'undercover-official-panel-channel'
await UndercoverEngine.startGame(officialPanelChannelId, hostId, {
  wordSource: 'custom',
  civilianWord: '苹果',
  undercoverWord: '梨',
  allowLying: true,
})
await UndercoverEngine.addPlayer(officialPanelChannelId, 'p1')
await UndercoverEngine.addPlayer(officialPanelChannelId, 'p2')
await UndercoverEngine.addPlayer(officialPanelChannelId, 'p3')
let officialPublicPanel: any
let officialSecretReply: any
Math.random = sequenceRng([0, 0, 0])
await executeUndercoverCommand({
  guild: {
    members: {
      fetch: async (userId: string) => ({ displayName: `玩家${userId}` }),
    },
  },
  client: {
    users: {
      fetch: async (userId: string) => ({
        displayName: `玩家${userId}`,
        username: userId,
        send: async () => undefined,
      }),
    },
  },
  channelId: officialPanelChannelId,
  channel: {
    send: async (payload: any) => {
      officialPublicPanel = payload
    },
  },
  user: { id: hostId },
  options: { getSubcommand: () => '正式开始' },
  deferReply: async (payload: any) => {
    assert.equal(payload.ephemeral, true)
  },
  editReply: async (payload: any) => {
    officialSecretReply = payload
  },
} as any)
Math.random = originalRandom
const officialPublicText = getPanelText(officialPublicPanel)
assert.equal(officialPublicText.includes('**发言顺序：**'), true)
assert.equal(officialPublicText.includes('玩家固定序号'), false)
assert.equal(officialPublicText.includes('建议发言顺序'), false)
assert.equal(officialPublicText.includes('**1.** 玩家p2\n**2.** 玩家p3\n**3.** 玩家p1'), true)
assert.equal(getPanelText(officialSecretReply).includes('**卧底：**玩家p1'), true)
await UndercoverEngine.endGame(officialPanelChannelId)
console.log('✅ 正式开始公开面板只展示随机固定发言顺序这一套编号')

const hostSecret = formatHostSecret({
  civilianWord: '苹果',
  undercoverWord: '梨',
  undercoverName: '用户A',
  allowLying: true,
  failedDmNames: ['用户C'],
})

assert.equal(
  hostSecret,
  '## 本局词语\n\n**平民词：**苹果\n**卧底词：**梨\n**可否撒谎：**是\n\n**卧底：**用户A\n\n**私信失败：**用户C',
)
console.log('✅ 主持人秘密信息包含词语、卧底、撒谎规则和私信失败提示')

const endReveal = formatEndReveal({
  civilianWord: '苹果',
  undercoverWord: '梨',
  undercoverName: '用户A',
})

assert.equal(
  endReveal,
  '## 🏁 谁是卧底结束\n\n**平民词：**苹果\n**卧底词：**梨\n\n**卧底：**用户A',
)
console.log('✅ 正式开始后结束公开信息包含平民词、卧底词和卧底')

const audiencePeek = formatAudiencePeek({
  civilianWord: '苹果',
  undercoverWord: '梨',
  undercoverName: '用户A',
})

assert.equal(
  audiencePeek,
  '## 👀 观众偷看\n\n**平民词：**苹果\n**卧底词：**梨\n\n**卧底：**用户A\n\n请不要泄露词汇和卧底身份。',
)
console.log('✅ 观众偷看信息包含平民词、卧底词、卧底和保密提醒')

let hostPeekReply: any
await executeUndercoverCommand({
  guild: {},
  channelId,
  user: { id: hostId },
  options: { getSubcommand: () => '观众偷看' },
  reply: async (payload: any) => {
    hostPeekReply = payload
  },
} as any)
assert.equal(hostPeekReply.content, '❌ 主持人已经知道答案，不能使用观众偷看。')

let playerPeekReply: any
await executeUndercoverCommand({
  guild: {},
  channelId,
  user: { id: 'u2' },
  options: { getSubcommand: () => '观众偷看' },
  reply: async (payload: any) => {
    playerPeekReply = payload
  },
} as any)
assert.equal(playerPeekReply.content, '❌ 参与者不能使用观众偷看。')

let audiencePeekDeferred = false
let audiencePeekEdit: any
await executeUndercoverCommand({
  guild: {
    members: {
      fetch: async () => ({ displayName: '用户A' }),
    },
  },
  client: {
    users: {
      fetch: async () => ({ displayName: '用户A', username: 'user-a' }),
    },
  },
  channelId,
  user: { id: 'audience-user' },
  options: { getSubcommand: () => '观众偷看' },
  deferReply: async (payload: any) => {
    audiencePeekDeferred = payload?.ephemeral === true
  },
  editReply: async (payload: any) => {
    audiencePeekEdit = payload
  },
} as any)
assert.equal(audiencePeekDeferred, true)
assert.equal(getPanelText(audiencePeekEdit), audiencePeek)
console.log('✅ 观众偷看仅允许非主持人、非参与者使用，并会私密返回答案')

await UndercoverEngine.endGame(channelId)
assert.equal(UndercoverEngine.hasActiveGame(channelId), false)

const preparedChannelId = 'undercover-prepared-channel'
const prepared = await UndercoverEngine.startGame(preparedChannelId, hostId, {
  wordSource: 'random',
  civilianWord: '猫',
  undercoverWord: '狗',
  allowLying: false,
})
assert.equal(prepared.ok, true)
assert.equal(prepared.game?.wordSource, 'random')
assert.equal(prepared.game?.allowLying, false)

const preparedEnd = formatPreparedEnd()

assert.equal(
  preparedEnd,
  '## 🏁 谁是卧底结束\n\n本局尚未正式开始，卧底尚未分配。',
)
assert.equal(preparedEnd.includes(prepared.game!.civilianWord), false)
assert.equal(preparedEnd.includes(prepared.game!.undercoverWord), false)
console.log('✅ 未正式开始时结束会说明卧底尚未分配，并且不会公布已准备词语')

let preDealPeekReply: any
await executeUndercoverCommand({
  guild: {},
  channelId: preparedChannelId,
  user: { id: 'audience-before-deal' },
  options: { getSubcommand: () => '观众偷看' },
  reply: async (payload: any) => {
    preDealPeekReply = payload
  },
} as any)
assert.equal(preDealPeekReply.content.includes(prepared.game!.civilianWord), false)
assert.equal(preDealPeekReply.content.includes(prepared.game!.undercoverWord), false)
console.log('✅ 未正式开始时观众偷看不会泄露词语')

const reloadChannelId = 'undercover-reload-channel'
const reloadStart = await UndercoverEngine.startGame(reloadChannelId, hostId, {
  wordSource: 'custom',
  civilianWord: '月亮',
  undercoverWord: '太阳',
  allowLying: true,
})
assert.equal(reloadStart.ok, true)
await UndercoverEngine.setJoinMessage(reloadChannelId, 'join-message-1')
await UndercoverEngine.addPlayer(reloadChannelId, 'r1')
await UndercoverEngine.addPlayer(reloadChannelId, 'r2')
await UndercoverEngine.addPlayer(reloadChannelId, 'r3')
const reloadDeal = await UndercoverEngine.dealWords(reloadChannelId, () => 0)
assert.equal(reloadDeal.undercoverUserId, 'r1')
await UndercoverEngine.startSpeechRound(reloadChannelId, () => 0)
await UndercoverEngine.submitSpeech(reloadChannelId, 'r2', '重载前发言')
await UndercoverEngine.startVote(reloadChannelId, 3)
await UndercoverEngine.castVote(reloadChannelId, 'r1', 'r2')
assert.equal(await UndercoverEngine.setVoteMessage(reloadChannelId, 'old-vote-message'), undefined)
assert.equal(await UndercoverEngine.setVoteMessage(reloadChannelId, 'new-vote-message'), 'old-vote-message')
assert.equal(UndercoverEngine.getGame(reloadChannelId)?.currentVote?.messageId, 'new-vote-message')
console.log('✅ 更新当前投票面板 ID 时会返回旧面板 ID，便于保持频道内只有一个投票面板')

UndercoverEngine.clearCacheForTest()
assert.equal(UndercoverEngine.hasActiveGame(reloadChannelId), false)
await UndercoverEngine.reloadFromStoreForTest()
const reloadedGame = UndercoverEngine.getGame(reloadChannelId)
assert.equal(reloadedGame?.joinMessageId, 'join-message-1')
assert.deepEqual(reloadedGame?.players.map(player => player.userId), ['r1', 'r2', 'r3'])
assert.equal(reloadedGame?.deal?.undercoverUserId, 'r1')
assert.deepEqual(reloadedGame?.fixedPlayers?.map(player => player.number), [1, 2, 3])
assert.deepEqual(reloadedGame?.fixedPlayers?.map(player => player.userId), ['r2', 'r3', 'r1'])
assert.deepEqual(reloadedGame?.aliveUserIds, ['r2', 'r3', 'r1'])
assert.deepEqual(reloadedGame?.currentSpeech?.entries.map(entry => entry.content), ['重载前发言'])
assert.deepEqual(reloadedGame?.currentVote?.votes, { r1: 'r2' })
assert.equal(reloadedGame?.currentVote?.messageId, 'new-vote-message')
await UndercoverEngine.endGame(reloadChannelId)
UndercoverEngine.clearCacheForTest()
await UndercoverEngine.reloadFromStoreForTest()
assert.equal(UndercoverEngine.hasActiveGame(reloadChannelId), false)
console.log('✅ 谁是卧底状态写入存储，并可在重载缓存后恢复和删除')

const resurfaceChannelId = 'undercover-resurface-channel'
await UndercoverEngine.startGame(resurfaceChannelId, hostId, {
  wordSource: 'custom',
  civilianWord: '咖啡',
  undercoverWord: '奶茶',
  allowLying: false,
})
await UndercoverEngine.addPlayer(resurfaceChannelId, 'v1')
await UndercoverEngine.addPlayer(resurfaceChannelId, 'v2')
await UndercoverEngine.addPlayer(resurfaceChannelId, 'v3')
await UndercoverEngine.dealWords(resurfaceChannelId, () => 0)
await UndercoverEngine.startVote(resurfaceChannelId, 5)
await UndercoverEngine.castVote(resurfaceChannelId, 'v1', 'v2')
await UndercoverEngine.setVoteMessage(resurfaceChannelId, 'old-panel')
const originalVote = UndercoverEngine.getGame(resurfaceChannelId)?.currentVote
let deletedOldPanel = false
let resurfaceReply: any
let resurfaceFollowUp: any
await executeUndercoverCommand({
  guild: {
    members: {
      fetch: async (userId: string) => ({ displayName: `玩家${userId}` }),
    },
  },
  client: {
    users: {
      fetch: async (userId: string) => ({ displayName: `玩家${userId}`, username: userId }),
    },
  },
  channelId: resurfaceChannelId,
  channel: {
    messages: {
      fetch: async (messageId: string) => {
        assert.equal(messageId, 'old-panel')
        return {
          delete: async () => {
            deletedOldPanel = true
          },
        }
      },
    },
  },
  user: { id: hostId },
  options: {
    getSubcommand: () => '投票',
    getInteger: () => 9,
  },
  reply: async (payload: any) => {
    resurfaceReply = payload
  },
  fetchReply: async () => ({ id: 'new-panel' }),
  followUp: async (payload: any) => {
    resurfaceFollowUp = payload
  },
} as any)
const resurfacedVote = UndercoverEngine.getGame(resurfaceChannelId)?.currentVote
assert.equal(getPanelText(resurfaceReply).includes('谁是卧底投票'), true)
assert.equal(deletedOldPanel, true)
assert.equal(resurfacedVote?.messageId, 'new-panel')
assert.equal(resurfacedVote?.endsAt, originalVote?.endsAt)
assert.deepEqual(resurfacedVote?.votes, { v1: 'v2' })
assert.equal(resurfaceFollowUp.ephemeral, true)
assert.equal(resurfaceFollowUp.content.includes('讨论时间不变'), true)
await UndercoverEngine.endGame(resurfaceChannelId)
console.log('✅ 主持人可重新唤出当前投票面板，旧面板会删除且讨论时间与选票不变')

const timerChannelId = 'undercover-vote-timer-channel'
await UndercoverEngine.startGame(timerChannelId, hostId, {
  wordSource: 'custom',
  civilianWord: '太阳',
  undercoverWord: '月亮',
  allowLying: false,
})
await UndercoverEngine.addPlayer(timerChannelId, 't1')
await UndercoverEngine.addPlayer(timerChannelId, 't2')
await UndercoverEngine.addPlayer(timerChannelId, 't3')
await UndercoverEngine.dealWords(timerChannelId, () => 0)
const capturedTimers: Array<{ callback: () => void; delay: number }> = []
const originalSetTimeout = globalThis.setTimeout
const originalClearTimeout = globalThis.clearTimeout
globalThis.setTimeout = ((callback: () => void, delay?: number) => {
  const timer = { callback, delay: delay ?? 0 }
  capturedTimers.push(timer)
  return timer as any
}) as any
globalThis.clearTimeout = (() => undefined) as any
let timerPanelReply: any
const timerMessages: string[] = []
await executeUndercoverCommand({
  guild: {
    members: {
      fetch: async (userId: string) => ({ displayName: `玩家${userId}` }),
    },
  },
  client: {
    users: {
      fetch: async (userId: string) => ({ displayName: `玩家${userId}`, username: userId }),
    },
  },
  channelId: timerChannelId,
  channel: {
    send: async (payload: any) => {
      timerMessages.push(typeof payload === 'string' ? payload : getPanelText(payload))
      return { id: `timer-message-${timerMessages.length}` }
    },
  },
  user: { id: hostId },
  options: {
    getSubcommand: () => '投票',
    getInteger: () => 1,
  },
  reply: async (payload: any) => {
    timerPanelReply = payload
  },
  fetchReply: async () => ({ id: 'timer-vote-panel' }),
} as any)
globalThis.setTimeout = originalSetTimeout
globalThis.clearTimeout = originalClearTimeout
assert.equal(getPanelText(timerPanelReply).includes('讨论截止'), true)
const dueTimer = capturedTimers.find(timer => timer.delay >= 59_000)
assert.ok(dueTimer)
dueTimer.callback()
await new Promise(resolve => originalSetTimeout(resolve, 0))
assert.equal(UndercoverEngine.getGame(timerChannelId)?.currentVote !== undefined, true)
assert.deepEqual(UndercoverEngine.getGame(timerChannelId)?.aliveUserIds, ['t2', 't3', 't1'])
assert.equal(timerMessages.some(message => message.includes('讨论时间已到')), true)
await UndercoverEngine.endGame(timerChannelId)
console.log('✅ 投票讨论时间到点只提醒，不自动结算投票')

const undercoverEliminatedChannelId = 'undercover-eliminated-channel'
await UndercoverEngine.startGame(undercoverEliminatedChannelId, hostId, {
  wordSource: 'custom',
  civilianWord: '红茶',
  undercoverWord: '绿茶',
  allowLying: false,
})
await UndercoverEngine.addPlayer(undercoverEliminatedChannelId, 'e1')
await UndercoverEngine.addPlayer(undercoverEliminatedChannelId, 'e2')
await UndercoverEngine.addPlayer(undercoverEliminatedChannelId, 'e3')
await UndercoverEngine.dealWords(undercoverEliminatedChannelId, () => 0)
await UndercoverEngine.startVote(undercoverEliminatedChannelId)
await UndercoverEngine.castVote(undercoverEliminatedChannelId, 'e1', 'e1')
await UndercoverEngine.castVote(undercoverEliminatedChannelId, 'e2', 'e1')
await UndercoverEngine.castVote(undercoverEliminatedChannelId, 'e3', 'e1')
await UndercoverEngine.setVoteMessage(undercoverEliminatedChannelId, 'undercover-vote-panel')
let closedVotePanelEdited = false
let undercoverResultPanel: any
await handleUndercoverButton({
  customId: 'undercover_vote_close',
  channelId: undercoverEliminatedChannelId,
  user: { id: hostId },
  guild: {
    members: {
      fetch: async (userId: string) => ({ displayName: `玩家${userId}` }),
    },
  },
  client: {
    users: {
      fetch: async (userId: string) => ({ displayName: `玩家${userId}`, username: userId }),
    },
  },
  channel: {
    messages: {
      fetch: async (messageId: string) => {
        assert.equal(messageId, 'undercover-vote-panel')
        return {
          edit: async () => {
            closedVotePanelEdited = true
          },
        }
      },
    },
    send: async (payload: any) => {
      undercoverResultPanel = payload
    },
  },
  deferUpdate: async () => undefined,
} as any)
assert.equal(closedVotePanelEdited, true)
assert.equal(UndercoverEngine.hasActiveGame(undercoverEliminatedChannelId), true)
assert.equal(UndercoverEngine.getGame(undercoverEliminatedChannelId)?.currentVote, undefined)
assert.deepEqual(UndercoverEngine.getGame(undercoverEliminatedChannelId)?.aliveUserIds, ['e2', 'e3'])
assert.equal(getPanelText(undercoverResultPanel).includes('卧底被淘汰，平民胜利'), true)
assert.equal(getPanelText(undercoverResultPanel).includes('游戏结束'), false)
await UndercoverEngine.endGame(undercoverEliminatedChannelId)
console.log('✅ 投出卧底只宣布胜利，不自动结束整局或清理游戏状态')

const failingEndChannelId = 'undercover-failing-end-channel'
const failingEndGame = await UndercoverEngine.startGame(failingEndChannelId, hostId, {
  wordSource: 'custom',
  civilianWord: '西瓜',
  undercoverWord: '哈密瓜',
  allowLying: false,
})
assert.equal(failingEndGame.ok, true)

const replyFailure = new Error('simulated Discord interaction response failure')
await assert.rejects(
  () => executeUndercoverCommand({
    guild: {},
    channelId: failingEndChannelId,
    user: { id: hostId },
    options: { getSubcommand: () => '结束' },
    deferReply: async () => undefined,
    reply: async () => {
      throw replyFailure
    },
    editReply: async () => {
      throw replyFailure
    },
  } as any),
  /simulated Discord interaction response failure/,
)
assert.equal(UndercoverEngine.hasActiveGame(failingEndChannelId), true)
await UndercoverEngine.endGame(failingEndChannelId)
console.log('✅ 结束命令回复失败时不会提前删除游戏状态，主持人可重试结束')

await UndercoverEngine.resetAllForTest()

console.log('\n🎉 谁是卧底核心逻辑测试全部通过！')
