import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import pkg from 'pg'
import { fileURLToPath } from 'url'

const { Pool } = pkg
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

interface UndercoverStore {
  loadGames(): Promise<UndercoverGame[]>
  saveGame(game: UndercoverGame): Promise<void>
  deleteGame(channelId: string): Promise<void>
}

class MemoryUndercoverStore implements UndercoverStore {
  private storedGames = new Map<string, UndercoverGame>()

  async loadGames(): Promise<UndercoverGame[]> {
    return Array.from(this.storedGames.values()).map(cloneGame)
  }

  async saveGame(game: UndercoverGame): Promise<void> {
    this.storedGames.set(game.channelId, cloneGame(game))
  }

  async deleteGame(channelId: string): Promise<void> {
    this.storedGames.delete(channelId)
  }
}

class PGUndercoverStore implements UndercoverStore {
  private pool: any

  constructor(connectionString: string) {
    const cleanUrl = connectionString.replace('?sslmode=require', '')
    this.pool = new Pool({
      connectionString: cleanUrl,
      ssl: {
        rejectUnauthorized: false,
      },
    })
  }

  async init(): Promise<void> {
    await this.pool.query('SELECT 1')
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS undercover_games (
        channel_id VARCHAR(50) PRIMARY KEY,
        host_id VARCHAR(50) NOT NULL,
        join_message_id VARCHAR(50),
        word_source VARCHAR(20) NOT NULL,
        civilian_word TEXT NOT NULL,
        undercover_word TEXT NOT NULL,
        allow_lying BOOLEAN NOT NULL DEFAULT FALSE,
        players JSONB NOT NULL DEFAULT '[]'::jsonb,
        dealt_at TIMESTAMP,
        deal JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `)
  }

  async loadGames(): Promise<UndercoverGame[]> {
    const res = await this.pool.query(`
      SELECT
        channel_id,
        host_id,
        join_message_id,
        word_source,
        civilian_word,
        undercover_word,
        allow_lying,
        players,
        dealt_at,
        deal,
        created_at
      FROM undercover_games
    `)
    return res.rows.map((row: any) => ({
      channelId: row.channel_id,
      hostId: row.host_id,
      joinMessageId: row.join_message_id ?? undefined,
      wordSource: row.word_source === 'random' ? 'random' : 'custom',
      civilianWord: row.civilian_word,
      undercoverWord: row.undercover_word,
      allowLying: Boolean(row.allow_lying),
      players: parseStoredPlayers(row.players),
      dealtAt: row.dealt_at ? new Date(row.dealt_at).getTime() : undefined,
      deal: parseStoredDeal(row.deal),
      createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    }))
  }

  async saveGame(game: UndercoverGame): Promise<void> {
    await this.pool.query(
      `INSERT INTO undercover_games (
        channel_id,
        host_id,
        join_message_id,
        word_source,
        civilian_word,
        undercover_word,
        allow_lying,
        players,
        dealt_at,
        deal,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10::jsonb, $11)
      ON CONFLICT (channel_id) DO UPDATE SET
        host_id = EXCLUDED.host_id,
        join_message_id = EXCLUDED.join_message_id,
        word_source = EXCLUDED.word_source,
        civilian_word = EXCLUDED.civilian_word,
        undercover_word = EXCLUDED.undercover_word,
        allow_lying = EXCLUDED.allow_lying,
        players = EXCLUDED.players,
        dealt_at = EXCLUDED.dealt_at,
        deal = EXCLUDED.deal,
        created_at = EXCLUDED.created_at`,
      [
        game.channelId,
        game.hostId,
        game.joinMessageId ?? null,
        game.wordSource,
        game.civilianWord,
        game.undercoverWord,
        game.allowLying,
        JSON.stringify(game.players),
        game.dealtAt ? new Date(game.dealtAt) : null,
        game.deal ? JSON.stringify(game.deal) : null,
        new Date(game.createdAt),
      ],
    )
  }

  async deleteGame(channelId: string): Promise<void> {
    await this.pool.query('DELETE FROM undercover_games WHERE channel_id = $1', [channelId])
  }
}

const games = new Map<string, UndercoverGame>()
const channelWriteQueues = new Map<string, Promise<unknown>>()
let store: UndercoverStore = new MemoryUndercoverStore()
let isPostgresStore = false

export async function initUndercoverDB(): Promise<void> {
  channelWriteQueues.clear()
  const dbUrl = process.env.DATABASE_URL
  if (dbUrl) {
    try {
      console.log('🔄 正在尝试连接 PostgreSQL 谁是卧底数据库...')
      const pgStore = new PGUndercoverStore(dbUrl)
      await pgStore.init()
      store = pgStore
      isPostgresStore = true
      await reloadGamesFromStore()
      console.log('✅ PostgreSQL 谁是卧底数据库初始化成功！')
      console.log(`📋 已加载 ${games.size} 个活跃谁是卧底频道到缓存`)
      return
    } catch (error: any) {
      console.warn('⚠️ 谁是卧底数据库初始化失败，将降级至内存存储模式：', error.message)
    }
  } else {
    console.log('ℹ️ 未检测到 DATABASE_URL，谁是卧底已使用内存存储模式')
  }

  store = new MemoryUndercoverStore()
  isPostgresStore = false
  games.clear()
}

export function isUsingUndercoverPostgres(): boolean {
  return isPostgresStore
}

async function reloadGamesFromStore(): Promise<void> {
  games.clear()
  for (const game of await store.loadGames()) {
    games.set(game.channelId, cloneGame(game))
  }
}

async function withChannelWrite<T>(
  channelId: string,
  action: () => Promise<T>,
): Promise<T> {
  const previous = channelWriteQueues.get(channelId) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(action)
  channelWriteQueues.set(channelId, next)

  try {
    return await next
  } finally {
    if (channelWriteQueues.get(channelId) === next) {
      channelWriteQueues.delete(channelId)
    }
  }
}

function cloneGame(game: UndercoverGame): UndercoverGame {
  return {
    ...game,
    players: game.players.map(player => ({ ...player })),
    deal: game.deal
      ? {
          ...game.deal,
          assignments: game.deal.assignments.map(assignment => ({ ...assignment })),
        }
      : undefined,
  }
}

function parseStoredJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return fallback
    }
  }
  return value as T
}

function parseStoredPlayers(value: unknown): UndercoverPlayer[] {
  const raw = parseStoredJson<unknown[]>(value, [])
  if (!Array.isArray(raw)) return []

  return raw
    .filter((player: any) => typeof player?.userId === 'string')
    .map((player: any) => ({
      userId: player.userId,
      joinedAt: Number(player.joinedAt) || Date.now(),
    }))
}

function parseStoredDeal(value: unknown): UndercoverDealResult | undefined {
  const raw = parseStoredJson<any>(value, null)
  if (!raw || typeof raw !== 'object') return undefined
  if (
    typeof raw.civilianWord !== 'string' ||
    typeof raw.undercoverWord !== 'string' ||
    typeof raw.undercoverUserId !== 'string'
  ) {
    return undefined
  }

  const assignments = Array.isArray(raw.assignments)
    ? raw.assignments
        .filter((assignment: any) => (
          typeof assignment?.userId === 'string' &&
          (assignment.role === 'civilian' || assignment.role === 'undercover') &&
          typeof assignment.word === 'string'
        ))
        .map((assignment: any) => ({
          userId: assignment.userId,
          role: assignment.role,
          word: assignment.word,
        }))
    : []

  return {
    civilianWord: raw.civilianWord,
    undercoverWord: raw.undercoverWord,
    undercoverUserId: raw.undercoverUserId,
    assignments,
  }
}

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
  static async startGame(
    channelId: string,
    hostId: string,
    input: {
      wordSource: UndercoverWordSource
      civilianWord: string
      undercoverWord: string
      allowLying: boolean
    },
  ): Promise<{
    ok: boolean
    game?: UndercoverGame
    error?: string
  }> {
    return withChannelWrite(channelId, async () => {
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
      try {
        await store.saveGame(game)
      } catch (error) {
        games.delete(channelId)
        throw error
      }
      return { ok: true, game }
    })
  }

  static hasActiveGame(channelId: string): boolean {
    return games.has(channelId)
  }

  static getGame(channelId: string): UndercoverGame | undefined {
    return games.get(channelId)
  }

  static async setJoinMessage(channelId: string, messageId: string): Promise<void> {
    await withChannelWrite(channelId, async () => {
      const game = this.requireGame(channelId)
      const previousMessageId = game.joinMessageId
      game.joinMessageId = messageId
      try {
        await store.saveGame(game)
      } catch (error) {
        game.joinMessageId = previousMessageId
        throw error
      }
    })
  }

  static async addPlayer(channelId: string, userId: string): Promise<{
    added: boolean
    playerCount: number
    reason?: 'no_game' | 'host' | 'duplicate' | 'already_dealt'
  }> {
    return withChannelWrite(channelId, async () => {
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

      const previousPlayers = game.players.map(player => ({ ...player }))
      game.players.push({ userId, joinedAt: Date.now() })
      try {
        await store.saveGame(game)
      } catch (error) {
        game.players = previousPlayers
        throw error
      }
      return { added: true, playerCount: game.players.length }
    })
  }

  static async removePlayer(channelId: string, userId: string): Promise<{
    removed: boolean
    playerCount: number
  }> {
    return withChannelWrite(channelId, async () => {
      const game = games.get(channelId)
      if (!game || game.dealtAt) return { removed: false, playerCount: game?.players.length ?? 0 }

      const previousPlayers = game.players.map(player => ({ ...player }))
      const before = game.players.length
      game.players = game.players.filter(player => player.userId !== userId)
      if (before === game.players.length) {
        return { removed: false, playerCount: game.players.length }
      }
      try {
        await store.saveGame(game)
      } catch (error) {
        game.players = previousPlayers
        throw error
      }
      return { removed: true, playerCount: game.players.length }
    })
  }

  static assertHost(channelId: string, userId: string): void {
    const game = this.requireGame(channelId)
    if (game.hostId !== userId) {
      throw new Error('只有主持人可以操作本局谁是卧底。')
    }
  }

  static async dealWords(channelId: string, rng: () => number = Math.random): Promise<UndercoverDealResult> {
    return withChannelWrite(channelId, async () => {
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

      const previousDealtAt = game.dealtAt
      const previousDeal = game.deal
      game.dealtAt = Date.now()
      game.deal = result
      try {
        await store.saveGame(game)
      } catch (error) {
        game.dealtAt = previousDealtAt
        game.deal = previousDeal
        throw error
      }
      return result
    })
  }

  static async endGame(channelId: string): Promise<boolean> {
    return withChannelWrite(channelId, async () => {
      if (!games.has(channelId)) return false
      await store.deleteGame(channelId)
      return games.delete(channelId)
    })
  }

  static async resetAllForTest(): Promise<void> {
    store = new MemoryUndercoverStore()
    isPostgresStore = false
    channelWriteQueues.clear()
    games.clear()
  }

  static clearCacheForTest(): void {
    games.clear()
  }

  static async reloadFromStoreForTest(): Promise<void> {
    await reloadGamesFromStore()
  }

  private static requireGame(channelId: string): UndercoverGame {
    const game = games.get(channelId)
    if (!game) {
      throw new Error('当前频道没有进行中的谁是卧底。')
    }
    return game
  }
}
