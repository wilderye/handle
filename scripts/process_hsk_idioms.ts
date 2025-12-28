
import { readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const csvPath = join(__dirname, '../src/data/hsk_idioms.csv')
const outputPath = join(__dirname, '../src/data/common_idioms_candidate.txt')

const csvRaw = readFileSync(csvPath, 'utf-8')
const lines = csvRaw.split('\n')

const idioms = new Set<string>()

for (let i = 1; i < lines.length; i++) { // Skip header
  const line = lines[i].trim()
  if (!line) continue

  // Simple CSV parsing (assuming no commas in the idiom itself)
  const parts = line.split(',')
  const idiom = parts[0].trim()

  // Filter non-Chinese characters to check length
  const chineseOnly = idiom.replace(/[^\u4e00-\u9fa5]/g, '')

  if (chineseOnly.length === 4) {
    idioms.add(chineseOnly)
  }
}

const sortedIdioms = Array.from(idioms).sort()

console.log(`Total idioms found: ${sortedIdioms.length}`)

writeFileSync(outputPath, sortedIdioms.join('\n'))
