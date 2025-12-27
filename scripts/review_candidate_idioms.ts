
import { readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const candidatePath = join(__dirname, '../src/data/common_idioms_candidate.txt')
const commonCharsPath = join(__dirname, '../src/data/common_chars.txt')
const reviewPath = join(__dirname, '../src/data/candidate_review_results.md')

// Load idioms
const idiomsRaw = readFileSync(candidatePath, 'utf-8')
const idioms = idiomsRaw.split('\n').map(i => i.trim()).filter(Boolean)

// Load common characters
const commonCharsRaw = readFileSync(commonCharsPath, 'utf-8')
const commonCharsList = commonCharsRaw.split('\n').map(c => c.trim()).filter(Boolean)
const charRank = new Map<string, number>()
commonCharsList.forEach((char, index) => {
  charRank.set(char, index)
})

// Specific words that often indicate non-idioms or very colloquial phrases
const suspiciousWords = new Set([
  '什么', '意思', '大学', '可乐', '主义', '民国', '公元', '世纪', '世界', '社会', '科学', '技术', '干部', '群众', '先生', '小姐', '太太', '同志', '朋友', '兄弟', '姐妹', '父母', '儿女', '子孙', '东西', '南北', '左右', '上下', '前后', '内外', '多少', '大小', '高低', '长短', '厚薄', '轻重', '缓急', '安危', '利害', '得失', '成败', '兴亡', '生死', '存亡', '古今', '中外', '公私', '敌我', '彼此', '往来', '出入', '开关', '始终', '本末', '源流', '因果', '是非', '黑白', '真假', '虚实', '动静', '进退', '去就', '行止', '坐卧', '起居', '饮食', '衣食', '住行', '声色', '犬马', '花鸟', '虫鱼', '山水', '风云', '雷电', '雨雪', '霜露', '日月', '星辰', '天地', '乾坤', '阴阳', '五行', '八卦', '九宫', '十二', '二十', '三十', '四十', '五十', '六十', '七十', '八十', '九十', '一百', '一千', '一万', '亿万', '兆亿'
])

interface FlaggedIdiom {
  idiom: string
  reason: string
  score: number
}

const flagged: FlaggedIdiom[] = []

for (const idiom of idioms) {
  let score = 0
  let reasons: string[] = []

  // 1. Check character rarity
  let maxRank = 0
  for (const char of idiom) {
    const rank = charRank.get(char)
    if (rank === undefined) {
      score += 50
      reasons.push(`Unknown char: ${char}`)
    } else if (rank > 3000) { // Slightly looser threshold for candidate list as it's supposed to be HSK based
      score += 10
      reasons.push(`Rare char: ${char}(${rank})`)
      if (rank > maxRank) maxRank = rank
    }
  }

  // 2. Check suspicious words
  for (const word of suspiciousWords) {
    if (idiom.includes(word)) {
       // Check if it's a known idiom pattern to avoid false positives
       // But for report purposes, we list them
       score += 5 
       reasons.push(`Contains: ${word}`)
    }
  }
  
  // 3. Length check
  if (idiom.length !== 4) {
      score += 100
      reasons.push(`Length: ${idiom.length}`)
  }

  if (score > 0) {
    flagged.push({ idiom, reason: reasons.join(', '), score })
  }
}

// Sort by score descending
flagged.sort((a, b) => b.score - a.score)

// Generate report
let report = '# Candidate List Review\n\n'
report += '| Idiom | Score | Reason |\n|---|---|---|\n'
for (const item of flagged) {
  report += `| ${item.idiom} | ${item.score} | ${item.reason} |\n`
}

writeFileSync(reviewPath, report)
console.log(`Flagged ${flagged.length} idioms for review.`)
