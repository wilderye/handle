import { config } from 'dotenv';
import { initSoupDB, getSoupDB, isUsingPostgres } from './game/soup-db.js';

// 加载环境变量
config();

async function runTests() {
  console.log('🧪 开始海龟汤存储引擎测试...\n');

  // 1. 初始化数据库
  await initSoupDB();
  console.log(`ℹ️ 当前存储模式: ${isUsingPostgres() ? 'PostgreSQL 数据库' : '内存存储'}\n`);

  const db = getSoupDB();
  const testChannelId = 'test-soup-channel-' + Date.now();
  const testHostId = 'host-user-111';
  const testPlayerId = 'player-user-222';
  const testRiddle = '一个男的在海边喝了一碗海龟汤，然后他就自杀了。为什么？';

  // 2. 创建游戏
  console.log('🔄 2. 创建海龟汤游戏...');
  const createSuccess = await db.createGame(testChannelId, testHostId, testRiddle);
  console.log(`✅ 创建状态: ${createSuccess ? '成功' : '失败'}`);

  // 3. 获取游戏
  console.log('\n🔄 3. 获取海龟汤游戏...');
  const game = await db.getGame(testChannelId);
  if (!game) {
    throw new Error('❌ 未能获取到刚创建的游戏！');
  }
  console.log(`✅ 获取成功:`);
  console.log(`   频道 ID: ${game.channelId}`);
  console.log(`   主持人 ID: ${game.hostId}`);
  console.log(`   谜面: ${game.riddle}`);

  // 4. 添加判定提问 1
  console.log('\n🔄 4. 添加第一条猜测判定...');
  const question1MsgId = 'msg-111111';
  const question1Content = '这汤是毒药做的吗？';
  await db.addOrUpdateQuestion({
    messageId: question1MsgId,
    channelId: testChannelId,
    userId: testPlayerId,
    content: question1Content,
    answerType: 'no',
    isImportant: false
  });
  console.log(`✅ 第一条提问添加成功`);

  // 5. 添加判定提问 2 且标记为重要线索
  console.log('\n🔄 5. 添加第二条重要猜测判定...');
  const question2MsgId = 'msg-222222';
  const question2Content = '海龟汤和他多年前失踪的妻子有关吗？';
  await db.addOrUpdateQuestion({
    messageId: question2MsgId,
    channelId: testChannelId,
    userId: testPlayerId,
    content: question2Content,
    answerType: 'yes',
    isImportant: true
  });
  console.log(`✅ 第二条重要提问添加成功`);

  // 6. 获取提问列表并验证
  console.log('\n🔄 6. 查询当前频道的所有判定历史...');
  const questions = await db.getQuestionsForGame(testChannelId);
  console.log(`✅ 成功获取到 ${questions.length} 条记录:`);
  questions.forEach((q, idx) => {
    console.log(`   ${idx + 1}. [${q.answerType}] (重要: ${q.isImportant}) <@${q.userId}>: "${q.content}"`);
  });

  if (questions.length !== 2) {
    throw new Error(`❌ 记录条数异常，期望 2 条，实际 ${questions.length} 条`);
  }

  // 7. 更新问题重要性
  console.log('\n🔄 7. 修改第一条判定为重要线索...');
  await db.updateQuestionImportance(question1MsgId, true);
  const updatedQ1 = await db.getQuestion(question1MsgId);
  console.log(`✅ 修改后重要性: ${updatedQ1?.isImportant ? '是' : '否'}`);
  if (updatedQ1?.isImportant !== true) {
    throw new Error('❌ 第一条判定的重要性更新失败！');
  }

  // 8. 删除单个问题
  console.log('\n🔄 8. 删除第二条提问判定...');
  await db.deleteQuestion(question2MsgId);
  const questionsAfterDeleteOne = await db.getQuestionsForGame(testChannelId);
  console.log(`✅ 删除后剩余记录数: ${questionsAfterDeleteOne.length}`);
  if (questionsAfterDeleteOne.length !== 1) {
    throw new Error(`❌ 期望剩余 1 条记录，实际有 ${questionsAfterDeleteOne.length} 条`);
  }

  // 9. 结束游戏并验证级联删除
  console.log('\n🔄 9. 结束游戏并删除游戏状态...');
  await db.deleteGame(testChannelId);
  const gameAfterDelete = await db.getGame(testChannelId);
  console.log(`✅ 游戏状态清理: ${gameAfterDelete === null ? '成功（已删除）' : '失败'}`);

  const questionsAfterGameDelete = await db.getQuestionsForGame(testChannelId);
  console.log(`✅ 级联删除提问记录: ${questionsAfterGameDelete.length === 0 ? '成功（全部清理）' : '失败'}`);
  if (questionsAfterGameDelete.length !== 0) {
    throw new Error(`❌ 级联删除失败，依然残留 ${questionsAfterGameDelete.length} 条记录`);
  }

  console.log('\n🎉 所有海龟汤存储引擎测试全部通过！完美无缺！');
  process.exit(0);
}

runTests().catch(err => {
  console.error('\n❌ 测试执行失败:', err);
  process.exit(1);
});
