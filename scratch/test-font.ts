import { createCanvas, registerFont } from 'canvas';
import { existsSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fontOtfPath = join(__dirname, '../src/assets/fonts/NotoSerifSC-Regular.otf');
console.log('🔍 [诊断] OTF 字体是否存在:', existsSync(fontOtfPath));

// 1. 注册为 "Source Han Serif SC"
try {
  registerFont(fontOtfPath, { family: 'Source Han Serif SC' });
  console.log('✅ 注册 "Source Han Serif SC" 成功');
} catch (err: any) {
  console.error('❌ 注册失败:', err);
}

// 2. 绘制测试
try {
  const canvas = createCanvas(400, 100);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 400, 100);
  
  ctx.font = '32px "Source Han Serif SC"';
  ctx.fillStyle = '#111827';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('测试汉字: 彻底解决了吗', 200, 50);
  
  const outPath = join(__dirname, 'test-pure-source-han.png');
  writeFileSync(outPath, canvas.toBuffer('image/png'));
  console.log('✅ 测试成功！图片已写入:', outPath);
} catch (err: any) {
  console.error('❌ 绘制失败:', err);
}
