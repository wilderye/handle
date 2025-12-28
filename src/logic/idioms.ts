import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import pinyin from 'pinyin'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 加载成语列表（抽题用，只包含常见成语）
const idiomsPath = join(__dirname, '../../src/data/idioms.txt')
const idiomsRaw = readFileSync(idiomsPath, 'utf-8')
export const IdiomsList = idiomsRaw.split('\n').map(i => i.trim()).filter(Boolean)

// 加载完整成语列表（输入验证用，包含更多成语）
const idiomsFullPath = join(__dirname, '../../src/data/idioms.txt.bak')
const idiomsFullRaw = readFileSync(idiomsFullPath, 'utf-8')
export const IdiomsListFull = idiomsFullRaw.split('\n').map(i => i.trim()).filter(Boolean)

// 加载多音字数据
const polyphonesPath = join(__dirname, '../../src/data/polyphones.json')
const polyphonesRaw = readFileSync(polyphonesPath, 'utf-8')
export const Polyphones: Record<string, string> = JSON.parse(polyphonesRaw)

// 简繁转换表（简化版，只包含常用字）
const simplifiedMap: Record<string, string> = {
  國: '国',
  語: '语',
  說: '说',
  話: '话',
  開: '开',
  門: '门',
  問: '问',
  間: '间',
  關: '关',
  東: '东',
  車: '车',
  書: '书',
  學: '学',
  見: '见',
  親: '亲',
  長: '长',
  馬: '马',
  鳥: '鸟',
  魚: '鱼',
  龍: '龙',
}

export function toSimplified(text: string): string {
  return Array.from(text).map(c => simplifiedMap[c] || c).join('')
}

// 获取成语信息（使用完整列表验证输入）
export function getIdiom(word: string): [string, string | undefined] | undefined {
  const simplified = toSimplified(word)
  if (Polyphones[word])
    return [word, Polyphones[word]]
  if (Polyphones[simplified])
    return [word, Polyphones[simplified]]
  if (IdiomsListFull.includes(word))
    return [word, undefined]
  if (IdiomsListFull.includes(simplified))
    return [simplified, undefined]
  return undefined
}

// 获取拼音
export function getPinyin(word: string): string[] {
  const data = getIdiom(word)
  if (data?.[1]) {
    // 使用多音字数据
    return data[1].split(/\s+/g).map(p =>
      p.replace(/^(y|j|q|x)u([a-z]*[0-9]?)$/g, '$1v$2'),
    )
  }
  // 使用 pinyin 库获取拼音

  const pinyinFn = (pinyin as any).default || pinyin
  const result = pinyinFn(toSimplified(word), {
    style: 'TONE2', // v3 使用字符串而非常量
    heteronym: false,
  })
  return result.map((p: string[]) =>
    (p[0] || '').replace(/^(y|j|q|x)u([a-z]*[0-9]?)$/g, '$1v$2'),
  )
}

// 验证是否为有效成语
export function checkValidIdiom(word: string): boolean {
  return !!getIdiom(word)
}

// 过滤非中文字符
export function filterNonChineseChars(input: string): string {
  return Array.from(input)
    .filter(i => /\p{Script=Han}/u.test(i))
    .slice(0, 4)
    .join('')
}
