
import { readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const commonCharsPath = join(__dirname, '../src/data/common_chars.txt')
const idiomsPath = join(__dirname, '../src/data/idioms.txt')
const outputPath = join(__dirname, '../src/data/common_idioms_candidate.txt')

const commonCharsRaw = readFileSync(commonCharsPath, 'utf-8')
const commonChars = new Set(commonCharsRaw.split('\n').map(c => c.trim()).filter(Boolean))

const idiomsRaw = readFileSync(idiomsPath, 'utf-8')
const idioms = idiomsRaw.split('\n').map(i => i.trim()).filter(Boolean)

const commonIdioms = idioms.filter(idiom => {
  for (const char of idiom) {
    if (!commonChars.has(char)) {
      return false
    }
  }
  return true
})

console.log(`Total idioms: ${idioms.length}`)
console.log(`Common chars: ${commonChars.size}`)
console.log(`Filtered idioms: ${commonIdioms.length}`)

writeFileSync(outputPath, commonIdioms.join('\n'))
