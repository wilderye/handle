import assert from 'node:assert/strict'
import {
  UndercoverEngine,
  formatHostSecret,
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

const start = UndercoverEngine.startGame(channelId, hostId)
assert.equal(start.ok, true)
assert.equal(UndercoverEngine.hasActiveGame(channelId), true)

assert.equal(UndercoverEngine.addPlayer(channelId, 'u1').added, true)
assert.equal(UndercoverEngine.addPlayer(channelId, 'u1').added, false)
assert.equal(UndercoverEngine.addPlayer(channelId, 'u2').added, true)

assert.throws(
  () => UndercoverEngine.dealWords(channelId, { civilian: '苹果', undercover: '梨' }, () => 0),
  /至少需要 3 名玩家/,
)

assert.equal(UndercoverEngine.addPlayer(channelId, 'u3').added, true)
console.log('✅ 报名状态支持去重，并阻止少于 3 人发词')

const dealResult = UndercoverEngine.dealWords(
  channelId,
  { civilian: '苹果', undercover: '梨' },
  () => 0,
)

assert.equal(dealResult.undercoverUserId, 'u1')
assert.deepEqual(
  dealResult.assignments.map(a => ({ userId: a.userId, role: a.role, word: a.word })),
  [
    { userId: 'u1', role: 'undercover', word: '梨' },
    { userId: 'u2', role: 'civilian', word: '苹果' },
    { userId: 'u3', role: 'civilian', word: '苹果' },
  ],
)
console.log('✅ 发词会随机选出 1 名卧底，其余玩家拿平民词')

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

const hostSecret = formatHostSecret({
  civilianWord: '苹果',
  undercoverWord: '梨',
  undercoverName: '用户A',
  failedDmNames: ['用户C'],
})

assert.equal(
  hostSecret,
  '## 本局词语\n\n**平民词：**苹果\n**卧底词：**梨\n\n**卧底：**用户A\n\n**私信失败：**用户C',
)
console.log('✅ 主持人秘密信息包含词语、卧底和私信失败提示')

UndercoverEngine.endGame(channelId)
assert.equal(UndercoverEngine.hasActiveGame(channelId), false)

console.log('\n🎉 谁是卧底核心逻辑测试全部通过！')
