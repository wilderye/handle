# 使用完整版 Node 镜像（包含预编译工具）
FROM node:20

# 安装 Canvas 运行时依赖（不需要 -dev 包）
RUN apt-get update && apt-get install -y \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libjpeg62-turbo \
    libgif7 \
    librsvg2-2 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 复制 package.json 和 lock 文件
COPY package*.json ./

# 安装依赖（canvas 会下载预编译二进制）
RUN npm install

# 复制源代码
COPY . .

# 构建 TypeScript
RUN npm run build

# 启动 Bot
CMD ["npm", "start"]
