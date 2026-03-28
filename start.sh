#!/bin/sh
set -e

# ============ 生成 wireproxy 配置 ============
# 私钥从环境变量注入，不写死在代码里
if [ -z "$WARP_PRIVATE_KEY" ]; then
  echo "⚠️ 未设置 WARP_PRIVATE_KEY，跳过 WARP 代理，直连模式启动"
  exec node dist/index.js
fi

cat > /tmp/wireproxy.conf << EOF
[Interface]
PrivateKey = ${WARP_PRIVATE_KEY}
Address = 172.16.0.2/32
DNS = 1.1.1.1

[Peer]
PublicKey = bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=
AllowedIPs = 0.0.0.0/0
Endpoint = engage.cloudflareclient.com:2408

[HTTPProxy]
BindAddress = 127.0.0.1:1080
EOF

echo "🔧 wireproxy 配置已生成"

# ============ 启动 wireproxy ============
/usr/local/bin/wireproxy -c /tmp/wireproxy.conf &
WIREPROXY_PID=$!

# 等待代理就绪
echo "⏳ 等待 WARP 代理启动..."
sleep 3

# 简单检测代理是否存活
if kill -0 $WIREPROXY_PID 2>/dev/null; then
  echo "✅ WARP HTTP 代理已就绪 (127.0.0.1:1080)"
else
  echo "❌ wireproxy 启动失败，回退到直连模式"
  exec node dist/index.js
fi

# ============ 启动 Bot ============
exec node dist/index.js
