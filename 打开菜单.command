#!/bin/zsh
# 双击这个文件，在 Mac 上预览菜单。
# 关掉时按 Control+C，或者直接关掉这个终端窗口。

cd "$(dirname "$0")" || exit 1

echo ""
echo "  Cal Dining 双语菜单"
echo "  ────────────────────────────"

# 找个没被占用的端口
PORT=8791
while lsof -i :$PORT >/dev/null 2>&1; do
  PORT=$((PORT + 1))
done

echo "  正在启动… 浏览器会自己打开"
echo "  地址：http://localhost:$PORT"
echo ""
echo "  看完了按 Control + C 关掉"
echo "  ────────────────────────────"
echo ""

# 等服务器起来再开浏览器
( sleep 1; open "http://localhost:$PORT" ) &

python3 -m http.server $PORT --directory . --bind 127.0.0.1
