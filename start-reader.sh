#!/bin/bash

# Web阅读器启动脚本

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "🚀 启动《神临山海》Web阅读器..."
echo ""
echo "服务器将在以下地址启动："
echo "  http://localhost:8000"
echo ""
echo "访问阅读器："
echo "  http://localhost:8000"
echo ""
echo "按 Ctrl+C 停止服务器"
echo ""

# 检查端口是否被占用
if lsof -Pi :8000 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    echo "⚠️  端口8000已被占用，正在停止旧进程..."
    lsof -ti:8000 | xargs kill -9 2>/dev/null
    sleep 2
fi

# 检查Python版本
if command -v python3 &> /dev/null; then
    echo "✅ 使用 Python 3 启动服务器..."
    # 在项目根目录启动，这样相对路径才能正确工作
    python3 -m http.server 8000
elif command -v python &> /dev/null; then
    echo "✅ 使用 Python 启动服务器..."
    python -m http.server 8000
else
    echo "❌ 错误：未找到Python，请安装Python 3"
    echo ""
    echo "或者使用其他方法："
    echo "  - Node.js: npx serve ."
    echo "  - PHP: php -S localhost:8000"
    exit 1
fi
