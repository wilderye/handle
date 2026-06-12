import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export const UNDERCOVER_JOIN_EMOJI = '✅'
export const UNDERCOVER_MIN_PLAYERS = 3

export interface UndercoverWordPair {
  civilian: string
  undercover: string
}

export type UndercoverWordSource = 'custom' | 'random'

export interface UndercoverPlayer {
  userId: string
  joinedAt: number
}

export interface UndercoverGame {
  channelId: string
  hostId: string
  joinMessageId?: string
  wordSource: UndercoverWordSource
  civilianWord: string
  undercoverWord: string
  allowLying: boolean
  players: UndercoverPlayer[]
  dealtAt?: number
  deal?: UndercoverDealResult
  createdAt: number
}

export interface UndercoverAssignment {
  userId: string
  role: 'civilian' | 'undercover'
  word: string
}

export interface UndercoverDealResult {
  civilianWord: string
  undercoverWord: string
  undercoverUserId: string
  assignments: UndercoverAssignment[]
}

export interface DisplayPlayer {
  userId: string
  displayName: string
}

const games = new Map<string, UndercoverGame>()

export function parseUndercoverWordPairs(raw: string): UndercoverWordPair[] {
  return raw
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.split(/\s+/u))
    .filter(parts => parts.length >= 2)
    .map(([civilian, undercover]) => ({ civilian, undercover }))
}

const wordsPath = join(__dirname, '../../src/data/undercover_words.txt')
export const UndercoverWordPairs = parseUndercoverWordPairs(readFileSync(wordsPath, 'utf-8'))

export function getRandomUndercoverWordPair(
  rng: () => number = Math.random,
): UndercoverWordPair {
  if (UndercoverWordPairs.length === 0) {
    throw new Error('谁是卧底词库为空')
  }
  const index = Math.min(
    UndercoverWordPairs.length - 1,
    Math.floor(rng() * UndercoverWordPairs.length),
  )
  return UndercoverWordPairs[index]
}

export function formatSpeechOrder(players: DisplayPlayer[]): string {
  const lines = players.map((player, index) => {
    return `**${index + 1}.** ${sanitizeDisplayName(player.displayName)}`
  })
  return `**建议发言顺序：**\n${lines.join('\n')}`
}

export function formatBooleanRule(value: boolean): string {
  return value ? '是' : '否'
}

export function formatWordSource(source: UndercoverWordSource): string {
  return source === 'random' ? '随机发词' : '自定义发词'
}

export function formatHostSecret(input: {
  civilianWord: string
  undercoverWord: string
  undercoverName: string
  allowLying: boolean
  failedDmNames?: string[]
}): string {
  let content =
    `## 本局词语\n\n` +
    `**平民词：**${input.civilianWord}\n` +
    `**卧底词：**${input.undercoverWord}\n` +
    `**可否撒谎：**${formatBooleanRule(input.allowLying)}\n\n` +
    `**卧底：**${sanitizeDisplayName(input.undercoverName)}`

  if (input.failedDmNames && input.failedDmNames.length > 0) {
    content += `\n\n**私信失败：**${input.failedDmNames.map(sanitizeDisplayName).join('、')}`
  }

  return content
}

export function formatEndReveal(input: {
  civilianWord: string
  undercoverWord: string
  undercoverName: string
}): string {
  return (
    `## 🏁 谁是卧底结束\n\n` +
    `**平民词：**${input.civilianWord}\n` +
    `**卧底词：**${input.undercoverWord}\n\n` +
    `**卧底：**${sanitizeDisplayName(input.undercoverName)}`
  )
}

export function formatPreparedEnd(input: {
  civilianWord: string
  undercoverWord: string
}): string {
  return (
    `## 🏁 谁是卧底结束\n\n` +
    `本局尚未正式开始，卧底尚未分配。\n\n` +
    `**平民词：**${input.civilianWord}\n` +
    `**卧底词：**${input.undercoverWord}`
  )
}

export function formatLobbyMessage(input: {
  hostName: string
  wordSource: UndercoverWordSource
  allowLying: boolean
}): string {
  return (
    `## 🎭 谁是卧底报名开始\n\n` +
    `**主持人：**${sanitizeDisplayName(input.hostName)}\n` +
    `**词汇来源：**${formatWordSource(input.wordSource)}\n` +
    `**可否撒谎：**${formatBooleanRule(input.allowLying)}\n` +
    `请点击 ${UNDERCOVER_JOIN_EMOJI} 报名。\n` +
    `主持人使用 \`/卧底 正式开始\` 停止报名并发词。`
  )
}

function sanitizeDisplayName(name: string): string {
  const trimmed = name.replace(/\s+/gu, ' ').trim()
  return trimmed || '未知玩家'
}

export class UndercoverEngine {
  static startGame(
    channelId: string,
    hostId: string,
    input: {
      wordSource: UndercoverWordSource
      civilianWord: string
      undercoverWord: string
      allowLying: boolean
    },
  ): {
    ok: boolean
    game?: UndercoverGame
    error?: string
  } {
    if (games.has(channelId)) {
      return { ok: false, error: '当前频道已有进行中的谁是卧底。' }
    }
    if (!input.civilianWord.trim() || !input.undercoverWord.trim()) {
      return { ok: false, error: '平民词和卧底词都不能为空。' }
    }
    if (input.civilianWord.trim() === input.undercoverWord.trim()) {
      return { ok: false, error: '平民词和卧底词不能相同。' }
    }

    const game: UndercoverGame = {
      channelId,
      hostId,
      wordSource: input.wordSource,
      civilianWord: input.civilianWord.trim(),
      undercoverWord: input.undercoverWord.trim(),
      allowLying: input.allowLying,
      players: [],
      createdAt: Date.now(),
    }

    games.set(channelId, game)
    return { ok: true, game }
  }

  static hasActiveGame(channelId: string): boolean {
    return games.has(channelId)
  }

  static getGame(channelId: string): UndercoverGame | undefined {
    return games.get(channelId)
  }

  static setJoinMessage(channelId: string, messageId: string): void {
    const game = this.requireGame(channelId)
    game.joinMessageId = messageId
  }

  static addPlayer(channelId: string, userId: string): {
    added: boolean
    playerCount: number
    reason?: 'no_game' | 'host' | 'duplicate' | 'already_dealt'
  } {
    const game = games.get(channelId)
    if (!game) return { added: false, playerCount: 0, reason: 'no_game' }
    if (game.dealtAt) {
      return { added: false, playerCount: game.players.length, reason: 'already_dealt' }
    }
    if (game.hostId === userId) {
      return { added: false, playerCount: game.players.length, reason: 'host' }
    }
    if (game.players.some(player => player.userId === userId)) {
      return { added: false, playerCount: game.players.length, reason: 'duplicate' }
    }

    game.players.push({ userId, joinedAt: Date.now() })
    return { added: true, playerCount: game.players.length }
  }

  static removePlayer(channelId: string, userId: string): {
    removed: boolean
    playerCount: number
  } {
    const game = games.get(channelId)
    if (!game || game.dealtAt) return { removed: false, playerCount: game?.players.length ?? 0 }

    const before = game.players.length
    game.players = game.players.filter(player => player.userId !== userId)
    return { removed: before !== game.players.length, playerCount: game.players.length }
  }

  static assertHost(channelId: string, userId: string): void {
    const game = this.requireGame(channelId)
    if (game.hostId !== userId) {
      throw new Error('只有主持人可以操作本局谁是卧底。')
    }
  }

  static dealWords(channelId: string, rng: () => number = Math.random): UndercoverDealResult {
    const game = this.requireGame(channelId)
    if (game.dealtAt) {
      throw new Error('本局已经发过词了。')
    }
    if (game.players.length < UNDERCOVER_MIN_PLAYERS) {
      throw new Error(`至少需要 ${UNDERCOVER_MIN_PLAYERS} 名玩家才能发词。`)
    }

    const undercoverIndex = Math.min(
      game.players.length - 1,
      Math.floor(rng() * game.players.length),
    )
    const undercoverUserId = game.players[undercoverIndex].userId

    const result: UndercoverDealResult = {
      civilianWord: game.civilianWord,
      undercoverWord: game.undercoverWord,
      undercoverUserId,
      assignments: game.players.map(player => {
        const isUndercover = player.userId === undercoverUserId
        return {
          userId: player.userId,
          role: isUndercover ? 'undercover' : 'civilian',
          word: isUndercover ? game.undercoverWord : game.civilianWord,
        }
      }),
    }

    game.dealtAt = Date.now()
    game.deal = result
    return result
  }

  static endGame(channelId: string): boolean {
    return games.delete(channelId)
  }

  static resetAllForTest(): void {
    games.clear()
  }

  private static requireGame(channelId: string): UndercoverGame {
    const game = games.get(channelId)
    if (!game) {
      throw new Error('当前频道没有进行中的谁是卧底。')
    }
    return game
  }
}
