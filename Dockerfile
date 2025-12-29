# ============ Build Stage ============
FROM node:18-bullseye AS builder

# 安装 canvas 编译依赖
RUN apt-get update && apt-get install -y \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# 只保留生产依赖
RUN npm ci --only=production

# ============ Runtime Stage ============
FROM node:18-slim

# 安装 canvas 运行时依赖（比编译依赖小得多）
RUN apt-get update && apt-get install -y \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libjpeg62-turbo \
    libgif7 \
    librsvg2-2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 从 builder 阶段复制构建产物和依赖
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/src/data ./src/data
COPY --from=builder /app/src/assets ./src/assets

CMD ["node", "dist/index.js"]
