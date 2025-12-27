
import { readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const idiomsPath = join(__dirname, '../src/data/idioms.txt')
const candidatePath = join(__dirname, '../src/data/common_idioms_candidate.txt')
const commonCharsPath = join(__dirname, '../src/data/common_chars.txt')
const outputPath = join(__dirname, '../src/data/common_idioms_expansion.txt')

// Load existing candidate idioms
const candidateRaw = readFileSync(candidatePath, 'utf-8')
const existingIdioms = new Set(candidateRaw.split('\n').map(i => i.trim()).filter(Boolean))

// Load common characters (3500 most common)
const commonCharsRaw = readFileSync(commonCharsPath, 'utf-8')
const commonCharsList = commonCharsRaw.split('\n').map(c => c.trim()).filter(Boolean)

// Create a map of character -> rank (lower rank = more common)
const charRank = new Map<string, number>()
commonCharsList.forEach((char, index) => {
  charRank.set(char, index)
})

// Load all idioms
const idiomsRaw = readFileSync(idiomsPath, 'utf-8')
const allIdioms = idiomsRaw.split('\n').map(i => i.trim()).filter(Boolean)

// Filter out existing idioms
const remainingIdioms = allIdioms.filter(idiom => !existingIdioms.has(idiom))

console.log(`Original idioms: ${allIdioms.length}`)
console.log(`Already selected: ${existingIdioms.size}`)
console.log(`Remaining idioms: ${remainingIdioms.length}`)

// Score each idiom based on character commonness
// Lower score = more common characters = better
function scoreIdiom(idiom: string): number {
  let totalRank = 0
  let hasUnknown = false

  for (const char of idiom) {
    const rank = charRank.get(char)
    if (rank === undefined) {
      // Character not in common list - heavily penalize
      hasUnknown = true
      totalRank += 10000
    } else {
      totalRank += rank
    }
  }

  // If all characters are common, use average rank
  // If any character is uncommon, deprioritize
  return hasUnknown ? totalRank + 100000 : totalRank
}

// Score all remaining idioms
const scoredIdioms = remainingIdioms.map(idiom => ({
  idiom,
  score: scoreIdiom(idiom)
}))

// Sort by score (lower = more common)
scoredIdioms.sort((a, b) => a.score - b.score)

// Take top 2500 idioms (aiming for 2000-3000 range)
const TARGET = 2500
const selectedIdioms = scoredIdioms.slice(0, TARGET).map(item => item.idiom)

console.log(`Selected ${selectedIdioms.length} additional idioms`)

// Sort alphabetically for readability
selectedIdioms.sort()

writeFileSync(outputPath, selectedIdioms.join('\n'))
console.log(`Saved to: ${outputPath}`)
