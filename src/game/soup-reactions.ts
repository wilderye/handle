import { MessageReaction, User, PartialMessageReaction, PartialUser } from 'discord.js';
import { getSoupDB, hasActiveGame } from './soup-db.js';

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

// ── 诊断用：打印 emoji 的 Unicode codepoints ──
function emojiCodepoints(s: string): string {
  return [...s].map(c => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')).join(' ');
}

export async function handleReactionAdd(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser
) {
  // ── O(1) 快速短路：频道无活跃游戏则直接忽略 ──
  const channelId = reaction.message.channelId;
  if (!hasActiveGame(channelId)) return;

  // If partial, fetch it
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (error) {
      console.error('[Soup-Add] Failed to fetch reaction:', error);
      return;
    }
  }

  if (reaction.message.partial) {
    try {
      await reaction.message.fetch();
    } catch (error) {
      console.error('[Soup-Add] Failed to fetch message:', error);
      return;
    }
  }

  const emojiName = reaction.emoji.name;
  if (!emojiName) return;

  const db = getSoupDB();
  const game = await db.getGame(channelId);

  if (!game) return;

  if (user.id !== game.hostId) return;

  const message = reaction.message;
  const messageId = message.id;
  const content = message.content || '';

  // Case 1: 📌 → pin 消息
  if (emojiName === PIN_EMOJI) {
    try {
      await message.pin();
      console.log(`[Soup-Add] 已 pin 消息`);
    } catch (e: any) {
      console.error(`[Soup-Add] Pin 失败: ${e.message}`);
    }
    return;
  }

  // Enforce that player asked this
  const authorId = message.author?.id;
  if (!authorId) return;
  if (authorId === game.hostId) return;
  if (message.author?.bot) return;

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
    console.log(`[Soup] 归档: msgId=${messageId}, type=${answerType}, important=${isImportant}`);
  }

  // Case 3: Important emoji added
  if (IMPORTANT_EMOJIS.has(emojiName)) {
    const question = await db.getQuestion(messageId);
    if (question) {
      await db.updateQuestionImportance(messageId, true);
    }
  }
}

export async function handleReactionRemove(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser
) {
  // ── O(1) 快速短路 ──
  const channelId = reaction.message.channelId;
  if (!hasActiveGame(channelId)) return;

  // If partial, fetch it
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (error) {
      console.error('[Soup-Remove] Failed to fetch reaction:', error);
      return;
    }
  }

  if (reaction.message.partial) {
    try {
      await reaction.message.fetch();
    } catch (error) {
      console.error('[Soup-Remove] Failed to fetch message:', error);
      return;
    }
  }

  const emojiName = reaction.emoji.name;
  if (!emojiName) return;

  const db = getSoupDB();
  const game = await db.getGame(channelId);

  if (!game) return;
  if (user.id !== game.hostId) return;

  const message = reaction.message;
  const messageId = message.id;

  // Case 1: 📌 removed → unpin 消息
  if (emojiName === PIN_EMOJI) {
    try {
      await message.unpin();
      console.log(`[Soup-Remove] 已 unpin`);
    } catch (e: any) {
      console.error(`[Soup-Remove] Unpin 失败: ${e.message}`);
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
      console.log(`[Soup] 切换判定: msgId=${messageId} → ${nextCoreEmoji}`);
      }
    } else {
      await db.deleteQuestion(messageId);
    }
  }

  // Case 3: Important emoji removed
  if (IMPORTANT_EMOJIS.has(emojiName)) {
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
        console.log(`[Soup-Remove] 取消重要标记: msgId=${messageId}`);
      }
    }
  }
}
