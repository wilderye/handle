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
  echo "  二进制文件: ✅ 存在 (/usr/local/bin/wireproxy)"
  echo "  版本: $(/usr/local/bin/wireproxy --version 2>&1 || echo '(无法获取版本)')"
else
  echo "  二进制文件: ❌ 不存在！Docker 镜像构建可能有问题"
fi
echo ""

# ============ 生成 wireproxy 配置 ============
if [ -z "$WARP_PRIVATE_KEY" ]; then
  echo "⚠️ 未设置 WARP_PRIVATE_KEY 环境变量"
  echo "   → 请在 Render Dashboard → Environment 中添加此变量"
  echo "   → 跳过 WARP 代理，以直连模式启动（可能被 Discord 拦截）"
  echo ""
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

echo "🔧 wireproxy 配置已生成 (/tmp/wireproxy.conf)"
echo "   模式: HTTP 代理"
echo "   监听: 127.0.0.1:1080"
echo ""

# ============ 启动 wireproxy ============
echo "⏳ 正在启动 wireproxy..."
/usr/local/bin/wireproxy -c /tmp/wireproxy.conf &
WIREPROXY_PID=$!
echo "   PID: $WIREPROXY_PID"

# 等待代理就绪
echo "⏳ 等待 WARP 隧道建立 (5秒)..."
sleep 5

# 检测代理是否存活
if kill -0 $WIREPROXY_PID 2>/dev/null; then
  echo "✅ wireproxy 进程存活 (PID: $WIREPROXY_PID)"
  
  # 通过代理测试出站连通性
  echo "🔍 测试 WARP 代理连通性..."
  TEST_RESULT=$(curl -s --max-time 10 --proxy http://127.0.0.1:1080 https://cloudflare.com/cdn-cgi/trace 2>&1) || true
  if echo "$TEST_RESULT" | grep -q "warp=on"; then
    echo "✅ WARP 隧道已激活！流量走 Cloudflare 网络"
    echo "   $(echo "$TEST_RESULT" | grep 'ip=')"
    echo "   $(echo "$TEST_RESULT" | grep 'warp=')"
  elif [ -n "$TEST_RESULT" ]; then
    echo "⚠️ WARP 隧道状态不确定，但代理有响应:"
    echo "   $(echo "$TEST_RESULT" | head -5)"
  else
    echo "⚠️ 代理无响应，但进程仍在运行，继续尝试启动 Bot..."
  fi
else
  echo "❌ wireproxy 启动失败（进程已退出）"
  echo "   可能原因: 私钥错误、网络不通、配置格式问题"
  echo "   回退到直连模式..."
  exec node dist/index.js
fi

echo ""
echo "========================================"
echo "🤖 启动 Discord Bot..."
echo "========================================"
exec node dist/index.js
