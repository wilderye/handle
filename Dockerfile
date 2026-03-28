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
RUN npm ci --omit=dev

# ============ Runtime Stage ============
FROM node:18-slim

# 安装 canvas 运行时依赖 + wget（用于下载 wireproxy）
RUN apt-get update && apt-get install -y \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libjpeg62-turbo \
    libgif7 \
    librsvg2-2 \
    wget \
    && rm -rf /var/lib/apt/lists/*

# 下载 wireproxy（用户态 WireGuard，提供 HTTP 代理走 Cloudflare WARP）
RUN wget -qO /tmp/wireproxy.tar.gz \
    https://github.com/windtf/wireproxy/releases/download/v1.1.2/wireproxy_linux_amd64.tar.gz \
    && tar -xzf /tmp/wireproxy.tar.gz -C /usr/local/bin/ wireproxy \
    && chmod +x /usr/local/bin/wireproxy \
    && rm /tmp/wireproxy.tar.gz

WORKDIR /app

# 从 builder 阶段复制构建产物和依赖
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/src/data ./src/data
COPY --from=builder /app/src/assets ./src/assets

# 复制启动脚本
COPY start.sh ./
RUN chmod +x start.sh

EXPOSE 10000

CMD ["./start.sh"]
