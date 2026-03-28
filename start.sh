#!/bin/sh
set -e

echo "========================================"
echo "🚀 Handle Bot 启动脚本"
echo "========================================"
echo ""

# ============ 环境变量诊断 ============
echo "📋 环境变量诊断:"
echo "  WARP_PRIVATE_KEY: $(if [ -n "$WARP_PRIVATE_KEY" ]; then echo "✅ 已设置 (长度: $(echo -n "$WARP_PRIVATE_KEY" | wc -c) 字符)"; else echo "❌ 未设置"; fi)"
echo "  DISCORD_TOKEN:    $(if [ -n "$DISCORD_TOKEN" ]; then echo "✅ 已设置"; else echo "❌ 未设置"; fi)"
echo "  PORT:             ${PORT:-10000}"
echo ""

# ============ 检查 wireproxy 是否存在 ============
echo "📋 wireproxy 检查:"
if [ -f /usr/local/bin/wireproxy ]; then
  echo "  二进制文件: ✅ 存在"
  echo "  版本: $(/usr/local/bin/wireproxy --version 2>&1 || echo '(无法获取)')"
else
  echo "  二进制文件: ❌ 不存在！"
fi
echo ""

# ============ 生成 wireproxy 配置 ============
if [ -z "$WARP_PRIVATE_KEY" ]; then
  echo "⚠️ 未设置 WARP_PRIVATE_KEY → 跳过 WARP，直连模式"
  exec node dist/index.js
fi

# 注意：HTTP 代理段名必须是小写 [http]，不是 [HTTPProxy]
cat > /tmp/wireproxy.conf << EOF
[Interface]
PrivateKey = ${WARP_PRIVATE_KEY}
Address = 172.16.0.2/32
DNS = 1.1.1.1

[Peer]
PublicKey = bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=
AllowedIPs = 0.0.0.0/0
Endpoint = engage.cloudflareclient.com:2408

[http]
BindAddress = 127.0.0.1:1080
EOF

echo "🔧 配置已生成 (模式: [http] 代理, 端口: 1080)"

# ============ 启动 wireproxy ============
echo "⏳ 正在启动 wireproxy..."
/usr/local/bin/wireproxy -c /tmp/wireproxy.conf &
WIREPROXY_PID=$!
echo "  PID: $WIREPROXY_PID"

# ============ 等待代理端口就绪（最多 30 秒）============
echo "⏳ 等待 HTTP 代理端口 1080 就绪..."
READY=0
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
  if curl -s --max-time 2 --proxy http://127.0.0.1:1080 http://example.com > /dev/null 2>&1; then
    READY=1
    echo "  ✅ 代理端口就绪！(第 ${i} 秒)"
    break
  fi
  # 检查进程是否还活着
  if ! kill -0 $WIREPROXY_PID 2>/dev/null; then
    echo "  ❌ wireproxy 进程已退出！"
    break
  fi
  sleep 1
done

if [ $READY -eq 0 ]; then
  echo "❌ 代理端口 30 秒内未就绪"
  if kill -0 $WIREPROXY_PID 2>/dev/null; then
    echo "  wireproxy 进程仍在运行但代理未监听，可能是配置错误"
  fi
  echo "  回退到直连模式..."
  echo ""
  exec node dist/index.js
fi

# ============ 测试 WARP 连通性 ============
echo "🔍 测试 WARP 隧道状态..."
TRACE=$(curl -s --max-time 10 --proxy http://127.0.0.1:1080 https://cloudflare.com/cdn-cgi/trace 2>&1) || true
if echo "$TRACE" | grep -q "warp=on"; then
  echo "  ✅ WARP 隧道已激活！"
  echo "  出站 IP: $(echo "$TRACE" | grep 'ip=' || echo '未知')"
  echo "  WARP:    $(echo "$TRACE" | grep 'warp=' || echo '未知')"
elif echo "$TRACE" | grep -q "warp="; then
  echo "  ⚠️ WARP 状态: $(echo "$TRACE" | grep 'warp=')"
  echo "  出站 IP: $(echo "$TRACE" | grep 'ip=' || echo '未知')"
else
  echo "  ⚠️ 无法确认 WARP 状态，但代理端口已通，继续启动"
fi

echo ""
echo "========================================"
echo "🤖 启动 Discord Bot..."
echo "========================================"
exec node dist/index.js
