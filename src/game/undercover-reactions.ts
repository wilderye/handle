import { MessageReaction, PartialMessageReaction, PartialUser, User } from 'discord.js'
import {
  UndercoverEngine,
  UNDERCOVER_JOIN_EMOJI,
} from './undercover.js'

export async function handleUndercoverReactionAdd(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
) {
  if (user.bot) return

  const channelId = reaction.message.channelId
  const game = UndercoverEngine.getGame(channelId)
  if (!game || game.dealtAt) return

  if (
    reaction.message.id !== game.joinMessageId ||
    reaction.emoji.name !== UNDERCOVER_JOIN_EMOJI
  ) {
    return
  }

  const result = await UndercoverEngine.addPlayer(channelId, user.id)
  if (!result.added && (result.reason === 'host' || result.reason === 'duplicate')) {
    if (reaction.partial) {
      try {
        await reaction.fetch()
      } catch (error) {
        console.error('[Undercover] 获取 reaction 失败:', error)
        return
      }
    }
    await reaction.users.remove(user.id).catch(() => undefined)
  }
}

export async function handleUndercoverReactionRemove(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
) {
  if (user.bot) return

  const channelId = reaction.message.channelId
  const game = UndercoverEngine.getGame(channelId)
  if (!game || game.dealtAt) return

  if (
    reaction.message.id !== game.joinMessageId ||
    reaction.emoji.name !== UNDERCOVER_JOIN_EMOJI
  ) {
    return
  }

  await UndercoverEngine.removePlayer(channelId, user.id)
}
