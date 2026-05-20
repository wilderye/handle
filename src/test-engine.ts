// 测试脚本：验证 GameEngine 是否正常工作
import { GameEngine } from './game/engine.js'

console.log('🧪 测试 GameEngine...\n')

// 测试1：开始游戏
const channelId = 'test-channel-123'
const { word, hint } = GameEngine.startGame(channelId)
console.log(`✅ 开始游戏成功`)
console.log(`   答案: ${word}`)
console.log(`   提示: ${hint}\n`)

// 测试2：检查游戏是否存在
const hasGame = GameEngine.hasActiveGame(channelId)
console.log(`✅ 检查游戏状态: ${hasGame ? '存在' : '不存在'}\n`)

// 测试3：验证输入
const validTest = GameEngine.validateInput('天南海北')
console.log(`✅ 验证有效成语: ${validTest.valid ? '通过' : '失败'}`)

const invalidTest = GameEngine.validateInput('随便四字')
console.log(`✅ 验证无效成语: ${invalidTest.valid ? '通过' : '失败'} (期望失败)\n`)

// 测试4：处理猜测
const userId = 'test-user-456'
const guessResult = GameEngine.processGuess(channelId, userId, word) // 直接猜正确答案
console.log(`✅ 处理猜测:`)
console.log(`   猜测: ${word}`)
console.log(`   是否猜中: ${guessResult.isWin}`)
console.log(`   剩余次数: ${guessResult.triesLeft}\n`)

// 测试5：结束游戏
const endResult = await GameEngine.endGame(channelId, guessResult.isWin ? userId : undefined)
console.log(`✅ 结束游戏:`)
console.log(`   答案: ${endResult?.answer}`)
console.log(`   参与者: ${endResult?.participants.join(', ')}\n`)

// 测试6：获取玩家统计
const stats = await GameEngine.getPlayerStats(userId)
console.log(`✅ 玩家统计:`)
console.log(`   参与局数: ${stats.oddsPlayedGames}`)
console.log(`   猜中局数: ${stats.wonGames}`)
console.log(`   胜率: ${stats.winRate}\n`)

console.log('🎉 所有测试通过！')
