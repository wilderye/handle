import assert from 'node:assert/strict'
import {
  UndercoverEngine,
  formatEndReveal,
  formatHostSecret,
  formatLobbyMessage,
  formatPreparedEnd,
  formatSpeechOrder,
  parseUndercoverWordPairs,
} from './game/undercover.js'

console.log('🧪 开始谁是卧底核心逻辑测试...\n')

UndercoverEngine.resetAllForTest()

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

const start = UndercoverEngine.startGame(channelId, hostId, {
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
console.log('✅ 准备阶段保存主持人、词汇来源、词语和撒谎规则')

assert.throws(
  () => UndercoverEngine.assertHost(channelId, 'not-host'),
  /只有主持人/,
)
assert.doesNotThrow(() => UndercoverEngine.assertHost(channelId, hostId))
console.log('✅ 主持人权限通过创建者数字 ID 判断')

assert.equal(UndercoverEngine.addPlayer(channelId, 'u1').added, true)
assert.equal(UndercoverEngine.addPlayer(channelId, 'u1').added, false)
assert.equal(UndercoverEngine.addPlayer(channelId, 'u2').added, true)

assert.throws(
  () => UndercoverEngine.dealWords(channelId, () => 0),
  /至少需要 3 名玩家/,
)

assert.equal(UndercoverEngine.addPlayer(channelId, 'u3').added, true)
console.log('✅ 报名状态支持去重，并阻止少于 3 人正式开始')

const dealResult = UndercoverEngine.dealWords(channelId, () => 0)

assert.equal(dealResult.undercoverUserId, 'u1')
assert.deepEqual(
  dealResult.assignments.map(a => ({ userId: a.userId, role: a.role, word: a.word })),
  [
    { userId: 'u1', role: 'undercover', word: '梨' },
    { userId: 'u2', role: 'civilian', word: '苹果' },
    { userId: 'u3', role: 'civilian', word: '苹果' },
  ],
)
assert.equal(UndercoverEngine.addPlayer(channelId, 'u4').reason, 'already_dealt')
assert.equal(UndercoverEngine.removePlayer(channelId, 'u2').removed, false)
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

UndercoverEngine.endGame(channelId)
assert.equal(UndercoverEngine.hasActiveGame(channelId), false)

const preparedChannelId = 'undercover-prepared-channel'
const prepared = UndercoverEngine.startGame(preparedChannelId, hostId, {
  wordSource: 'random',
  civilianWord: '猫',
  undercoverWord: '狗',
  allowLying: false,
})
assert.equal(prepared.ok, true)
assert.equal(prepared.game?.wordSource, 'random')
assert.equal(prepared.game?.allowLying, false)

const preparedEnd = formatPreparedEnd({
  civilianWord: prepared.game!.civilianWord,
  undercoverWord: prepared.game!.undercoverWord,
})

assert.equal(
  preparedEnd,
  '## 🏁 谁是卧底结束\n\n本局尚未正式开始，卧底尚未分配。\n\n**平民词：**猫\n**卧底词：**狗',
)
console.log('✅ 未正式开始时结束会说明卧底尚未分配，并公布已准备词语')

UndercoverEngine.resetAllForTest()

console.log('\n🎉 谁是卧底核心逻辑测试全部通过！')
