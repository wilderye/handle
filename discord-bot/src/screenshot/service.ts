import { dirname, join } from 'path'
import puppeteer, { Browser } from 'puppeteer'
import { fileURLToPath } from 'url'
import type { MatchResult, ParsedChar } from '../logic/types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 浏览器实例（复用以提高性能）
let browser: Browser | null = null

async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: 'new', // 使用新版 headless 模式，更快更稳定
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      // 在 Docker 环境中使用系统安装的 Chromium
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    })
  }
  return browser
}

// 预热浏览器（Bot 启动时调用）
export async function warmupBrowser(): Promise<void> {
  console.log('🔄 正在预热 Puppeteer 浏览器...')
  const startTime = Date.now()
  await getBrowser()
  console.log(`✅ 浏览器预热完成 (耗时 ${Date.now() - startTime}ms)`)
}

// 关闭浏览器（用于清理）
export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close()
    browser = null
  }
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

/**
 * 生成游戏面板截图
 */
/**
 * 生成游戏面板截图
 */
export async function generateGameBoardScreenshot(data: GameBoardData): Promise<Buffer> {
  const browser = await getBrowser()
  const page = await browser.newPage()
  
  try {
    // 初始视口（宽度足够大以容纳内容）
    await page.setViewport({ width: 800, height: 600 })
    
    // 构建模板路径
    const templatePath = join(__dirname, '../../render/game-board.html')
    const encodedData = encodeURIComponent(JSON.stringify(data))
    const url = `file://${templatePath}?data=${encodedData}`
    
    // 加载页面
    await page.goto(url, { waitUntil: 'networkidle0' })
    
    // 等待游戏面板渲染
    await page.waitForSelector('#game-board')
    
    // 获取游戏面板元素
    const element = await page.$('#game-board')
    if (!element) {
      throw new Error('找不到游戏面板元素')
    }
    
    // 截图（element.screenshot 会自动裁剪到元素大小）
    const screenshot = await element.screenshot({
      type: 'png',
      omitBackground: false, // 保留背景色
    })
    
    return screenshot as Buffer
  } finally {
    await page.close()
  }
}

/**
 * 生成速查表截图
 */
export async function generateCheatsheetScreenshot(data: CheatsheetData): Promise<Buffer> {
  const browser = await getBrowser()
  const page = await browser.newPage()
  
  try {
    // 初始视口
    await page.setViewport({ width: 800, height: 600 })
    
    // 构建模板路径
    const templatePath = join(__dirname, '../../render/cheatsheet.html')
    const encodedData = encodeURIComponent(JSON.stringify(data))
    const url = `file://${templatePath}?data=${encodedData}`
    
    // 加载页面
    await page.goto(url, { waitUntil: 'networkidle0' })
    
    // 等待速查表渲染
    await page.waitForSelector('#cheatsheet')
    
    // 获取速查表元素
    const element = await page.$('#cheatsheet')
    if (!element) {
      throw new Error('找不到速查表元素')
    }
    
    // 截图
    const screenshot = await element.screenshot({
      type: 'png',
      omitBackground: false,
    })
    
    return screenshot as Buffer
  } finally {
    await page.close()
  }
}
