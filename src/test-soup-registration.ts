import assert from 'node:assert/strict'
import {
  consumeSoupRegistration,
  createSoupRegistration,
  formatSoupRegistrationDm,
  formatSoupRegistrationFailureNotice,
  formatSoupRegistrationMessage,
  hasSoupRegistration,
  resetSoupRegistrationsForTest,
} from './game/soup-registration.js'

console.log('🧪 开始海龟汤报名阶段测试...\n')

resetSoupRegistrationsForTest()

const channelId = 'soup-registration-channel'

assert.equal(hasSoupRegistration(channelId), false)

const created = createSoupRegistration(channelId, 'message-1')
assert.equal(created.ok, true)
assert.equal(created.registration?.channelId, channelId)
assert.equal(created.registration?.messageId, 'message-1')
assert.equal(hasSoupRegistration(channelId), true)

const duplicate = createSoupRegistration(channelId, 'message-2')
assert.equal(duplicate.ok, false)
assert.equal(consumeSoupRegistration(channelId)?.messageId, 'message-1')
assert.equal(hasSoupRegistration(channelId), false)
assert.equal(consumeSoupRegistration(channelId), null)
console.log('✅ 报名阶段按频道创建、拒绝重复，并可消费清理')

assert.equal(
  formatSoupRegistrationMessage(),
  '## 🍲 海龟汤报名开始\n\n想在本局开汤时收到私信提醒，请点击 ✅ 报名。\n\n报名后，汤主使用 `/海龟汤 开始` 正式开汤时，Bot 会私信通知你来提问。',
)
assert.equal(
  formatSoupRegistrationDm(),
  '## 🍲 海龟汤\n\n汤面已发布，快来提问！',
)
assert.equal(
  formatSoupRegistrationFailureNotice(['用户A', '用户B']),
  '## 🍲 海龟汤\n\n⚠️ 有报名者无法收到私信：用户A、用户B',
)
console.log('✅ 报名面板、报名者私信和汤主失败提示文案正确')

resetSoupRegistrationsForTest()

console.log('\n🎉 海龟汤报名阶段测试全部通过！')
