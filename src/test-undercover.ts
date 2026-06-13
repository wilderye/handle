import assert from 'node:assert/strict'
import { execute as executeUndercoverCommand } from './commands/undercover.js'
import {
  UndercoverEngine,
  formatAudiencePeek,
  formatEndReveal,
  formatHostSecret,
  formatLobbyMessage,
  formatPreparedEnd,
  formatSpeechOrder,
  parseUndercoverWordPairs,
} from './game/undercover.js'

console.log('🧪 开始谁是卧底核心逻辑测试...\n')

function getPanelText(payload: any): string {
  return payload?.components?.[0]?.components?.[0]?.content ?? ''
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

const dealResult = await UndercoverEngine.dealWords(channelId, () => 0)

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

UndercoverEngine.clearCacheForTest()
assert.equal(UndercoverEngine.hasActiveGame(reloadChannelId), false)
await UndercoverEngine.reloadFromStoreForTest()
const reloadedGame = UndercoverEngine.getGame(reloadChannelId)
assert.equal(reloadedGame?.joinMessageId, 'join-message-1')
assert.deepEqual(reloadedGame?.players.map(player => player.userId), ['r1', 'r2', 'r3'])
assert.equal(reloadedGame?.deal?.undercoverUserId, 'r1')
await UndercoverEngine.endGame(reloadChannelId)
UndercoverEngine.clearCacheForTest()
await UndercoverEngine.reloadFromStoreForTest()
assert.equal(UndercoverEngine.hasActiveGame(reloadChannelId), false)
console.log('✅ 谁是卧底状态写入存储，并可在重载缓存后恢复和删除')

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
