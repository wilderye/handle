export type MatchType = 'exact' | 'misplaced' | 'none'

export interface ParsedChar {
  char: string
  _1: string
  _2?: string
  _3?: string
  parts: string[]
  yin: string
  tone: number
}

export interface MatchResult {
  char: MatchType
  _1: MatchType
  _2: MatchType
  _3: MatchType
  tone: MatchType
}

export interface GameState {
  answer: string
  hint: string
  tries: string[]
  results: MatchResult[][]
  participants: Set<string>
  startTime: number
}

export interface PlayerStats {
  oddsPlayedGames: number
  wonGames: number
}

export const WORD_LENGTH = 4
export const TRIES_LIMIT = 10
