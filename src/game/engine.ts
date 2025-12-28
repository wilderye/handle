import { IdiomsList, checkValidIdiom, filterNonChineseChars } from '../logic/idioms.js'
import type { GameState, MatchResult, ParsedChar, PlayerStats } from '../logic/types.js'
import { TRIES_LIMIT, WORD_LENGTH } from '../logic/types.js'
import { checkPass, getHint, parseWord, testAnswer } from '../logic/utils.js'

// 游戏状态存储（频道ID -> 游戏状态）
const games = new Map<string, GameState>()

// 玩家统计存储（用户ID -> 统计数据）
const playerStats = new Map<string, PlayerStats>()

export class GameEngine {
  /**
   * 开始新游戏
   */
  static startGame(channelId: string): { word: string; hint: string } {
    // 随机选择一个成语
    const idx = Math.floor(Math.random() * IdiomsList.length)
    const word = IdiomsList[idx]
    const hint = getHint(word)

    const state: GameState = {
      answer: word,
      hint,
      tries: [],
      results: [],
      participants: new Set(),
      startTime: Date.now(),
    }

    games.set(channelId, state)
    return { word, hint }
  }

  /**
   * 检查是否有进行中的游戏
   */
  static hasActiveGame(channelId: string): boolean {
    return games.has(channelId)
  }

  /**
   * 获取当前游戏状态
   */
  static getGame(channelId: string): GameState | undefined {
    return games.get(channelId)
  }

  /**
   * 验证输入是否为有效成语
   */
  static validateInput(input: string): { valid: boolean; filtered: string; error?: string } {
    const filtered = filterNonChineseChars(input)
    
    if (filtered.length !== WORD_LENGTH) {
      return { valid: false, filtered, error: `请输入${WORD_LENGTH}个汉字` }
    }
    
    if (!checkValidIdiom(filtered)) {
      return { valid: false, filtered, error: '不是有效的成语' }
    }
    
    return { valid: true, filtered }
  }

  /**
   * 处理猜测
   */
  static processGuess(
    channelId: string,
    userId: string,
    input: string
  ): {
    success: boolean
    result?: MatchResult[]
    isWin?: boolean
    isFail?: boolean
    triesLeft?: number
    error?: string
  } {
    const game = games.get(channelId)
    if (!game) {
      return { success: false, error: '没有进行中的游戏' }
    }

    // 验证输入
    const validation = this.validateInput(input)
    if (!validation.valid) {
      return { success: false, error: validation.error }
    }

    const filtered = validation.filtered

    // 记录参与者
    game.participants.add(userId)

    // 解析并比较
    const inputParsed = parseWord(filtered, game.answer)
    const answerParsed = parseWord(game.answer)
    const result = testAnswer(inputParsed, answerParsed)

    // 记录猜测
    game.tries.push(filtered)
    game.results.push(result)

    const isWin = checkPass(result)
    const isFail = !isWin && game.tries.length >= TRIES_LIMIT
    const triesLeft = TRIES_LIMIT - game.tries.length

    return {
      success: true,
      result,
      isWin,
      isFail,
      triesLeft,
    }
  }

  /**
   * 获取提示
   */
  static getHint(channelId: string): string | undefined {
    const game = games.get(channelId)
    return game?.hint
  }

  /**
   * 结束游戏
   */
  static endGame(channelId: string, winnerId?: string): {
    answer: string
    participants: string[]
  } | undefined {
    const game = games.get(channelId)
    if (!game) return undefined

    const answer = game.answer
    const participants = Array.from(game.participants)

    // 更新玩家统计
    for (const oddsPlayedGamesId of participants) {
      const stats = playerStats.get(oddsPlayedGamesId) || { oddsPlayedGames: 0, wonGames: 0 }
      stats.oddsPlayedGames++
      if (oddsPlayedGamesId === winnerId) {
        stats.wonGames++
      }
      playerStats.set(oddsPlayedGamesId, stats)
    }

    // 清除游戏状态
    games.delete(channelId)

    return { answer, participants }
  }

  /**
   * 获取玩家统计
   */
  static getPlayerStats(userId: string): {
    oddsPlayedGames: number
    wonGames: number
    winRate: string
  } {
    const stats = playerStats.get(userId) || { oddsPlayedGames: 0, wonGames: 0 }
    const winRate = stats.oddsPlayedGames > 0
      ? ((stats.wonGames / stats.oddsPlayedGames) * 100).toFixed(1) + '%'
      : '0%'
    
    return {
      oddsPlayedGames: stats.oddsPlayedGames,
      wonGames: stats.wonGames,
      winRate,
    }
  }

  /**
   * 获取游戏面板数据（用于截图）
   */
  static getGameBoardData(channelId: string): {
    tries: string[]
    results: MatchResult[][]
    parsed: ParsedChar[][]
  } | undefined {
    const game = games.get(channelId)
    if (!game) return undefined

    // 为每个猜测生成解析数据
    const parsed = game.tries.map(word => parseWord(word, game.answer))

    return {
      tries: game.tries,
      results: game.results,
      parsed,
    }
  }

  /**
   * 获取声母/韵母状态（用于速查表）
   */
  static getSymbolStates(channelId: string): {
    initials: Record<string, 'exact' | 'misplaced' | 'none'>
    finals: Record<string, 'exact' | 'misplaced' | 'none'>
  } {
    const game = games.get(channelId)
    const initials: Record<string, 'exact' | 'misplaced' | 'none'> = {}
    const finals: Record<string, 'exact' | 'misplaced' | 'none'> = {}

    if (!game) return { initials, finals }

    // 遍历所有猜测结果，汇总每个符号的状态
    game.tries.forEach((word, tryIndex) => {
      const parsed = parseWord(word, game.answer)
      const results = game.results[tryIndex]

      parsed.forEach((char, charIndex) => {
        const result = results[charIndex]

        // 声母状态
        if (char._1) {
          const current = initials[char._1]
          const newState = result._1
          initials[char._1] = this.mergeState(current, newState)
        }

        // 韵母状态
        if (char._2) {
          const current = finals[char._2]
          const newState = result._2
          finals[char._2] = this.mergeState(current, newState)
        }
      })
    })

    return { initials, finals }
  }

  /**
   * 合并状态（exact > misplaced > none）
   */
  private static mergeState(
    current: 'exact' | 'misplaced' | 'none' | undefined,
    newState: 'exact' | 'misplaced' | 'none'
  ): 'exact' | 'misplaced' | 'none' {
    if (current === 'exact' || newState === 'exact') return 'exact'
    if (current === 'misplaced' || newState === 'misplaced') return 'misplaced'
    return 'none'
  }
}
