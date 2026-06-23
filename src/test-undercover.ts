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
  formatUndercoverPlayerVoteList,
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

async function buildHistoryPayloadForTest(channelId: string, userId: string): Promise<any> {
  let payload: any
  await handleUndercoverButton({
    customId: 'undercover_history_open',
    channelId,
    user: { id: userId },
    guild: {
      members: {
        fetch: async (targetUserId: string) => ({ displayName: `跳过玩家${targetUserId}` }),
      },
    },
    client: {
      users: {
        fetch: async (targetUserId: string) => ({ displayName: `跳过玩家${targetUserId}`, username: targetUserId }),
      },
    },
    deferReply: async () => undefined,
    editReply: async (nextPayload: any) => {
      payload = nextPayload
    },
  } as any)
  return payload
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

const dealResult = await UndercoverEngine.dealWords(channelId, { rng: sequenceRng([0, 0]) })

assert.deepEqual(dealResult.undercoverUserIds, ['u1'])
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
console.log('✅ 正式开始默认随机选出 1 名卧底、生成词语分配，并冻结报名')

const multiDealChannelId = 'undercover-multi-deal-channel'
await UndercoverEngine.startGame(multiDealChannelId, hostId, {
  wordSource: 'custom',
  civilianWord: '苹果',
  undercoverWord: '梨',
  allowLying: false,
})
await UndercoverEngine.addPlayer(multiDealChannelId, 'm1')
await UndercoverEngine.addPlayer(multiDealChannelId, 'm2')
await UndercoverEngine.addPlayer(multiDealChannelId, 'm3')
await UndercoverEngine.addPlayer(multiDealChannelId, 'm4')

await assert.rejects(
  () => UndercoverEngine.dealWords(multiDealChannelId, { undercoverCount: 0, rng: () => 0 }),
  /卧底数量至少为 1/,
)
await assert.rejects(
  () => UndercoverEngine.dealWords(multiDealChannelId, { undercoverCount: 4, rng: () => 0 }),
  /卧底数量必须小于参与者数量/,
)

const multiDeal = await UndercoverEngine.dealWords(multiDealChannelId, {
  undercoverCount: 2,
  rng: sequenceRng([0, 0, 0, 0, 0]),
})
assert.deepEqual(multiDeal.undercoverUserIds, ['m1', 'm2'])
assert.deepEqual(
  multiDeal.assignments.map(a => ({ userId: a.userId, role: a.role, word: a.word })),
  [
    { userId: 'm1', role: 'undercover', word: '梨' },
    { userId: 'm2', role: 'undercover', word: '梨' },
    { userId: 'm3', role: 'civilian', word: '苹果' },
    { userId: 'm4', role: 'civilian', word: '苹果' },
  ],
)
assert.deepEqual(UndercoverEngine.getGame(multiDealChannelId)?.deal?.undercoverUserIds, ['m1', 'm2'])
await UndercoverEngine.endGame(multiDealChannelId)
console.log('✅ 正式开始支持主持人指定多个卧底，并只限制卧底数量小于参与者数量')

const commandJson = undercoverCommandData.toJSON()
const commandNames = commandJson.options?.map((option: any) => option.name)
assert.deepEqual(
  commandNames,
  ['报名阶段', '正式开始', '开始发言', '投票', '查看投票历史', '游戏通知', '观众偷看', '结束', '帮助'],
)
const officialStartCommand = commandJson.options?.find((option: any) => option.name === '正式开始') as any
assert.equal(
  officialStartCommand.options?.some((option: any) => option.name === '卧底数量' && option.min_value === 1),
  true,
)
console.log('✅ 谁是卧底保留原命令并注册开始发言、投票和卧底数量选项')

const emptyVoteHistoryChannelId = 'undercover-empty-vote-history-channel'
await UndercoverEngine.startGame(emptyVoteHistoryChannelId, hostId, {
  wordSource: 'custom',
  civilianWord: '西红柿',
  undercoverWord: '番茄',
  allowLying: false,
})
let emptyVoteHistoryReply: any
await executeUndercoverCommand({
  guild: {},
  client: { users: { fetch: async (userId: string) => ({ displayName: userId, username: userId }) } },
  channelId: emptyVoteHistoryChannelId,
  channel: {},
  user: { id: 'not-host-user' },
  options: {
    getSubcommand: () => '查看投票历史',
  },
  reply: async (payload: any) => {
    emptyVoteHistoryReply = payload
  },
} as any)
assert.equal(getPanelText(emptyVoteHistoryReply).includes('暂无投票历史'), true)
assert.equal(emptyVoteHistoryReply.ephemeral, undefined)
await UndercoverEngine.endGame(emptyVoteHistoryChannelId)
console.log('✅ 任何人可公开查看投票历史，暂无历史时不展示进行中投票')

let missingVoteHistoryCommandReply: any
await executeUndercoverCommand({
  guild: {},
  channelId: 'missing-vote-history-command-channel',
  channel: {},
  user: { id: 'any-user' },
  options: {
    getSubcommand: () => '查看投票历史',
  },
  reply: async (payload: any) => {
    missingVoteHistoryCommandReply = payload
  },
} as any)
assert.equal(missingVoteHistoryCommandReply.content.includes('当前频道没有进行中的谁是卧底'), true)
assert.equal(missingVoteHistoryCommandReply.ephemeral, true)
console.log('✅ 没有进行中的谁是卧底时，查看投票历史会私密返回错误')

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

const voteRelationPlayers = [
  { userId: 'u1', number: 1, displayName: '小明' },
  { userId: 'u2', number: 2, displayName: '小红' },
  { userId: 'u3', number: 3, displayName: '小蓝' },
  { userId: 'u4', number: 4, displayName: '小绿' },
]
assert.equal(
  formatUndercoverPlayerVoteList(voteRelationPlayers, {
    u1: 'u2',
    u2: 'u3',
    outsider: 'u1',
    u3: 'missing-target',
  }),
  '1. 小明 -> 小红\n2. 小红 -> 小蓝\n3. 小蓝\n4. 小绿',
)
console.log('✅ 投票面板玩家列表会公开显示存活玩家当前投给谁，并忽略无效票')

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

const skipSpeechStart = await UndercoverEngine.startSpeechRound(channelId, () => 0)
assert.equal(skipSpeechStart.ok, true)
assert.deepEqual(skipSpeechStart.speech?.order, ['u2', 'u3', 'u1'])
assert.deepEqual(await UndercoverEngine.skipCurrentSpeech(channelId, 'not-host'), {
  ok: false,
  error: '只有本局主持人可以跳过发言。',
})

const skipFirst = await UndercoverEngine.skipCurrentSpeech(channelId, hostId)
assert.deepEqual(skipFirst, {
  ok: true,
  completed: false,
  round: 2,
  skippedUserId: 'u2',
  currentUserId: 'u3',
})
assert.equal((await UndercoverEngine.submitSpeech(channelId, 'u2', '旧弹窗提交')).ok, false)
assert.deepEqual(await UndercoverEngine.submitSpeech(channelId, 'u3', '跳过后正常发言'), {
  ok: true,
  completed: false,
  round: 2,
  currentUserId: 'u1',
})
const skipLast = await UndercoverEngine.skipCurrentSpeech(channelId, hostId)
assert.deepEqual(skipLast, {
  ok: true,
  completed: true,
  round: 2,
  skippedUserId: 'u1',
})
const afterSkipSpeech = UndercoverEngine.getGame(channelId)
assert.equal(afterSkipSpeech?.currentSpeech, undefined)
assert.deepEqual(afterSkipSpeech?.aliveUserIds, ['u2', 'u3', 'u1'])
assert.deepEqual(
  afterSkipSpeech?.speechRounds?.[1].entries.map(entry => ({ userId: entry.userId, content: entry.content })),
  [{ userId: 'u3', content: '跳过后正常发言' }],
)
console.log('✅ 主持人可以跳过当前发言人，跳过不写入历史且不影响存活玩家')

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
const firstVoteHistory = UndercoverEngine.getGame(channelId)?.voteRounds?.[0]
assert.equal(firstVoteHistory?.voteNumber, 1)
assert.deepEqual(firstVoteHistory?.candidateUserIds, ['u2', 'u3', 'u1'])
assert.deepEqual(firstVoteHistory?.votes, { u1: 'u2', u2: 'u1' })
assert.equal(firstVoteHistory?.result.type, 'tie')
assert.deepEqual(
  firstVoteHistory?.result.type === 'tie' ? firstVoteHistory.result.tiedUserIds : [],
  ['u2', 'u1'],
)

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
const completedVoteHistory = UndercoverEngine.getGame(channelId)?.voteRounds ?? []
assert.equal(completedVoteHistory.length, 2)
assert.deepEqual(completedVoteHistory[1].candidateUserIds, ['u2', 'u3', 'u1'])
assert.deepEqual(completedVoteHistory[1].votes, { u1: 'u2', u2: 'u2', u3: 'u2' })
assert.equal(completedVoteHistory[1].voteNumber, 2)
assert.equal(completedVoteHistory[1].result.type, 'eliminated')
assert.equal(
  completedVoteHistory[1].result.type === 'eliminated'
    ? completedVoteHistory[1].result.eliminatedUserId
    : '',
  'u2',
)
let voteHistoryReply: any
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
  channelId,
  channel: {},
  user: { id: 'not-host-user' },
  options: {
    getSubcommand: () => '查看投票历史',
  },
  reply: async (payload: any) => {
    voteHistoryReply = payload
  },
} as any)
assert.equal(getPanelText(voteHistoryReply).includes('投票历史 (1/2)'), true)
assert.equal(getPanelText(voteHistoryReply).includes('第 1 次投票'), true)
assert.equal(getPanelText(voteHistoryReply).includes('玩家u1 -> 玩家u2'), true)
assert.equal(getPanelText(voteHistoryReply).includes('玩家u2 -> 玩家u1'), true)
assert.equal(getPanelText(voteHistoryReply).includes('1. 玩家u2：1 票'), true)
assert.equal(getPanelText(voteHistoryReply).includes('3. 玩家u1：1 票'), true)
assert.equal(voteHistoryReply.ephemeral, undefined)

let secondVoteHistoryPage: any
await handleUndercoverButton({
  customId: 'undercover_vote_history_page_2',
  channelId,
  user: { id: 'another-user' },
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
  deferUpdate: async () => undefined,
  editReply: async (payload: any) => {
    secondVoteHistoryPage = payload
  },
} as any)
assert.equal(getPanelText(secondVoteHistoryPage).includes('投票历史 (2/2)'), true)
assert.equal(getPanelText(secondVoteHistoryPage).includes('第 2 次投票'), true)
assert.equal(getPanelText(secondVoteHistoryPage).includes('玩家u1 -> 玩家u2'), true)
assert.equal(getPanelText(secondVoteHistoryPage).includes('玩家u2 -> 玩家u2'), true)
assert.equal(getPanelText(secondVoteHistoryPage).includes('玩家u3 -> 玩家u2'), true)
assert.equal(getPanelText(secondVoteHistoryPage).includes('1. 玩家u2：3 票'), true)
console.log('✅ 投票历史公开分页展示每次已结束投票的关系和得票计数')

const activeVoteHistoryChannelId = 'undercover-active-vote-history-channel'
await UndercoverEngine.startGame(activeVoteHistoryChannelId, hostId, {
  wordSource: 'custom',
  civilianWord: '山',
  undercoverWord: '丘',
  allowLying: false,
})
await UndercoverEngine.addPlayer(activeVoteHistoryChannelId, 'a1')
await UndercoverEngine.addPlayer(activeVoteHistoryChannelId, 'a2')
await UndercoverEngine.addPlayer(activeVoteHistoryChannelId, 'a3')
await UndercoverEngine.dealWords(activeVoteHistoryChannelId, () => 0)
await UndercoverEngine.startVote(activeVoteHistoryChannelId)
await UndercoverEngine.castVote(activeVoteHistoryChannelId, 'a1', 'a2')
await UndercoverEngine.castVote(activeVoteHistoryChannelId, 'a2', 'a1')
await UndercoverEngine.closeVote(activeVoteHistoryChannelId)
await UndercoverEngine.startVote(activeVoteHistoryChannelId)
await UndercoverEngine.castVote(activeVoteHistoryChannelId, 'a1', 'a1')
let activeVoteExcludedReply: any
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
  channelId: activeVoteHistoryChannelId,
  channel: {},
  user: { id: 'spectator-user' },
  options: {
    getSubcommand: () => '查看投票历史',
  },
  reply: async (payload: any) => {
    activeVoteExcludedReply = payload
  },
} as any)
assert.equal(getPanelText(activeVoteExcludedReply).includes('投票历史 (1/1)'), true)
assert.equal(getPanelText(activeVoteExcludedReply).includes('玩家a1 -> 玩家a2'), true)
assert.equal(getPanelText(activeVoteExcludedReply).includes('玩家a1 -> 玩家a1'), false)
await UndercoverEngine.endGame(activeVoteHistoryChannelId)
console.log('✅ 投票历史不展示当前尚未结束的投票')

let missingVoteHistoryPageReply: any
await handleUndercoverButton({
  customId: 'undercover_vote_history_page_1',
  channelId: 'missing-vote-history-channel',
  user: { id: 'any-user' },
  deferUpdate: async () => undefined,
  editReply: async (payload: any) => {
    missingVoteHistoryPageReply = payload
  },
} as any)
assert.equal(missingVoteHistoryPageReply.content.includes('当前频道没有进行中的谁是卧底'), true)
assert.deepEqual(missingVoteHistoryPageReply.components, [])
console.log('✅ 投票历史翻页在游戏不存在时会结束交互并显示错误')
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
      fetch: async (userId: string) => ({ displayName: userId === 's2' ? '玩家*s2' : `玩家${userId}` }),
    },
  },
  client: {
    users: {
      fetch: async (userId: string) => ({ displayName: `玩家${userId}`, username: userId }),
    },
  },
  channelId: speechPanelChannelId,
  channel: {
    send: async (payload: any) => {
      speechPanelReply = payload
      return { id: 'speech-panel-message' }
    },
  },
  user: { id: hostId },
  options: { getSubcommand: () => '开始发言' },
  deferReply: async (payload: any) => {
    assert.equal(payload.ephemeral, true)
  },
  editReply: async (payload: any) => {
    assert.equal(String(payload).includes('已发布第 1 轮发言面板'), true)
  },
} as any)
Math.random = originalRandom
const speechPanelButtons = speechPanelReply.components?.[1]?.components?.map((component: any) => component.label)
assert.deepEqual(speechPanelButtons, ['发言', '查看历史', '跳过'])
assert.equal(getPanelText(speechPanelReply).includes('本轮发言'), false)
let deletedSpeechPanel = false
let nextSpeechPanel: any
await handleUndercoverModal({
  customId: 'undercover_speech_modal_undercover-speech-panel-channel_s2',
  channelId: speechPanelChannelId,
  user: { id: 's2' },
  fields: {
    getTextInputValue: () => '**鲫鱼汤',
  },
  guild: {
    members: {
      fetch: async (userId: string) => ({ displayName: userId === 's2' ? '玩家*s2' : `玩家${userId}` }),
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
assert.equal(getPanelText(nextSpeechPanel).includes('玩家\\*s2'), true)
assert.equal(getPanelText(nextSpeechPanel).includes('\\*\\*鲫鱼汤'), true)
assert.equal(getPanelText(nextSpeechPanel).includes('---'), true)
let speechHistoryReply: any
let speechHistoryDeferred = false
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
  deferReply: async (payload: any) => {
    assert.equal(payload.ephemeral, true)
    speechHistoryDeferred = true
  },
  editReply: async (payload: any) => {
    speechHistoryReply = payload
  },
} as any)
assert.equal(speechHistoryDeferred, true)
assert.equal(getPanelText(speechHistoryReply).includes('暂无发言记录'), true)
assert.equal(speechHistoryReply.components.length, 1)

const speechStartFailureChannelId = 'undercover-speech-start-failure-channel'
await UndercoverEngine.startGame(speechStartFailureChannelId, hostId, {
  wordSource: 'custom',
  civilianWord: '铅笔',
  undercoverWord: '钢笔',
  allowLying: false,
})
await UndercoverEngine.addPlayer(speechStartFailureChannelId, 'f1')
await UndercoverEngine.addPlayer(speechStartFailureChannelId, 'f2')
await UndercoverEngine.addPlayer(speechStartFailureChannelId, 'f3')
await UndercoverEngine.dealWords(speechStartFailureChannelId, () => 0)
let failedSpeechStartDeferred = false
let failedSpeechStartEdit: any
const speechStartFailureConsoleError = console.error
const speechStartFailureErrors: unknown[][] = []
console.error = (...args: unknown[]) => {
  speechStartFailureErrors.push(args)
}
try {
  await executeUndercoverCommand({
    guild: {
      members: {
        fetch: async (userId: string) => ({ displayName: `失败玩家${userId}` }),
      },
    },
    client: {
      users: {
        fetch: async (userId: string) => ({ displayName: `失败玩家${userId}`, username: userId }),
      },
    },
    channelId: speechStartFailureChannelId,
    channel: {
      send: async () => {
        throw new Error('模拟发言面板发送失败')
      },
    },
    user: { id: hostId },
    options: { getSubcommand: () => '开始发言' },
    deferReply: async (payload: any) => {
      failedSpeechStartDeferred = payload?.ephemeral === true
    },
    editReply: async (payload: any) => {
      failedSpeechStartEdit = payload
    },
  } as any)
} finally {
  console.error = speechStartFailureConsoleError
}
assert.equal(failedSpeechStartDeferred, true)
assert.equal(UndercoverEngine.getGame(speechStartFailureChannelId)?.currentSpeech, undefined)
assert.equal(String(failedSpeechStartEdit).includes('发言面板发送失败'), true)
assert.equal(String(speechStartFailureErrors[0]?.[0]).includes('发送发言面板失败'), true)
await UndercoverEngine.endGame(speechStartFailureChannelId)
console.log('✅ 开始发言面板发送失败时会取消刚创建的发言轮并尽力提示主持人')

const speechAckFailureChannelId = 'undercover-speech-ack-failure-channel'
await UndercoverEngine.startGame(speechAckFailureChannelId, hostId, {
  wordSource: 'custom',
  civilianWord: '铅笔',
  undercoverWord: '钢笔',
  allowLying: false,
})
await UndercoverEngine.addPlayer(speechAckFailureChannelId, 'a1')
await UndercoverEngine.addPlayer(speechAckFailureChannelId, 'a2')
await UndercoverEngine.addPlayer(speechAckFailureChannelId, 'a3')
await UndercoverEngine.dealWords(speechAckFailureChannelId, () => 0)
let ackFailureSpeechPanel: any
const speechAckFailureConsoleError = console.error
const speechAckFailureErrors: unknown[][] = []
console.error = (...args: unknown[]) => {
  speechAckFailureErrors.push(args)
}
try {
  await executeUndercoverCommand({
    guild: {
      members: {
        fetch: async (userId: string) => ({ displayName: `确认失败玩家${userId}` }),
      },
    },
    client: {
      users: {
        fetch: async (userId: string) => ({ displayName: `确认失败玩家${userId}`, username: userId }),
      },
    },
    channelId: speechAckFailureChannelId,
    channel: {
      send: async (payload: any) => {
        ackFailureSpeechPanel = payload
        return { id: 'speech-ack-failure-panel' }
      },
    },
    user: { id: hostId },
    options: { getSubcommand: () => '开始发言' },
    deferReply: async (payload: any) => {
      assert.equal(payload.ephemeral, true)
    },
    editReply: async () => {
      throw new Error('模拟发言确认失败')
    },
  } as any)
} finally {
  console.error = speechAckFailureConsoleError
}
assert.equal(getPanelText(ackFailureSpeechPanel).includes('第 1 轮发言'), true)
assert.equal(UndercoverEngine.getGame(speechAckFailureChannelId)?.currentSpeech?.messageId, 'speech-ack-failure-panel')
assert.equal(String(speechAckFailureErrors[0]?.[0]).includes('发言面板确认回复失败'), true)
await UndercoverEngine.endGame(speechAckFailureChannelId)
console.log('✅ 开始发言公开面板已发出时，即使私密确认失败也不会回滚发言轮')

const speechResurfaceChannelId = 'undercover-speech-resurface-channel'
await UndercoverEngine.startGame(speechResurfaceChannelId, hostId, {
  wordSource: 'custom',
  civilianWord: '海洋',
  undercoverWord: '湖泊',
  allowLying: false,
})
await UndercoverEngine.addPlayer(speechResurfaceChannelId, 'rs1')
await UndercoverEngine.addPlayer(speechResurfaceChannelId, 'rs2')
await UndercoverEngine.addPlayer(speechResurfaceChannelId, 'rs3')
await UndercoverEngine.dealWords(speechResurfaceChannelId, () => 0)
const speechResurfaceStart = await UndercoverEngine.startSpeechRound(speechResurfaceChannelId)
assert.equal(speechResurfaceStart.ok, true)
await UndercoverEngine.setSpeechMessage(speechResurfaceChannelId, 'speech-resurface-old-panel')
let resurfacedSpeechPanel: any
let speechResurfaceEdit: any
let deletedOldSpeechResurfacePanel = false
await executeUndercoverCommand({
  guild: {
    members: {
      fetch: async (userId: string) => ({ displayName: `重发玩家${userId}` }),
    },
  },
  client: {
    users: {
      fetch: async (userId: string) => ({ displayName: `重发玩家${userId}`, username: userId }),
    },
  },
  channelId: speechResurfaceChannelId,
  channel: {
    messages: {
      fetch: async (messageId: string) => {
        assert.equal(messageId, 'speech-resurface-old-panel')
        return {
          delete: async () => {
            deletedOldSpeechResurfacePanel = true
          },
        }
      },
    },
    send: async (payload: any) => {
      resurfacedSpeechPanel = payload
      return { id: 'speech-resurface-panel' }
    },
  },
  user: { id: hostId },
  options: { getSubcommand: () => '开始发言' },
  deferReply: async (payload: any) => {
    assert.equal(payload.ephemeral, true)
  },
  editReply: async (payload: any) => {
    speechResurfaceEdit = payload
  },
} as any)
assert.equal(getPanelText(resurfacedSpeechPanel).includes('第 1 轮发言'), true)
assert.equal(resurfacedSpeechPanel.components?.[1]?.components?.some((component: any) => component.label === '跳过'), true)
assert.equal(deletedOldSpeechResurfacePanel, true)
assert.equal(UndercoverEngine.getGame(speechResurfaceChannelId)?.currentSpeech?.messageId, 'speech-resurface-panel')
assert.equal(String(speechResurfaceEdit).includes('已重新发布当前发言面板'), true)
await UndercoverEngine.endGame(speechResurfaceChannelId)
console.log('✅ 主持人可重新唤出当前发言面板，残留发言状态不会卡死流程')

const speechSubmitNextPanelFailureChannelId = 'undercover-speech-submit-next-panel-failure-channel'
await UndercoverEngine.startGame(speechSubmitNextPanelFailureChannelId, hostId, {
  wordSource: 'custom',
  civilianWord: '雨伞',
  undercoverWord: '阳伞',
  allowLying: false,
})
await UndercoverEngine.addPlayer(speechSubmitNextPanelFailureChannelId, 'sf1')
await UndercoverEngine.addPlayer(speechSubmitNextPanelFailureChannelId, 'sf2')
await UndercoverEngine.addPlayer(speechSubmitNextPanelFailureChannelId, 'sf3')
await UndercoverEngine.dealWords(speechSubmitNextPanelFailureChannelId, () => 0)
await UndercoverEngine.startSpeechRound(speechSubmitNextPanelFailureChannelId)
await UndercoverEngine.setSpeechMessage(speechSubmitNextPanelFailureChannelId, 'submit-next-old-panel')
const submitNextPanelFailureSpeaker = UndercoverEngine.getGame(
  speechSubmitNextPanelFailureChannelId,
)?.currentSpeech?.order[0]
assert.equal(typeof submitNextPanelFailureSpeaker, 'string')
let submitNextPanelFailureEdit: any
let deletedSubmitNextOldPanel = false
const submitNextPanelFailureConsoleError = console.error
const submitNextPanelFailureErrors: unknown[][] = []
console.error = (...args: unknown[]) => {
  submitNextPanelFailureErrors.push(args)
}
try {
  await handleUndercoverModal({
    customId: `undercover_speech_modal_${speechSubmitNextPanelFailureChannelId}_${submitNextPanelFailureSpeaker}`,
    channelId: speechSubmitNextPanelFailureChannelId,
    user: { id: submitNextPanelFailureSpeaker },
    fields: {
      getTextInputValue: () => '第一位发言',
    },
    guild: {
      members: {
        fetch: async (userId: string) => ({ displayName: `提交失败玩家${userId}` }),
      },
    },
    client: {
      users: {
        fetch: async (userId: string) => ({ displayName: `提交失败玩家${userId}`, username: userId }),
      },
    },
    channel: {
      messages: {
        fetch: async (messageId: string) => {
          assert.equal(messageId, 'submit-next-old-panel')
          return {
            delete: async () => {
              deletedSubmitNextOldPanel = true
            },
          }
        },
      },
      send: async () => {
        throw new Error('模拟提交后下一面板发送失败')
      },
    },
    deferReply: async (payload: any) => {
      assert.equal(payload.ephemeral, true)
    },
    editReply: async (payload: any) => {
      submitNextPanelFailureEdit = payload
    },
  } as any)
} finally {
  console.error = submitNextPanelFailureConsoleError
}
assert.equal(deletedSubmitNextOldPanel, true)
assert.equal(UndercoverEngine.getGame(speechSubmitNextPanelFailureChannelId)?.currentSpeech?.currentIndex, 1)
assert.equal(String(submitNextPanelFailureEdit).includes('发言已记录'), true)
assert.equal(String(submitNextPanelFailureEdit).includes('发言面板发送失败'), true)
assert.equal(String(submitNextPanelFailureErrors[0]?.[0]).includes('提交发言后发送下一面板失败'), true)
await UndercoverEngine.endGame(speechSubmitNextPanelFailureChannelId)
console.log('✅ 提交发言后下一面板发送失败时会保留进度并提示主持人重发')

const speechSkipNextPanelFailureChannelId = 'undercover-speech-skip-next-panel-failure-channel'
await UndercoverEngine.startGame(speechSkipNextPanelFailureChannelId, hostId, {
  wordSource: 'custom',
  civilianWord: '风筝',
  undercoverWord: '气球',
  allowLying: false,
})
await UndercoverEngine.addPlayer(speechSkipNextPanelFailureChannelId, 'kf1')
await UndercoverEngine.addPlayer(speechSkipNextPanelFailureChannelId, 'kf2')
await UndercoverEngine.addPlayer(speechSkipNextPanelFailureChannelId, 'kf3')
await UndercoverEngine.dealWords(speechSkipNextPanelFailureChannelId, () => 0)
await UndercoverEngine.startSpeechRound(speechSkipNextPanelFailureChannelId)
await UndercoverEngine.setSpeechMessage(speechSkipNextPanelFailureChannelId, 'skip-next-old-panel')
let skipNextPanelFailureFollowUp: any
let deletedSkipNextOldPanel = false
const skipNextPanelFailureConsoleError = console.error
const skipNextPanelFailureErrors: unknown[][] = []
console.error = (...args: unknown[]) => {
  skipNextPanelFailureErrors.push(args)
}
try {
  await handleUndercoverButton({
    customId: 'undercover_speech_skip',
    channelId: speechSkipNextPanelFailureChannelId,
    user: { id: hostId },
    guild: {
      members: {
        fetch: async (userId: string) => ({ displayName: `跳过失败玩家${userId}` }),
      },
    },
    client: {
      users: {
        fetch: async (userId: string) => ({ displayName: `跳过失败玩家${userId}`, username: userId }),
      },
    },
    channel: {
      messages: {
        fetch: async (messageId: string) => {
          assert.equal(messageId, 'skip-next-old-panel')
          return {
            delete: async () => {
              deletedSkipNextOldPanel = true
            },
          }
        },
      },
      send: async () => {
        throw new Error('模拟跳过后下一面板发送失败')
      },
    },
    deferUpdate: async () => undefined,
    followUp: async (payload: any) => {
      skipNextPanelFailureFollowUp = payload
    },
  } as any)
} finally {
  console.error = skipNextPanelFailureConsoleError
}
assert.equal(deletedSkipNextOldPanel, true)
assert.equal(UndercoverEngine.getGame(speechSkipNextPanelFailureChannelId)?.currentSpeech?.currentIndex, 1)
assert.equal(String(skipNextPanelFailureFollowUp?.content).includes('已跳过当前发言人'), true)
assert.equal(String(skipNextPanelFailureFollowUp?.content).includes('发言面板发送失败'), true)
assert.equal(String(skipNextPanelFailureErrors[0]?.[0]).includes('跳过发言后发送下一面板失败'), true)
await UndercoverEngine.endGame(speechSkipNextPanelFailureChannelId)
console.log('✅ 跳过发言后下一面板发送失败时会保留进度并提示主持人重发')

const skipButtonChannelId = 'undercover-skip-button-channel'
await UndercoverEngine.startGame(skipButtonChannelId, hostId, {
  wordSource: 'custom',
  civilianWord: '白天',
  undercoverWord: '黑夜',
  allowLying: false,
})
await UndercoverEngine.addPlayer(skipButtonChannelId, 'k1')
await UndercoverEngine.addPlayer(skipButtonChannelId, 'k2')
await UndercoverEngine.addPlayer(skipButtonChannelId, 'k3')
await UndercoverEngine.dealWords(skipButtonChannelId, { rng: sequenceRng([0, 0, 0]) })
await UndercoverEngine.startSpeechRound(skipButtonChannelId)
await UndercoverEngine.setSpeechMessage(skipButtonChannelId, 'skip-old-panel')

let nonHostSkipReply: any
await handleUndercoverButton({
  customId: 'undercover_speech_skip',
  channelId: skipButtonChannelId,
  user: { id: 'not-host' },
  reply: async (payload: any) => {
    nonHostSkipReply = payload
  },
} as any)
assert.equal(nonHostSkipReply.ephemeral, true)
assert.equal(nonHostSkipReply.content.includes('只有本局主持人可以跳过发言'), true)

let oldSpeechPanelDeleted = false
let skipDeferred = false
let skipFollowUp: any
let skipNextPanel: any
await handleUndercoverButton({
  customId: 'undercover_speech_skip',
  channelId: skipButtonChannelId,
  user: { id: hostId },
  guild: {
    members: {
      fetch: async (userId: string) => ({ displayName: `跳过玩家${userId}` }),
    },
  },
  client: {
    users: {
      fetch: async (userId: string) => ({ displayName: `跳过玩家${userId}`, username: userId }),
    },
  },
  channel: {
    messages: {
      fetch: async (messageId: string) => {
        assert.equal(messageId, 'skip-old-panel')
        return {
          delete: async () => {
            oldSpeechPanelDeleted = true
          },
        }
      },
    },
    send: async (payload: any) => {
      skipNextPanel = payload
      return { id: 'skip-next-panel' }
    },
  },
  deferUpdate: async () => {
    skipDeferred = true
  },
  followUp: async (payload: any) => {
    skipFollowUp = payload
  },
} as any)
assert.equal(skipDeferred, true)
assert.equal(oldSpeechPanelDeleted, true)
assert.equal(skipFollowUp.ephemeral, true)
assert.equal(skipFollowUp.content.includes('已跳过'), true)
assert.equal(getPanelText(skipNextPanel).includes('当前发言：<@k3>'), true)
assert.deepEqual(UndercoverEngine.getGame(skipButtonChannelId)?.currentSpeech?.entries, [])

await UndercoverEngine.skipCurrentSpeech(skipButtonChannelId, hostId)
const lastSkipResult = await UndercoverEngine.skipCurrentSpeech(skipButtonChannelId, hostId)
assert.equal(lastSkipResult.completed, true)
const skipOnlyHistory = await buildHistoryPayloadForTest(skipButtonChannelId, hostId)
assert.equal(getPanelText(skipOnlyHistory).includes('暂无发言。'), true)
assert.equal(getPanelText(skipOnlyHistory).includes('跳过玩家k1：'), false)
await UndercoverEngine.endGame(skipButtonChannelId)
console.log('✅ 发言面板提供主持人跳过按钮，跳过不写入发言历史')

const completedHistoryChannelId = 'undercover-completed-history-channel'
await UndercoverEngine.startGame(completedHistoryChannelId, hostId, {
  wordSource: 'custom',
  civilianWord: '春天',
  undercoverWord: '秋天',
  allowLying: false,
})
await UndercoverEngine.addPlayer(completedHistoryChannelId, 'h1')
await UndercoverEngine.addPlayer(completedHistoryChannelId, 'h2')
await UndercoverEngine.addPlayer(completedHistoryChannelId, 'h3')
await UndercoverEngine.dealWords(completedHistoryChannelId, sequenceRng([0, 0, 0]))
await UndercoverEngine.startSpeechRound(completedHistoryChannelId)
const completedHistoryOrder = UndercoverEngine.getGame(completedHistoryChannelId)?.currentSpeech?.order ?? []
for (const userId of completedHistoryOrder) {
  const result = await UndercoverEngine.submitSpeech(completedHistoryChannelId, userId, `${userId} 的历史发言`)
  assert.equal(result.ok, true)
}

let completedHistoryDeferred = false
let completedHistoryReply: any
await handleUndercoverButton({
  customId: 'undercover_history_open',
  channelId: completedHistoryChannelId,
  user: { id: 'h1' },
  guild: {
    members: {
      fetch: async (userId: string) => {
        assert.equal(completedHistoryDeferred, true)
        return { displayName: `历史玩家${userId}` }
      },
    },
  },
  client: {
    users: {
      fetch: async (userId: string) => ({ displayName: `历史玩家${userId}`, username: userId }),
    },
  },
  deferReply: async (payload: any) => {
    assert.equal(payload.ephemeral, true)
    completedHistoryDeferred = true
  },
  editReply: async (payload: any) => {
    completedHistoryReply = payload
  },
} as any)
assert.equal(completedHistoryDeferred, true)
assert.equal(getPanelText(completedHistoryReply).includes('的历史发言'), true)
await UndercoverEngine.endGame(completedHistoryChannelId)
console.log('✅ 查看历史会先完成交互响应，再加载历史内容')
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
await UndercoverEngine.addPlayer(officialPanelChannelId, 'p4')
let officialPublicPanel: any
let officialSecretReply: any
Math.random = sequenceRng([0, 0, 0, 0, 0])
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
  options: {
    getSubcommand: () => '正式开始',
    getInteger: (name: string) => name === '卧底数量' ? 2 : null,
  },
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
assert.equal(officialPublicText.includes('**1.** 玩家p2\n**2.** 玩家p3\n**3.** 玩家p4\n**4.** 玩家p1'), true)
assert.equal(getPanelText(officialSecretReply).includes('**卧底：**玩家p1、玩家p2'), true)

const officialButtonFallbackChannelId = 'undercover-official-button-fallback-channel'
await UndercoverEngine.startGame(officialButtonFallbackChannelId, hostId, {
  wordSource: 'custom',
  civilianWord: '咖啡',
  undercoverWord: '奶茶',
  allowLying: false,
})
await UndercoverEngine.addPlayer(officialButtonFallbackChannelId, 'b1')
await UndercoverEngine.addPlayer(officialButtonFallbackChannelId, 'b2')
await UndercoverEngine.addPlayer(officialButtonFallbackChannelId, 'b3')
let officialButtonDeferred = false
let officialButtonFollowUp: any
let officialButtonPublicPanel: any
Math.random = sequenceRng([0, 0, 0])
const originalConsoleError = console.error
const hostSecretFallbackErrors: unknown[][] = []
console.error = (...args: unknown[]) => {
  hostSecretFallbackErrors.push(args)
}
try {
  await handleUndercoverButton({
    customId: 'undercover_official_start',
    guild: {
      members: {
        fetch: async (userId: string) => ({ displayName: `按钮玩家${userId}` }),
      },
    },
    client: {
      users: {
        fetch: async (userId: string) => ({
          displayName: `按钮玩家${userId}`,
          username: userId,
          send: async () => undefined,
        }),
      },
    },
    channelId: officialButtonFallbackChannelId,
    channel: {
      send: async (payload: any) => {
        officialButtonPublicPanel = payload
      },
    },
    user: { id: hostId },
    deferReply: async (payload: any) => {
      assert.equal(payload.ephemeral, true)
      officialButtonDeferred = true
    },
    editReply: async () => {
      throw new Error('模拟按钮路径主持人私密面板展示失败')
    },
    followUp: async (payload: any) => {
      officialButtonFollowUp = payload
    },
  } as any)
} finally {
  console.error = originalConsoleError
  Math.random = originalRandom
}
assert.equal(hostSecretFallbackErrors.length, 1)
assert.equal(officialButtonDeferred, true)
assert.equal(getPanelText(officialButtonPublicPanel).includes('**发言顺序：**'), true)
assert.equal(officialButtonFollowUp.ephemeral, true)
assert.equal(getPanelText(officialButtonFollowUp).includes('**卧底：**按钮玩家b1'), true)
assert.equal(getPanelText(officialButtonFollowUp).includes('按钮玩家b2'), false)
await UndercoverEngine.endGame(officialButtonFallbackChannelId)
console.log('✅ 报名面板正式开始按钮在原私密回复失败时会补发主持人答案')
await UndercoverEngine.endGame(officialPanelChannelId)
console.log('✅ 正式开始公开面板只展示随机固定发言顺序这一套编号')

const hostSecret = formatHostSecret({
  civilianWord: '苹果',
  undercoverWord: '梨',
  undercoverNames: ['用户A', '用户B'],
  allowLying: true,
  failedDmNames: ['用户C'],
})

assert.equal(
  hostSecret,
  '## 本局词语\n\n**平民词：**苹果\n**卧底词：**梨\n**可否撒谎：**是\n\n**卧底：**用户A、用户B\n\n**私信失败：**用户C',
)
console.log('✅ 主持人秘密信息包含词语、所有卧底、撒谎规则和私信失败提示')

const endReveal = formatEndReveal({
  civilianWord: '苹果',
  undercoverWord: '梨',
  undercoverNames: ['用户A', '用户B'],
})

assert.equal(
  endReveal,
  '## 🏁 谁是卧底结束\n\n**平民词：**苹果\n**卧底词：**梨\n\n**卧底：**用户A、用户B',
)
console.log('✅ 正式开始后结束公开信息包含平民词、卧底词和所有卧底')

const audiencePeek = formatAudiencePeek({
  civilianWord: '苹果',
  undercoverWord: '梨',
  undercoverNames: ['用户A', '用户B'],
})

assert.equal(
  audiencePeek,
  '## 👀 观众偷看\n\n**平民词：**苹果\n**卧底词：**梨\n\n**卧底：**用户A、用户B\n\n请不要泄露词汇和卧底身份。',
)
console.log('✅ 观众偷看信息包含平民词、卧底词、所有卧底和保密提醒')

let hostPeekDeferred = false
let hostPeekEdit: any
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
  user: { id: hostId },
  options: { getSubcommand: () => '观众偷看' },
  deferReply: async (payload: any) => {
    hostPeekDeferred = payload?.ephemeral === true
  },
  editReply: async (payload: any) => {
    hostPeekEdit = payload
  },
} as any)
assert.equal(hostPeekDeferred, true)
assert.equal(getPanelText(hostPeekEdit), formatAudiencePeek({
  civilianWord: '苹果',
  undercoverWord: '梨',
  undercoverNames: ['用户A'],
}))

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
assert.equal(getPanelText(audiencePeekEdit), formatAudiencePeek({
  civilianWord: '苹果',
  undercoverWord: '梨',
  undercoverNames: ['用户A'],
}))
console.log('✅ 观众偷看允许主持人和非参与旁观者使用，并会私密返回答案')

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
const reloadDeal = await UndercoverEngine.dealWords(reloadChannelId, { rng: () => 0 })
assert.deepEqual(reloadDeal.undercoverUserIds, ['r1'])
await UndercoverEngine.startSpeechRound(reloadChannelId, () => 0)
await UndercoverEngine.submitSpeech(reloadChannelId, 'r2', '重载前发言')
await UndercoverEngine.startVote(reloadChannelId, 3)
await UndercoverEngine.castVote(reloadChannelId, 'r1', 'r2')
await UndercoverEngine.castVote(reloadChannelId, 'r2', 'r1')
await UndercoverEngine.closeVote(reloadChannelId)
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
assert.deepEqual(reloadedGame?.deal?.undercoverUserIds, ['r1'])
assert.deepEqual(reloadedGame?.fixedPlayers?.map(player => player.number), [1, 2, 3])
assert.deepEqual(reloadedGame?.fixedPlayers?.map(player => player.userId), ['r2', 'r3', 'r1'])
assert.deepEqual(reloadedGame?.aliveUserIds, ['r2', 'r3', 'r1'])
assert.deepEqual(reloadedGame?.currentSpeech?.entries.map(entry => entry.content), ['重载前发言'])
assert.deepEqual(reloadedGame?.currentVote?.votes, { r1: 'r2' })
assert.equal(reloadedGame?.currentVote?.messageId, 'new-vote-message')
assert.equal(reloadedGame?.voteRounds?.length, 1)
assert.deepEqual(reloadedGame?.voteRounds?.[0]?.votes, { r1: 'r2', r2: 'r1' })
assert.equal(reloadedGame?.voteRounds?.[0]?.result.type, 'tie')
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
await UndercoverEngine.castVote(resurfaceChannelId, 'v2', 'v3')
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
const resurfaceButtonLabels = resurfaceReply.components?.[1]?.components?.map((component: any) => component.label)
assert.equal(getPanelText(resurfaceReply).includes('谁是卧底投票'), true)
assert.equal(getPanelText(resurfaceReply).includes('玩家v1 -> 玩家v2'), true)
assert.equal(getPanelText(resurfaceReply).includes('玩家v2 -> 玩家v3'), true)
assert.equal(resurfaceButtonLabels.includes('查看历史'), true)
assert.equal(deletedOldPanel, true)
assert.equal(resurfacedVote?.messageId, 'new-panel')
assert.equal(resurfacedVote?.endsAt, originalVote?.endsAt)
assert.deepEqual(resurfacedVote?.votes, { v1: 'v2', v2: 'v3' })
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
    messages: {
      fetch: async (messageId: string) => {
        assert.equal(messageId, 'timer-vote-panel')
        return {
          edit: async () => undefined,
          delete: async () => undefined,
        }
      },
    },
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
assert.deepEqual(await UndercoverEngine.castVote(timerChannelId, 't1', 't1'), { ok: true })
assert.deepEqual(await UndercoverEngine.castVote(timerChannelId, 't2', 't1'), { ok: true })
assert.deepEqual(await UndercoverEngine.castVote(timerChannelId, 't3', 't2'), { ok: true })
const dueTimer = capturedTimers.find(timer => timer.delay >= 59_000)
assert.ok(dueTimer)
dueTimer.callback()
await new Promise(resolve => originalSetTimeout(resolve, 0))
assert.equal(UndercoverEngine.getGame(timerChannelId)?.currentVote, undefined)
assert.deepEqual(UndercoverEngine.getGame(timerChannelId)?.aliveUserIds, ['t2', 't3'])
assert.equal(timerMessages.some(message => message.includes('投票结果') && message.includes('玩家t1')), true)
await UndercoverEngine.endGame(timerChannelId)
console.log('✅ 投票讨论时间到点会自动结算并发送结果面板')

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
let closedVotePanelEdit: any
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
          edit: async (payload: any) => {
            closedVotePanelEdit = payload
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
const closedVotePanelText = getPanelText(closedVotePanelEdit)
const closedVotePanelButtons = closedVotePanelEdit.components?.[1]?.components ?? []
assert.equal(closedVotePanelText.includes('谁是卧底投票'), true)
assert.equal(closedVotePanelText.includes('玩家e1 -> 玩家e1'), true)
assert.equal(closedVotePanelText.includes('玩家e2 -> 玩家e1'), true)
assert.equal(closedVotePanelText.includes('玩家e3 -> 玩家e1'), true)
assert.equal(closedVotePanelText.includes('3. 玩家e1：3 票'), true)
assert.deepEqual(closedVotePanelButtons.map((component: any) => component.disabled), [true, true, true])
assert.equal(UndercoverEngine.hasActiveGame(undercoverEliminatedChannelId), true)
assert.equal(UndercoverEngine.getGame(undercoverEliminatedChannelId)?.currentVote, undefined)
assert.deepEqual(UndercoverEngine.getGame(undercoverEliminatedChannelId)?.aliveUserIds, ['e2', 'e3'])
assert.equal(getPanelText(undercoverResultPanel).includes('玩家e1'), true)
assert.equal(getPanelText(undercoverResultPanel).includes('遗憾出局'), true)
assert.equal(getPanelText(undercoverResultPanel).includes('卧底被淘汰，平民胜利'), false)
assert.equal(getPanelText(undercoverResultPanel).includes('游戏结束'), false)
await UndercoverEngine.endGame(undercoverEliminatedChannelId)
console.log('✅ 投票只宣布被淘汰玩家，不判断卧底或平民胜利')

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
