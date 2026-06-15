#!/bin/sh
set -e

echo "========================================"
echo "Handle Bot startup"
echo "========================================"
echo ""

# ============ 环境变量诊断 ============
echo "Environment check:"
echo "  DISCORD_TOKEN:    $(if [ -n "$DISCORD_TOKEN" ]; then echo "set"; else echo "missing"; fi)"
echo "  PORT:             ${PORT:-10000}"
echo ""

echo "========================================"
echo "Starting Discord bot..."
echo "========================================"
exec node dist/index.js
