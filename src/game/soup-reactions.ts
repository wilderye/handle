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
  if (!emojiName) return;

  const channelId = reaction.message.channelId;
  const db = getSoupDB();
  const game = await db.getGame(channelId);

  // Check if there is an active soup game in this channel
  if (!game) return;

  // Only host's reaction matters!
  if (user.id !== game.hostId) return;

  const message = reaction.message;
  const messageId = message.id;

  const content = message.content || '';

  // Case 1: 📌 → pin 消息 (允许汤主 pin 自己的消息，比如汤面)
  if (emojiName === PIN_EMOJI) {
    try {
      await message.pin();
    } catch (e: any) {
      console.error(`📌 [Soup] Failed to pin message: ${e.message}`);
    }
    return;
  }

  // Enforce that player asked this (host cannot archive their own question/statements for core emojis)
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
  if (!emojiName) return;

  const channelId = reaction.message.channelId;
  const db = getSoupDB();
  const game = await db.getGame(channelId);

  // Check if there is an active soup game in this channel
  if (!game) return;

  // Only host's reaction matters!
  if (user.id !== game.hostId) return;

  const message = reaction.message;
  const messageId = message.id;

  // Case 1: 📌 removed → unpin 消息
  if (emojiName === PIN_EMOJI) {
    try {
      await message.unpin();
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
      }
    } else {
      await db.deleteQuestion(messageId);
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
      }
    }
  }
}
