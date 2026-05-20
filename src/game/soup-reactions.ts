import { MessageReaction, User, PartialMessageReaction, PartialUser } from 'discord.js';
import { getSoupDB } from './soup-db.js';

export const CORE_EMOJIS: Record<string, 'yes' | 'no' | 'yes_and_no' | 'irrelevant'> = {
  '✅': 'yes',
  '❌': 'no',
  '❎': 'no',
  '⭕': 'yes_and_no',
  '🚫': 'irrelevant',
};

// 📌 不归档，而是直接 pin 消息
const PIN_EMOJI = '📌';

export const IMPORTANT_EMOJIS = new Set(['❗', '‼️']);

export async function handleReactionAdd(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser
) {
  console.log(`[Soup-Reaction] 收到反应事件! emoji=${reaction.emoji.name}, userId=${user.id}, partial=${reaction.partial}`);

  // If partial, fetch it
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (error) {
      console.error('[Soup-Reaction] Failed to fetch reaction:', error);
      return;
    }
  }

  if (reaction.message.partial) {
    try {
      await reaction.message.fetch();
    } catch (error) {
      console.error('[Soup-Reaction] Failed to fetch message:', error);
      return;
    }
  }

  const emojiName = reaction.emoji.name;
  if (!emojiName) { console.log('[Soup-Reaction] 退出: emojiName 为空'); return; }

  const channelId = reaction.message.channelId;
  const db = getSoupDB();
  const game = await db.getGame(channelId);

  // Check if there is an active soup game in this channel
  if (!game) { console.log(`[Soup-Reaction] 退出: 频道 ${channelId} 没有进行中的游戏`); return; }

  console.log(`[Soup-Reaction] 找到游戏, hostId=${game.hostId}, reactorId=${user.id}`);

  // Only host's reaction matters!
  if (user.id !== game.hostId) { console.log(`[Soup-Reaction] 退出: 反应者不是汤主 (${user.id} !== ${game.hostId})`); return; }

  const message = reaction.message;
  const messageId = message.id;

  const content = message.content || '';

  // Case 1: 📌 → pin 消息 (允许汤主 pin 自己的消息，比如汤面)
  if (emojiName === PIN_EMOJI) {
    try {
      await message.pin();
      console.log(`📌 [Soup] Pinned message: "${content}"`);
    } catch (e: any) {
      console.error(`📌 [Soup] Failed to pin message: ${e.message}`);
    }
    return;
  }

  // Enforce that player asked this (host cannot archive their own question/statements for core emojis)
  const authorId = message.author?.id;
  if (!authorId) { console.log('[Soup-Reaction] 退出: 消息没有 author'); return; }
  if (authorId === game.hostId) { console.log('[Soup-Reaction] 退出: 汤主不能对自己的消息判定'); return; }
  if (message.author?.bot) { console.log('[Soup-Reaction] 退出: 消息作者是 bot'); return; }

  console.log(`[Soup-Reaction] 通过所有检查! emoji=${emojiName}, content="${content}", author=${authorId}`);

  // Case 2: Core emoji added → 归档判定
  if (emojiName in CORE_EMOJIS) {
    const answerType = CORE_EMOJIS[emojiName];

    // Check if exclamation emoji from host is also present
    let isImportant = false;
    for (const [_, msgReaction] of message.reactions.cache.entries()) {
      if (msgReaction.emoji.name && IMPORTANT_EMOJIS.has(msgReaction.emoji.name)) {
        const users = await msgReaction.users.fetch();
        if (users.has(game.hostId)) {
          isImportant = true;
          break;
        }
      }
    }

    await db.addOrUpdateQuestion({
      messageId,
      channelId,
      userId: authorId,
      content,
      answerType,
      isImportant
    });
    console.log(`📝 [Soup] Archived question: "${content}" as ${answerType} (important: ${isImportant})`);
  } else {
    console.log(`[Soup-Reaction] emoji "${emojiName}" 不在 CORE_EMOJIS 中，跳过归档`);
  }

  // Case 3: Important emoji added
  if (IMPORTANT_EMOJIS.has(emojiName)) {
    const question = await db.getQuestion(messageId);
    if (question) {
      await db.updateQuestionImportance(messageId, true);
      console.log(`📝 [Soup] Marked question "${question.content}" as IMPORTANT`);
    }
  }
}

export async function handleReactionRemove(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser
) {
  console.log(`[Soup-Reaction-Remove] 收到移除反应事件! emoji=${reaction.emoji.name}, userId=${user.id}, partial=${reaction.partial}`);
  // If partial, fetch it
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (error) {
      console.error('[Soup-Reaction-Remove] Failed to fetch reaction:', error);
      return;
    }
  }

  if (reaction.message.partial) {
    try {
      await reaction.message.fetch();
    } catch (error) {
      console.error('[Soup-Reaction-Remove] Failed to fetch message:', error);
      return;
    }
  }

  const emojiName = reaction.emoji.name;
  if (!emojiName) { console.log('[Soup-Reaction-Remove] 退出: emojiName 为空'); return; }

  const channelId = reaction.message.channelId;
  const db = getSoupDB();
  const game = await db.getGame(channelId);

  // Check if there is an active soup game in this channel
  if (!game) { console.log(`[Soup-Reaction-Remove] 退出: 频道 ${channelId} 没有进行中的游戏`); return; }

  // Only host's reaction matters!
  if (user.id !== game.hostId) { console.log(`[Soup-Reaction-Remove] 退出: 反应者不是汤主 (${user.id} !== ${game.hostId})`); return; }

  const message = reaction.message;
  const messageId = message.id;

  console.log(`[Soup-Reaction-Remove] 验证通过! emoji=${emojiName}, messageId=${messageId}`);

  // Case 1: 📌 removed → unpin 消息
  if (emojiName === PIN_EMOJI) {
    try {
      await message.unpin();
      console.log(`📌 [Soup] Unpinned message`);
    } catch (e: any) {
      console.error(`📌 [Soup] Failed to unpin message: ${e.message}`);
    }
    return;
  }

  // Case 2: Core emoji removed
  if (emojiName in CORE_EMOJIS) {
    let nextCoreEmoji: string | null = null;
    let nextAnswerType: 'yes' | 'no' | 'yes_and_no' | 'irrelevant' | null = null;

    for (const [_, msgReaction] of message.reactions.cache.entries()) {
      const name = msgReaction.emoji.name;
      if (name && name !== emojiName && name in CORE_EMOJIS) {
        const users = await msgReaction.users.fetch();
        if (users.has(game.hostId)) {
          nextCoreEmoji = name;
          nextAnswerType = CORE_EMOJIS[name];
          break;
        }
      }
    }

    if (nextAnswerType && nextCoreEmoji) {
      const question = await db.getQuestion(messageId);
      if (question) {
        await db.addOrUpdateQuestion({
          messageId,
          channelId,
          userId: question.userId,
          content: question.content,
          answerType: nextAnswerType,
          isImportant: question.isImportant
        });
        console.log(`📝 [Soup] Updated question to next emoji ${nextCoreEmoji}`);
      }
    } else {
      await db.deleteQuestion(messageId);
      console.log(`📝 [Soup] Removed question from archive (no more core emojis)`);
    }
  }

  // Case 2: Important emoji removed
  if (IMPORTANT_EMOJIS.has(emojiName)) {
    // Check if there are other exclamation emojis from the host
    let hasOtherExclamation = false;
    for (const [_, msgReaction] of message.reactions.cache.entries()) {
      const name = msgReaction.emoji.name;
      if (name && name !== emojiName && IMPORTANT_EMOJIS.has(name)) {
        const users = await msgReaction.users.fetch();
        if (users.has(game.hostId)) {
          hasOtherExclamation = true;
          break;
        }
      }
    }

    if (!hasOtherExclamation) {
      const question = await db.getQuestion(messageId);
      if (question) {
        await db.updateQuestionImportance(messageId, false);
        console.log(`📝 [Soup] Unmarked question "${question.content}" as important`);
      }
    }
  }
}
