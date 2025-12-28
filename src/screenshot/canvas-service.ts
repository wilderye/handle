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

export interface GameBoardData {
  tries: string[]
  results: MatchResult[][]
  parsed: ParsedChar[][]
}

export interface CheatsheetData {
  initials: Record<string, 'exact' | 'misplaced' | 'none'>
  finals: Record<string, 'exact' | 'misplaced' | 'none'>
}

// 辅助函数：获取颜色
function getColor(state: 'exact' | 'misplaced' | 'none' | undefined, allExact: boolean, isChar = false): string {
  if (allExact) return COLORS.white
  if (!state) return isChar ? 'rgba(55, 65, 81, 0.8)' : 'rgba(55, 65, 81, 0.9)' // text with opacity
  
  if (state === 'exact') return COLORS.ok
  if (state === 'misplaced') return COLORS.mis
  return isChar ? 'rgba(55, 65, 81, 0.8)' : 'rgba(55, 65, 81, 0.9)'
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
      ctx.font = '100 16px "Courier New", monospace' // 使用等宽字体模拟
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
        const finalChars = Array.from(p2)
        
        finalChars.forEach((c) => {
          const displayChar = c === 'v' ? 'u' : c
          const charW = ctx.measureText(displayChar).width
          
          // 绘制字符
          ctx.fillStyle = getColor(result._2, allExact)
          ctx.fillText(displayChar, drawX, pinyinY)
          
          drawX += charW
        })
        
        // 在韵母末尾右上角绘制声调数字
        if (charData.tone) {
          ctx.save()
          ctx.font = '100 12px "Courier New", monospace'
          ctx.fillStyle = getColor(result.tone, allExact)
          ctx.fillText(String(charData.tone), drawX, pinyinY - 2)
          ctx.restore()
        }
      }
    })
  })
  
  return canvas.toBuffer()
}

/**
 * 生成速查表截图
 */
export async function generateCheatsheetScreenshot(data: CheatsheetData): Promise<Buffer> {
  // 声母
  const initials = ['b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'zh', 'ch', 'sh', 'r', 'z', 'c', 's', 'y', 'w']
  
  // 韵母
  const finals = ['a', 'o', 'e', 'i', 'u', 'v', 'ai', 'ei', 'ao', 'ou', 'an', 'en', 'ang', 'eng', 'ong', 'ia', 'ie', 'iu', 'ian', 'in', 'iang', 'ing', 'iong', 'ua', 'uo', 'uai', 'ui', 'uan', 'un', 'uang', 've', 'van', 'vn']
  
  // 布局参数
  const cols = 6
  const cellWidth = 55
  const cellHeight = 30
  const padding = 20
  const sectionGap = 20
  const labelHeight = 25
  
  // 计算尺寸
  const initialsRows = Math.ceil(initials.length / cols)
  const finalsRows = Math.ceil(finals.length / cols)
  
  const width = padding * 2 + cols * cellWidth
  const height = padding * 2 + labelHeight + initialsRows * cellHeight + sectionGap + labelHeight + finalsRows * cellHeight
  
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  
  // 背景
  ctx.fillStyle = COLORS.bg
  ctx.fillRect(0, 0, width, height)
  
  ctx.font = '16px "Courier New", monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  
  let currentY = padding
  
  // 声母标题
  ctx.fillStyle = '#6b7280'
  ctx.fillText('声母', width / 2, currentY + labelHeight / 2)
  currentY += labelHeight
  
  // 绘制声母
  initials.forEach((s, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = padding + col * cellWidth + cellWidth / 2
    const y = currentY + row * cellHeight + cellHeight / 2
    
    const state = data.initials[s]
    if (state === 'exact') ctx.fillStyle = COLORS.ok
    else if (state === 'misplaced') ctx.fillStyle = COLORS.mis
    else if (state === 'none') ctx.fillStyle = 'rgba(55, 65, 81, 0.3)' // 已排除，淡色
    else ctx.fillStyle = 'rgba(55, 65, 81, 1)' // 未使用，正常颜色
    
    ctx.fillText(s, x, y)
  })
  
  currentY += initialsRows * cellHeight + sectionGap
  
  // 韵母标题
  ctx.fillStyle = '#6b7280'
  ctx.fillText('韵母', width / 2, currentY + labelHeight / 2)
  currentY += labelHeight
  
  // 绘制韵母
  finals.forEach((s, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = padding + col * cellWidth + cellWidth / 2
    const y = currentY + row * cellHeight + cellHeight / 2
    
    const state = data.finals[s]
    if (state === 'exact') ctx.fillStyle = COLORS.ok
    else if (state === 'misplaced') ctx.fillStyle = COLORS.mis
    else if (state === 'none') ctx.fillStyle = 'rgba(55, 65, 81, 0.3)' // 已排除，淡色
    else ctx.fillStyle = 'rgba(55, 65, 81, 1)' // 未使用，正常颜色
    
    ctx.fillText(s.replace(/v/g, 'ü'), x, y)
  })
  
  return canvas.toBuffer()
}

export async function warmupBrowser() {
  // No-op for canvas
}

export async function closeBrowser() {
  // No-op for canvas
}
