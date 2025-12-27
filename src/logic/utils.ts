import { getPinyin, toSimplified } from './idioms'
import type { MatchResult, ParsedChar } from './types'

// 拼音声母列表
const pinyinInitials = [
  'zh', 'ch', 'sh', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l',
  'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's', 'y', 'w',
]

// 解析拼音为声母和韵母
export function parsePinyin(pinyin: string): string[] {
  if (!pinyin) return []
  
  let rest = pinyin
  const initial = pinyinInitials.find(i => rest.startsWith(i))
  if (initial) {
    rest = rest.slice(initial.length)
  }
  
  const parts = [initial || '', rest].filter(Boolean)
  return parts
}

// 解析单个字符
export function parseChar(char: string, pinyin?: string): ParsedChar {
  if (!pinyin) {
    const pinyins = getPinyin(char)
    pinyin = pinyins[0] || ''
  }
  
  const tone = pinyin.match(/[\d]$/)?.[0] || ''
  if (tone) {
    pinyin = pinyin.slice(0, -tone.length).trim()
  }

  const parts = parsePinyin(pinyin)
  // 如果没有韵母，说明其实是零声母
  if (parts[0] && !parts[1]) {
    parts[1] = parts[0]
    parts[0] = ''
  }

  const [one, two, three] = parts

  return {
    char,
    _1: one || '',
    _2: two,
    _3: three,
    parts,
    yin: pinyin,
    tone: +tone || 0,
  }
}

// 解析整个词语
export function parseWord(word: string, answer?: string): ParsedChar[] {
  const pinyins = getPinyin(word)
  const chars = Array.from(word)
  const answerPinyin = answer ? getPinyin(answer) : undefined

  return chars.map((char, i): ParsedChar => {
    let charPinyin = pinyins[i] || ''
    // 尝试从答案中匹配拼音
    if (answerPinyin && answer && answer.includes(char)) {
      charPinyin = answerPinyin[answer.indexOf(char)] || charPinyin
    }
    return parseChar(char, charPinyin)
  })
}

// 比较答案
export function testAnswer(input: ParsedChar[], answer: ParsedChar[]): MatchResult[] {
  const unmatched = {
    char: answer
      .map((a, i) => toSimplified(input[i].char) === toSimplified(a.char) ? undefined : toSimplified(a.char))
      .filter(i => i != null) as string[],
    tone: answer
      .map((a, i) => input[i].tone === a.tone ? undefined : a.tone)
      .filter(i => i != null) as number[],
    parts: answer
      .flatMap((a, i) => a.parts.filter(p => !input[i].parts.includes(p)))
      .filter(i => i != null) as string[],
  }

  function includesAndRemove<T>(arr: T[], v: T): boolean {
    const idx = arr.indexOf(v)
    if (idx !== -1) {
      arr.splice(idx, 1)
      return true
    }
    return false
  }

  return input.map((a, i): MatchResult => {
    const char = toSimplified(a.char)
    return {
      char: answer[i].char === char || answer[i].char === a.char
        ? 'exact'
        : includesAndRemove(unmatched.char, char)
          ? 'misplaced'
          : 'none',
      tone: answer[i].tone === a.tone
        ? 'exact'
        : includesAndRemove(unmatched.tone, a.tone)
          ? 'misplaced'
          : 'none',
      _1: !a._1 || answer[i].parts.includes(a._1)
        ? 'exact'
        : includesAndRemove(unmatched.parts, a._1)
          ? 'misplaced'
          : 'none',
      _2: !a._2 || answer[i].parts.includes(a._2)
        ? 'exact'
        : includesAndRemove(unmatched.parts, a._2)
          ? 'misplaced'
          : 'none',
      _3: !a._3 || answer[i].parts.includes(a._3)
        ? 'exact'
        : includesAndRemove(unmatched.parts, a._3)
          ? 'misplaced'
          : 'none',
    }
  })
}

// 检查是否猜中
export function checkPass(result: MatchResult[]): boolean {
  return result.every(r => r.char === 'exact')
}

// 获取提示字
export function getHint(word: string): string {
  // 简单随机选一个字作为提示
  const idx = Math.floor(Math.random() * word.length)
  return word[idx]
}
