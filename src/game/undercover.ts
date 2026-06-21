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

export interface UndercoverFixedPlayer extends UndercoverPlayer {
  number: number
}

export interface UndercoverSpeechEntry {
  userId: string
  content: string
  spokenAt: number
}

export interface UndercoverSpeechRound {
  round: number
  order: string[]
  entries: UndercoverSpeechEntry[]
  completedAt: number
}

export interface UndercoverCurrentSpeech {
  round: number
  order: string[]
  currentIndex: number
  entries: UndercoverSpeechEntry[]
  messageId?: string
  startedAt: number
}

export interface UndercoverCurrentVote {
  round: number
  votes: Record<string, string>
  messageId?: string
  startedAt: number
  endsAt?: number
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
  fixedPlayers?: UndercoverFixedPlayer[]
  aliveUserIds?: string[]
  eliminatedUserIds?: string[]
  speechRounds?: UndercoverSpeechRound[]
  currentSpeech?: UndercoverCurrentSpeech
  currentVote?: UndercoverCurrentVote
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
  undercoverUserIds: string[]
  assignments: UndercoverAssignment[]
}

export interface DisplayPlayer {
  userId: string
  displayName: string
}

export interface DisplayNumberedPlayer extends DisplayPlayer {
  number: number
}

export type UndercoverCloseVoteResult =
  | {
      type: 'tie'
      tiedUserIds: string[]
      votes: Record<string, number>
    }
  | {
      type: 'eliminated'
      eliminatedUserId: string
      votes: Record<string, number>
    }

interface DealWordsOptions {
  undercoverCount?: number
  rng?: () => number
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
        fixed_players JSONB NOT NULL DEFAULT '[]'::jsonb,
        alive_user_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        eliminated_user_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        speech_rounds JSONB NOT NULL DEFAULT '[]'::jsonb,
        current_speech JSONB,
        current_vote JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `)
    await this.pool.query(`
      ALTER TABLE undercover_games
      ADD COLUMN IF NOT EXISTS fixed_players JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS alive_user_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS eliminated_user_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS speech_rounds JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS current_speech JSONB,
      ADD COLUMN IF NOT EXISTS current_vote JSONB;
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
        fixed_players,
        alive_user_ids,
        eliminated_user_ids,
        speech_rounds,
        current_speech,
        current_vote,
        created_at
      FROM undercover_games
    `)
    return res.rows.map((row: any) => {
      const players = parseStoredPlayers(row.players)
      const fixedPlayers = parseStoredFixedPlayers(row.fixed_players)
      const aliveUserIds = parseStoredStringArray(row.alive_user_ids)
      return normalizeGame({
        channelId: row.channel_id,
        hostId: row.host_id,
        joinMessageId: row.join_message_id ?? undefined,
        wordSource: row.word_source === 'random' ? 'random' : 'custom',
        civilianWord: row.civilian_word,
        undercoverWord: row.undercover_word,
        allowLying: Boolean(row.allow_lying),
        players,
        dealtAt: row.dealt_at ? new Date(row.dealt_at).getTime() : undefined,
        deal: parseStoredDeal(row.deal),
        fixedPlayers,
        aliveUserIds,
        eliminatedUserIds: parseStoredStringArray(row.eliminated_user_ids),
        speechRounds: parseStoredSpeechRounds(row.speech_rounds),
        currentSpeech: parseStoredCurrentSpeech(row.current_speech),
        currentVote: parseStoredCurrentVote(row.current_vote),
        createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
      })
    })
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
        fixed_players,
        alive_user_ids,
        eliminated_user_ids,
        speech_rounds,
        current_speech,
        current_vote,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb, $17)
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
        fixed_players = EXCLUDED.fixed_players,
        alive_user_ids = EXCLUDED.alive_user_ids,
        eliminated_user_ids = EXCLUDED.eliminated_user_ids,
        speech_rounds = EXCLUDED.speech_rounds,
        current_speech = EXCLUDED.current_speech,
        current_vote = EXCLUDED.current_vote,
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
        JSON.stringify(game.fixedPlayers ?? []),
        JSON.stringify(game.aliveUserIds ?? []),
        JSON.stringify(game.eliminatedUserIds ?? []),
        JSON.stringify(game.speechRounds ?? []),
        game.currentSpeech ? JSON.stringify(game.currentSpeech) : null,
        game.currentVote ? JSON.stringify(game.currentVote) : null,
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
    fixedPlayers: game.fixedPlayers?.map(player => ({ ...player })),
    aliveUserIds: game.aliveUserIds ? [...game.aliveUserIds] : undefined,
    eliminatedUserIds: game.eliminatedUserIds ? [...game.eliminatedUserIds] : undefined,
    speechRounds: game.speechRounds?.map(round => ({
      ...round,
      order: [...round.order],
      entries: round.entries.map(entry => ({ ...entry })),
    })),
    currentSpeech: game.currentSpeech
      ? {
          ...game.currentSpeech,
          order: [...game.currentSpeech.order],
          entries: game.currentSpeech.entries.map(entry => ({ ...entry })),
        }
      : undefined,
    currentVote: game.currentVote
      ? {
          ...game.currentVote,
          votes: { ...game.currentVote.votes },
        }
      : undefined,
    deal: game.deal
      ? {
          ...game.deal,
          undercoverUserIds: [...game.deal.undercoverUserIds],
          assignments: game.deal.assignments.map(assignment => ({ ...assignment })),
        }
      : undefined,
  }
}

function normalizeGame(game: UndercoverGame): UndercoverGame {
  const normalized = cloneGame(game)
  normalized.fixedPlayers ??= []
  normalized.aliveUserIds ??= []
  normalized.eliminatedUserIds ??= []
  normalized.speechRounds ??= []

  if (normalized.dealtAt && normalized.fixedPlayers.length === 0) {
    normalized.fixedPlayers = normalized.players.map((player, index) => ({
      ...player,
      number: index + 1,
    }))
  }

  if (normalized.dealtAt && normalized.aliveUserIds.length === 0) {
    const eliminated = new Set(normalized.eliminatedUserIds)
    normalized.aliveUserIds = normalized.fixedPlayers
      .map(player => player.userId)
      .filter(userId => !eliminated.has(userId))
  }

  return normalized
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

function parseStoredFixedPlayers(value: unknown): UndercoverFixedPlayer[] {
  const raw = parseStoredJson<unknown[]>(value, [])
  if (!Array.isArray(raw)) return []

  return raw
    .filter((player: any) => typeof player?.userId === 'string')
    .map((player: any, index) => ({
      userId: player.userId,
      joinedAt: Number(player.joinedAt) || Date.now(),
      number: Number(player.number) || index + 1,
    }))
}

function parseStoredStringArray(value: unknown): string[] {
  const raw = parseStoredJson<unknown[]>(value, [])
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is string => typeof item === 'string')
}

function parseStoredSpeechEntries(value: unknown): UndercoverSpeechEntry[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((entry: any) => typeof entry?.userId === 'string' && typeof entry.content === 'string')
    .map((entry: any) => ({
      userId: entry.userId,
      content: entry.content,
      spokenAt: Number(entry.spokenAt) || Date.now(),
    }))
}

function parseStoredSpeechRounds(value: unknown): UndercoverSpeechRound[] {
  const raw = parseStoredJson<unknown[]>(value, [])
  if (!Array.isArray(raw)) return []

  return raw
    .filter((round: any) => Array.isArray(round?.order))
    .map((round: any, index) => ({
      round: Number(round.round) || index + 1,
      order: parseStoredStringArray(round.order),
      entries: parseStoredSpeechEntries(round.entries),
      completedAt: Number(round.completedAt) || Date.now(),
    }))
}

function parseStoredCurrentSpeech(value: unknown): UndercoverCurrentSpeech | undefined {
  const raw = parseStoredJson<any>(value, null)
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.order)) return undefined

  return {
    round: Number(raw.round) || 1,
    order: parseStoredStringArray(raw.order),
    currentIndex: Number(raw.currentIndex) || 0,
    entries: parseStoredSpeechEntries(raw.entries),
    messageId: typeof raw.messageId === 'string' ? raw.messageId : undefined,
    startedAt: Number(raw.startedAt) || Date.now(),
  }
}

function parseStoredCurrentVote(value: unknown): UndercoverCurrentVote | undefined {
  const raw = parseStoredJson<any>(value, null)
  if (!raw || typeof raw !== 'object') return undefined

  const votes: Record<string, string> = {}
  if (raw.votes && typeof raw.votes === 'object') {
    for (const [voterId, targetId] of Object.entries(raw.votes)) {
      if (typeof targetId === 'string') votes[voterId] = targetId
    }
  }

  return {
    round: Number(raw.round) || 1,
    votes,
    messageId: typeof raw.messageId === 'string' ? raw.messageId : undefined,
    startedAt: Number(raw.startedAt) || Date.now(),
    endsAt: Number(raw.endsAt) || undefined,
  }
}

function parseStoredDeal(value: unknown): UndercoverDealResult | undefined {
  const raw = parseStoredJson<any>(value, null)
  if (!raw || typeof raw !== 'object') return undefined
  if (
    typeof raw.civilianWord !== 'string' ||
    typeof raw.undercoverWord !== 'string' ||
    !Array.isArray(raw.undercoverUserIds)
  ) {
    return undefined
  }

  const undercoverUserIds = raw.undercoverUserIds
    .filter((userId: unknown): userId is string => typeof userId === 'string')

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
    undercoverUserIds,
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
    return `**${index + 1}.** ${formatDiscordDisplayName(player.displayName)}`
  })
  return `**建议发言顺序：**\n${lines.join('\n')}`
}

export function formatUndercoverPlayerList(players: DisplayNumberedPlayer[]): string {
  return players
    .map(player => `**${player.number}.** ${formatDiscordDisplayName(player.displayName)}`)
    .join('\n')
}

export function formatUndercoverPlayerVoteList(
  players: DisplayNumberedPlayer[],
  votes: Record<string, string>,
): string {
  const playersByUserId = new Map(players.map(player => [player.userId, player]))

  return players
    .map(player => {
      const targetUserId = votes[player.userId]
      const target = targetUserId ? playersByUserId.get(targetUserId) : undefined
      const base = `${player.number}. ${formatDiscordDisplayName(player.displayName)}`
      return target
        ? `${base} -> ${formatDiscordDisplayName(target.displayName)}`
        : base
    })
    .join('\n')
}

export function formatUndercoverVoteOptions(players: DisplayNumberedPlayer[]): Array<{
  label: string
  value: string
}> {
  return players.map(player => ({
    label: `${player.number}. ${sanitizeDisplayName(player.displayName)}`.slice(0, 100),
    value: player.userId,
  }))
}

export function formatUndercoverVoteStatus(input: {
  candidates: DisplayNumberedPlayer[]
  votes: Record<string, string>
}): string {
  const counts = tallyVotes(input.votes)
  const lines = input.candidates
    .filter(candidate => (counts[candidate.userId] ?? 0) > 0)
    .map(candidate => `${candidate.number}. ${formatDiscordDisplayName(candidate.displayName)}：${counts[candidate.userId]} 票`)

  return lines.length > 0
    ? `**当前得票：**\n${lines.join('\n')}`
    : '**当前得票：**\n暂无投票'
}

export function getVoteReminderOffsets(totalMs: number): number[] {
  const minute = 60_000
  const candidates = [
    10 * minute,
    5 * minute,
    minute,
  ]
  return candidates.filter(offset => totalMs > offset)
}

export function shouldSendVoteEndingSoon(totalMs: number): boolean {
  return totalMs >= 60_000
}

export function shuffleSpeechOrder(
  players: DisplayPlayer[],
  rng: () => number = Math.random,
): DisplayPlayer[] {
  const shuffled = players.map(player => ({ ...player }))
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.min(index, Math.floor(rng() * (index + 1)))
    const current = shuffled[index]
    shuffled[index] = shuffled[swapIndex]
    shuffled[swapIndex] = current
  }
  return shuffled
}

export function formatBooleanRule(value: boolean): string {
  return value ? '是' : '否'
}

export function formatWordSource(source: UndercoverWordSource): string {
  return source === 'random' ? '随机发词' : '自定义发词'
}

function formatUndercoverNames(names: string[]): string {
  return names.map(formatDiscordDisplayName).join('、')
}

function tallyVotes(votes: Record<string, string>): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const targetId of Object.values(votes)) {
    counts[targetId] = (counts[targetId] ?? 0) + 1
  }
  return counts
}

export function formatHostSecret(input: {
  civilianWord: string
  undercoverWord: string
  undercoverNames: string[]
  allowLying: boolean
  failedDmNames?: string[]
}): string {
  let content =
    `## 本局词语\n\n` +
    `**平民词：**${input.civilianWord}\n` +
    `**卧底词：**${input.undercoverWord}\n` +
    `**可否撒谎：**${formatBooleanRule(input.allowLying)}\n\n` +
    `**卧底：**${formatUndercoverNames(input.undercoverNames)}`

  if (input.failedDmNames && input.failedDmNames.length > 0) {
    content += `\n\n**私信失败：**${input.failedDmNames.map(formatDiscordDisplayName).join('、')}`
  }

  return content
}

export function formatEndReveal(input: {
  civilianWord: string
  undercoverWord: string
  undercoverNames: string[]
}): string {
  return (
    `## 🏁 谁是卧底结束\n\n` +
    `**平民词：**${input.civilianWord}\n` +
    `**卧底词：**${input.undercoverWord}\n\n` +
    `**卧底：**${formatUndercoverNames(input.undercoverNames)}`
  )
}

export function formatAudiencePeek(input: {
  civilianWord: string
  undercoverWord: string
  undercoverNames: string[]
}): string {
  return (
    `## 👀 观众偷看\n\n` +
    `**平民词：**${input.civilianWord}\n` +
    `**卧底词：**${input.undercoverWord}\n\n` +
    `**卧底：**${formatUndercoverNames(input.undercoverNames)}\n\n` +
    `请不要泄露词汇和卧底身份。`
  )
}

export function formatPreparedEnd(): string {
  return (
    `## 🏁 谁是卧底结束\n\n` +
    `本局尚未正式开始，卧底尚未分配。`
  )
}

export function formatLobbyMessage(input: {
  hostName: string
  wordSource: UndercoverWordSource
  allowLying: boolean
}): string {
  return (
    `## 🎭 谁是卧底报名开始\n\n` +
    `**主持人：**${formatDiscordDisplayName(input.hostName)}\n` +
    `**词汇来源：**${formatWordSource(input.wordSource)}\n` +
    `**可否撒谎：**${formatBooleanRule(input.allowLying)}\n` +
    `请点击 ${UNDERCOVER_JOIN_EMOJI} 报名。\n` +
    `主持人使用 \`/卧底 正式开始\` 停止报名并发词。`
  )
}

export function escapeDiscordMarkdownText(text: string): string {
  return text.replace(/([\\*_~`>|])/gu, '\\$1')
}

export function formatDiscordDisplayName(name: string): string {
  return escapeDiscordMarkdownText(sanitizeDisplayName(name))
}

function sanitizeDisplayName(name: string): string {
  const trimmed = name.replace(/\s+/gu, ' ').trim()
  return trimmed || '未知玩家'
}

function getAliveUserIds(game: UndercoverGame): string[] {
  if (game.aliveUserIds && game.aliveUserIds.length > 0) return [...game.aliveUserIds]
  if (game.fixedPlayers && game.fixedPlayers.length > 0) {
    const eliminated = new Set(game.eliminatedUserIds ?? [])
    return game.fixedPlayers
      .map(player => player.userId)
      .filter(userId => !eliminated.has(userId))
  }
  return game.players.map(player => player.userId)
}

function shuffleUserIds(
  userIds: string[],
  rng: () => number = Math.random,
): string[] {
  const shuffled = [...userIds]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.min(index, Math.floor(rng() * (index + 1)))
    const current = shuffled[index]
    shuffled[index] = shuffled[swapIndex]
    shuffled[swapIndex] = current
  }
  return shuffled
}

function cloneSpeechRound(round: UndercoverSpeechRound): UndercoverSpeechRound {
  return {
    ...round,
    order: [...round.order],
    entries: round.entries.map(entry => ({ ...entry })),
  }
}

function cloneCurrentSpeech(speech: UndercoverCurrentSpeech): UndercoverCurrentSpeech {
  return {
    ...speech,
    order: [...speech.order],
    entries: speech.entries.map(entry => ({ ...entry })),
  }
}

function cloneCurrentVote(vote: UndercoverCurrentVote): UndercoverCurrentVote {
  return {
    ...vote,
    votes: { ...vote.votes },
  }
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
        fixedPlayers: [],
        aliveUserIds: [],
        eliminatedUserIds: [],
        speechRounds: [],
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
    const game = games.get(channelId)
    return game ? normalizeGame(game) : undefined
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

  static async dealWords(
    channelId: string,
    options: DealWordsOptions | (() => number) = {},
  ): Promise<UndercoverDealResult> {
    const normalizedOptions: DealWordsOptions = typeof options === 'function'
      ? { rng: options }
      : options
    const rng = normalizedOptions.rng ?? Math.random
    const undercoverCount = normalizedOptions.undercoverCount ?? 1

    return withChannelWrite(channelId, async () => {
      const game = this.requireGame(channelId)
      if (game.dealtAt) {
        throw new Error('本局已经发过词了。')
      }
      if (game.players.length < UNDERCOVER_MIN_PLAYERS) {
        throw new Error(`至少需要 ${UNDERCOVER_MIN_PLAYERS} 名玩家才能发词。`)
      }
      if (!Number.isInteger(undercoverCount) || undercoverCount < 1) {
        throw new Error('卧底数量至少为 1。')
      }
      if (undercoverCount >= game.players.length) {
        throw new Error(`卧底数量必须小于参与者数量。当前玩家数：${game.players.length}`)
      }

      const availableUserIds = game.players.map(player => player.userId)
      const undercoverUserIds: string[] = []
      for (let count = 0; count < undercoverCount; count += 1) {
        const undercoverIndex = Math.min(
          availableUserIds.length - 1,
          Math.floor(rng() * availableUserIds.length),
        )
        const [undercoverUserId] = availableUserIds.splice(undercoverIndex, 1)
        undercoverUserIds.push(undercoverUserId)
      }
      const undercoverUserIdSet = new Set(undercoverUserIds)

      const result: UndercoverDealResult = {
        civilianWord: game.civilianWord,
        undercoverWord: game.undercoverWord,
        undercoverUserIds,
        assignments: game.players.map(player => {
          const isUndercover = undercoverUserIdSet.has(player.userId)
          return {
            userId: player.userId,
            role: isUndercover ? 'undercover' : 'civilian',
            word: isUndercover ? game.undercoverWord : game.civilianWord,
          }
        }),
      }

      const previousDealtAt = game.dealtAt
      const previousDeal = game.deal
      const previousFixedPlayers = game.fixedPlayers?.map(player => ({ ...player }))
      const previousAliveUserIds = game.aliveUserIds ? [...game.aliveUserIds] : undefined
      const previousEliminatedUserIds = game.eliminatedUserIds ? [...game.eliminatedUserIds] : undefined
      game.dealtAt = Date.now()
      game.deal = result
      const fixedOrder = shuffleUserIds(game.players.map(player => player.userId), rng)
      const playerById = new Map(game.players.map(player => [player.userId, player]))
      game.fixedPlayers = fixedOrder.map((userId, index) => ({
        ...playerById.get(userId)!,
        userId,
        joinedAt: playerById.get(userId)?.joinedAt ?? Date.now(),
        number: index + 1,
      }))
      game.aliveUserIds = game.fixedPlayers.map(player => player.userId)
      game.eliminatedUserIds = []
      try {
        await store.saveGame(game)
      } catch (error) {
        game.dealtAt = previousDealtAt
        game.deal = previousDeal
        game.fixedPlayers = previousFixedPlayers
        game.aliveUserIds = previousAliveUserIds
        game.eliminatedUserIds = previousEliminatedUserIds
        throw error
      }
      return result
    })
  }

  static async startSpeechRound(
    channelId: string,
    rng: () => number = Math.random,
  ): Promise<{
    ok: boolean
    speech?: UndercoverCurrentSpeech
    error?: string
  }> {
    void rng
    return withChannelWrite(channelId, async () => {
      const game = normalizeGame(this.requireGame(channelId))
      if (!game.dealtAt) return { ok: false, error: '本局尚未正式开始。' }
      if (game.currentSpeech) return { ok: false, error: '当前已有进行中的发言轮。' }

      const aliveUserIds = getAliveUserIds(game)
      if (aliveUserIds.length === 0) return { ok: false, error: '当前没有存活玩家。' }

      const speech: UndercoverCurrentSpeech = {
        round: (game.speechRounds?.length ?? 0) + 1,
        order: aliveUserIds,
        currentIndex: 0,
        entries: [],
        startedAt: Date.now(),
      }

      const previous = game.currentSpeech
      game.currentSpeech = speech
      games.set(channelId, game)
      try {
        await store.saveGame(game)
      } catch (error) {
        game.currentSpeech = previous
        games.set(channelId, game)
        throw error
      }

      return { ok: true, speech: cloneCurrentSpeech(speech) }
    })
  }

  static async setSpeechMessage(channelId: string, messageId: string): Promise<void> {
    await withChannelWrite(channelId, async () => {
      const game = normalizeGame(this.requireGame(channelId))
      if (!game.currentSpeech) return
      const previous = game.currentSpeech.messageId
      game.currentSpeech.messageId = messageId
      games.set(channelId, game)
      try {
        await store.saveGame(game)
      } catch (error) {
        game.currentSpeech.messageId = previous
        games.set(channelId, game)
        throw error
      }
    })
  }

  static async submitSpeech(
    channelId: string,
    userId: string,
    content: string,
  ): Promise<{
    ok: boolean
    completed?: boolean
    round?: number
    currentUserId?: string
    error?: string
  }> {
    return withChannelWrite(channelId, async () => {
      const game = normalizeGame(this.requireGame(channelId))
      const speech = game.currentSpeech
      if (!speech) return { ok: false, error: '当前没有进行中的发言轮。' }
      const currentUserId = speech.order[speech.currentIndex]
      if (currentUserId !== userId) return { ok: false, error: '还没有轮到你发言。' }

      const trimmedContent = content.trim()
      if (!trimmedContent) return { ok: false, error: '发言内容不能为空。' }

      const previousSpeech = cloneCurrentSpeech(speech)
      const previousRounds = game.speechRounds?.map(cloneSpeechRound) ?? []
      speech.entries.push({
        userId,
        content: trimmedContent,
        spokenAt: Date.now(),
      })
      speech.currentIndex += 1

      let result: {
        ok: boolean
        completed: boolean
        round: number
        currentUserId?: string
      }

      if (speech.currentIndex >= speech.order.length) {
        const round: UndercoverSpeechRound = {
          round: speech.round,
          order: [...speech.order],
          entries: speech.entries.map(entry => ({ ...entry })),
          completedAt: Date.now(),
        }
        game.speechRounds = [...previousRounds, round]
        game.currentSpeech = undefined
        result = { ok: true, completed: true, round: round.round }
      } else {
        game.currentSpeech = speech
        result = {
          ok: true,
          completed: false,
          round: speech.round,
          currentUserId: speech.order[speech.currentIndex],
        }
      }

      games.set(channelId, game)
      try {
        await store.saveGame(game)
      } catch (error) {
        game.currentSpeech = previousSpeech
        game.speechRounds = previousRounds
        games.set(channelId, game)
        throw error
      }

      return result
    })
  }

  static async skipCurrentSpeech(
    channelId: string,
    hostId: string,
  ): Promise<{
    ok: boolean
    completed?: boolean
    round?: number
    skippedUserId?: string
    currentUserId?: string
    error?: string
  }> {
    return withChannelWrite(channelId, async () => {
      const game = normalizeGame(this.requireGame(channelId))
      if (game.hostId !== hostId) {
        return { ok: false, error: '只有本局主持人可以跳过发言。' }
      }

      const speech = game.currentSpeech
      if (!speech) return { ok: false, error: '当前没有进行中的发言轮。' }

      const skippedUserId = speech.order[speech.currentIndex]
      if (!skippedUserId) return { ok: false, error: '当前没有可跳过的发言玩家。' }

      const previousSpeech = cloneCurrentSpeech(speech)
      const previousRounds = game.speechRounds?.map(cloneSpeechRound) ?? []
      speech.currentIndex += 1

      let result: {
        ok: boolean
        completed: boolean
        round: number
        skippedUserId: string
        currentUserId?: string
      }

      if (speech.currentIndex >= speech.order.length) {
        const round: UndercoverSpeechRound = {
          round: speech.round,
          order: [...speech.order],
          entries: speech.entries.map(entry => ({ ...entry })),
          completedAt: Date.now(),
        }
        game.speechRounds = [...previousRounds, round]
        game.currentSpeech = undefined
        result = { ok: true, completed: true, round: round.round, skippedUserId }
      } else {
        game.currentSpeech = speech
        result = {
          ok: true,
          completed: false,
          round: speech.round,
          skippedUserId,
          currentUserId: speech.order[speech.currentIndex],
        }
      }

      games.set(channelId, game)
      try {
        await store.saveGame(game)
      } catch (error) {
        game.currentSpeech = previousSpeech
        game.speechRounds = previousRounds
        games.set(channelId, game)
        throw error
      }

      return result
    })
  }

  static async startVote(
    channelId: string,
    discussionMinutes?: number | null,
  ): Promise<{
    ok: boolean
    vote?: UndercoverCurrentVote
    error?: string
  }> {
    return withChannelWrite(channelId, async () => {
      const game = normalizeGame(this.requireGame(channelId))
      if (!game.dealtAt) return { ok: false, error: '本局尚未正式开始。' }
      if (game.currentVote) return { ok: false, error: '当前已有进行中的投票。' }

      const aliveUserIds = getAliveUserIds(game)
      if (aliveUserIds.length === 0) return { ok: false, error: '当前没有存活玩家。' }

      const safeMinutes = discussionMinutes && discussionMinutes > 0 ? discussionMinutes : undefined
      const vote: UndercoverCurrentVote = {
        round: (game.speechRounds?.length ?? 0) + 1,
        votes: {},
        startedAt: Date.now(),
        endsAt: safeMinutes ? Date.now() + safeMinutes * 60_000 : undefined,
      }

      game.currentVote = vote
      games.set(channelId, game)
      try {
        await store.saveGame(game)
      } catch (error) {
        game.currentVote = undefined
        games.set(channelId, game)
        throw error
      }

      return { ok: true, vote: cloneCurrentVote(vote) }
    })
  }

  static async setVoteMessage(channelId: string, messageId: string): Promise<string | undefined> {
    return withChannelWrite(channelId, async () => {
      const game = normalizeGame(this.requireGame(channelId))
      if (!game.currentVote) return undefined
      const previous = game.currentVote.messageId
      game.currentVote.messageId = messageId
      games.set(channelId, game)
      try {
        await store.saveGame(game)
      } catch (error) {
        game.currentVote.messageId = previous
        games.set(channelId, game)
        throw error
      }
      return previous
    })
  }

  static async castVote(
    channelId: string,
    voterId: string,
    targetUserId: string,
  ): Promise<{
    ok: boolean
    error?: string
  }> {
    return withChannelWrite(channelId, async () => {
      const game = normalizeGame(this.requireGame(channelId))
      if (!game.currentVote) return { ok: false, error: '当前没有进行中的投票。' }
      const aliveUserIds = getAliveUserIds(game)
      if (!aliveUserIds.includes(voterId)) return { ok: false, error: '只有当前存活玩家可以投票。' }
      if (!aliveUserIds.includes(targetUserId)) return { ok: false, error: '只能投给当前存活玩家。' }

      const previousVote = cloneCurrentVote(game.currentVote)
      game.currentVote.votes[voterId] = targetUserId
      games.set(channelId, game)
      try {
        await store.saveGame(game)
      } catch (error) {
        game.currentVote = previousVote
        games.set(channelId, game)
        throw error
      }

      return { ok: true }
    })
  }

  static async closeVote(channelId: string): Promise<{
    ok: boolean
    result?: UndercoverCloseVoteResult
    error?: string
  }> {
    return withChannelWrite(channelId, async () => {
      const game = normalizeGame(this.requireGame(channelId))
      const vote = game.currentVote
      if (!vote) return { ok: false, error: '当前没有进行中的投票。' }

      const previousVote = cloneCurrentVote(vote)
      const previousAliveUserIds = [...getAliveUserIds(game)]
      const previousEliminatedUserIds = [...(game.eliminatedUserIds ?? [])]
      const counts = tallyVotes(vote.votes)
      const maxVotes = Math.max(0, ...Object.values(counts))
      const topUserIds = getAliveUserIds(game)
        .filter(userId => (counts[userId] ?? 0) === maxVotes)

      let result: UndercoverCloseVoteResult
      if (maxVotes === 0 || topUserIds.length !== 1) {
        result = {
          type: 'tie',
          tiedUserIds: topUserIds,
          votes: counts,
        }
      } else {
        const eliminatedUserId = topUserIds[0]
        game.aliveUserIds = previousAliveUserIds.filter(userId => userId !== eliminatedUserId)
        game.eliminatedUserIds = [...previousEliminatedUserIds, eliminatedUserId]
        result = {
          type: 'eliminated',
          eliminatedUserId,
          votes: counts,
        }
      }

      game.currentVote = undefined
      games.set(channelId, game)
      try {
        await store.saveGame(game)
      } catch (error) {
        game.currentVote = previousVote
        game.aliveUserIds = previousAliveUserIds
        game.eliminatedUserIds = previousEliminatedUserIds
        games.set(channelId, game)
        throw error
      }

      return { ok: true, result }
    })
  }

  static async endGame(channelId: string): Promise<boolean> {
    return withChannelWrite(channelId, async () => {
      if (!games.has(channelId)) return false
      await store.deleteGame(channelId)
      return games.delete(channelId)
    })
  }

  static getActiveGames(): UndercoverGame[] {
    return Array.from(games.values()).map(game => normalizeGame(game))
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
