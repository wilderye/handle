import { createCanvas, registerFont } from 'canvas'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import type { MatchResult, ParsedChar } from '../logic/types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 注册字体
const fontPath = join(__dirname, '../../src/assets/fonts/NotoSerifSC-Regular.otf')
try {
  registerFont(fontPath, { family: 'Noto Serif SC' })
} catch (e) {
  console.warn('⚠️ 字体加载失败，将使用系统默认字体:', e)
}

// 颜色定义
const COLORS = {
  ok: '#1d9c9c',
  mis: '#de7525',
  bg: '#ffffff',
  gray: '#e5e7eb', // gray-200
  text: '#374151', // gray-700
  blockBg: '#f9fafb', // gray-50
  blockHasAnswer: '#f3f4f6', // gray-100
  white: '#ffffff',
}

// 声调 SVG 路径数据
const TONE_PATHS: Record<string, string> = {
  1: "M3.35 8C2.60442 8 2 8.60442 2 9.35V10.35C2 11.0956 2.60442 11.7 3.35 11.7H17.35C18.0956 11.7 18.7 11.0956 18.7 10.35V9.35C18.7 8.60442 18.0956 8 17.35 8H3.35Z",
  2: "M16.581 3.71105C16.2453 3.27254 15.6176 3.18923 15.1791 3.52498L3.26924 12.6439C2.83073 12.9796 2.74743 13.6073 3.08318 14.0458L4.29903 15.6338C4.63478 16.0723 5.26244 16.1556 5.70095 15.8199L17.6108 6.70095C18.0493 6.3652 18.1327 5.73754 17.7969 5.29903L16.581 3.71105Z",
  3: "M1.70711 7.70712C1.31658 7.3166 1.31658 6.68343 1.70711 6.29291L2.41421 5.5858C2.80474 5.19528 3.4379 5.19528 3.82843 5.5858L9.31502 11.0724C9.70555 11.4629 10.3387 11.4629 10.7292 11.0724L16.2158 5.5858C16.6064 5.19528 17.2395 5.19528 17.63 5.5858L18.3372 6.29291C18.7277 6.68343 18.7277 7.3166 18.3372 7.70712L10.7292 15.315C10.3387 15.7056 9.70555 15.7056 9.31502 15.315L1.70711 7.70712Z",
  4: "M4.12282 3.71105C4.45857 3.27254 5.08623 3.18923 5.52474 3.52498L17.4346 12.6439C17.8731 12.9796 17.9564 13.6073 17.6207 14.0458L16.4048 15.6338C16.0691 16.0723 15.4414 16.1556 15.0029 15.8199L3.09303 6.70095C2.65452 6.3652 2.57122 5.73754 2.90697 5.29903L4.12282 3.71105Z"
}

export interface GameBoardData {
  tries: string[]
  results: MatchResult[][]
  parsed: ParsedChar[][]
}

export interface CheatsheetData {
  initials: Record<string, 'exact' | 'misplaced' | 'none'>
  finals: Record<string, 'exact' | 'misplaced' | 'none'>
}



// 辅助函数：获取声调位置
function getToneCharLocation(part: string): number {
  if (!part) return 0
  const locations = [
    part.lastIndexOf('iu') > -1 ? part.lastIndexOf('iu') + 1 : -1,
    part.lastIndexOf('a'),
    part.lastIndexOf('e'),
    part.lastIndexOf('o'),
    part.lastIndexOf('i'),
    part.lastIndexOf('u'),
    part.lastIndexOf('v'),
  ]
  const found = locations.find(i => i !== null && i >= 0)
  return found !== undefined ? found : 0
}

// 辅助函数：获取颜色
function getColor(state: 'exact' | 'misplaced' | 'none' | undefined, allExact: boolean, isChar = false): string {
  if (allExact) return COLORS.white
  if (!state) return isChar ? 'rgba(55, 65, 81, 0.8)' : 'rgba(55, 65, 81, 0.35)' // text with opacity
  
  if (state === 'exact') return COLORS.ok
  if (state === 'misplaced') return COLORS.mis
  return isChar ? 'rgba(55, 65, 81, 0.8)' : 'rgba(55, 65, 81, 0.35)'
}

/**
 * 生成游戏面板截图
 */
export async function generateGameBoardScreenshot(data: GameBoardData): Promise<Buffer> {
  const width = 380 // 4 * 80 + 3 * 8 + 2 * 10 padding
  const height = Math.max(data.tries.length * 88 + 20, 100)
  
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  
  // 背景
  ctx.fillStyle = COLORS.bg
  ctx.fillRect(0, 0, width, height)
  
  const startX = 14 // padding 10 + 4 (center adjustment)
  const startY = 10
  
  data.tries.forEach((word, rowIndex) => {
    const chars = Array.from(word)
    const results = data.results[rowIndex] || []
    const parsed = data.parsed[rowIndex] || []
    
    chars.forEach((char, charIndex) => {
      const result = results[charIndex] || {}
      const charData = parsed[charIndex] || {}
      
      const x = startX + charIndex * 88 // 80 + 8 gap
      const y = startY + rowIndex * 88
      
      const allExact = result.char === 'exact' && 
                      result._1 === 'exact' && 
                      result._2 === 'exact' && 
                      result.tone === 'exact'
      
      // 绘制字块背景
      if (allExact) {
        ctx.fillStyle = COLORS.ok
        ctx.fillRect(x, y, 80, 80)
      } else {
        ctx.fillStyle = result.char ? COLORS.blockHasAnswer : COLORS.blockBg
        ctx.fillRect(x, y, 80, 80)
        
        // 边框
        ctx.strokeStyle = COLORS.gray
        ctx.lineWidth = 2
        ctx.strokeRect(x, y, 80, 80)
      }
      
      // 绘制汉字
      ctx.font = '32px "Noto Serif SC"'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillStyle = getColor(result.char, allExact, true)
      ctx.fillText(char, x + 40, y + 34)
      
      // 绘制拼音
      const pinyinY = y + 11
      ctx.font = '100 14px "Courier New", monospace' // 使用等宽字体模拟
      ctx.textBaseline = 'top'
      
      // 计算拼音总宽度以居中
      // 这里简化处理，直接分段绘制
      
      // 1. 声母
      // const currentX = x + 40 // 从中心开始
      let totalWidth = 0
      
      const p1 = charData._1 || ''
      const p2 = charData._2 || ''
      
      // 简单估算宽度
      const w1 = p1 ? ctx.measureText(p1).width : 0
      const w2 = p2 ? ctx.measureText(p2.replace('v', 'u')).width : 0
      totalWidth = w1 + w2 + (p1 && p2 ? 2 : 0) // 2px gap
      
      let drawX = x + 40 - totalWidth / 2
      
      if (p1) {
        ctx.fillStyle = getColor(result._1, allExact)
        ctx.textAlign = 'left'
        ctx.fillText(p1, drawX, pinyinY)
        drawX += w1 + 1
      }
      
      if (p2) {
        drawX += 1
        const toneIndex = getToneCharLocation(p2)
        const finalChars = Array.from(p2)
        
        finalChars.forEach((c, idx) => {
          const displayChar = c === 'v' ? 'u' : c
          const charW = ctx.measureText(displayChar).width
          
          // 绘制字符
          ctx.fillStyle = getColor(result._2, allExact)
          ctx.fillText(displayChar, drawX, pinyinY)
          
          // 绘制声调
          if (idx === toneIndex && charData.tone && TONE_PATHS[charData.tone]) {
            const tonePath = new Path2D(TONE_PATHS[charData.tone])
            ctx.save()
            // SVG 是 20x20，需要缩放和定位
            // 目标宽度约 10px?
            const scale = 0.6
            const toneX = drawX + charW / 2 - 10 * scale
            const toneY = pinyinY + (c === 'v' ? -4 : -5) // 微调位置
            
            ctx.translate(toneX, toneY)
            ctx.scale(scale, scale)
            ctx.fillStyle = getColor(result.tone, allExact)
            ctx.fill(tonePath as any)
            ctx.restore()
          }
          
          drawX += charW
        })
      }
    })
  })
  
  return canvas.toBuffer()
}

/**
 * 生成速查表截图
 */
export async function generateCheatsheetScreenshot(data: CheatsheetData): Promise<Buffer> {
  const width = 800
  const height = 600
  
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  
  // 背景
  ctx.fillStyle = COLORS.bg
  ctx.fillRect(0, 0, width, height)
  
  // 标题
  // ... 暂时简化，只画内容
  
  // 声母
  const initials = ['b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'zh', 'ch', 'sh', 'r', 'z', 'c', 's', 'y', 'w']
  
  // 韵母
  const finals = ['a', 'o', 'e', 'i', 'u', 'v', 'ai', 'ei', 'ao', 'ou', 'an', 'en', 'ang', 'eng', 'ong', 'ia', 'ie', 'iu', 'ian', 'in', 'iang', 'ing', 'iong', 'ua', 'uo', 'uai', 'ui', 'uan', 'un', 'uang', 've', 'van', 'vn']
  
  ctx.font = '16px "Courier New", monospace'
  ctx.textAlign = 'center'
  
  // 绘制声母
  let startX = 50
  const startY = 50
  ctx.fillStyle = '#9ca3af'
  ctx.fillText('声母', startX + 100, startY - 20)
  
  initials.forEach((s, i) => {
    const col = i % 4
    const row = Math.floor(i / 4)
    const x = startX + col * 60
    const y = startY + row * 40
    
    const state = data.initials[s]
    if (state === 'exact') ctx.fillStyle = COLORS.ok
    else if (state === 'misplaced') ctx.fillStyle = COLORS.mis
    else ctx.fillStyle = 'rgba(55, 65, 81, 0.3)'
    
    ctx.fillText(s, x, y)
  })
  
  // 绘制韵母
  startX = 350
  ctx.fillStyle = '#9ca3af'
  ctx.fillText('韵母', startX + 200, startY - 20)
  
  finals.forEach((s, i) => {
    const col = i % 6
    const row = Math.floor(i / 6)
    const x = startX + col * 70
    const y = startY + row * 40
    
    const state = data.finals[s]
    if (state === 'exact') ctx.fillStyle = COLORS.ok
    else if (state === 'misplaced') ctx.fillStyle = COLORS.mis
    else ctx.fillStyle = 'rgba(55, 65, 81, 0.3)'
    
    ctx.fillText(s.replace('v', 'ü'), x, y)
  })
  
  return canvas.toBuffer()
}

export async function warmupBrowser() {
  // No-op for canvas
}

export async function closeBrowser() {
  // No-op for canvas
}
