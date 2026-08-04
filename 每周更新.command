#!/bin/zsh
# 每周日双击这个文件，重新抓一次菜单。

cd "$(dirname "$0")" || exit 1

echo ""
echo "  Cal Dining 菜单更新"
echo "  ────────────────────────────"
echo ""

# 缺依赖就自动装
if ! python3 -c 'import requests, bs4' 2>/dev/null; then
  echo "  第一次运行，正在安装依赖…"
  python3 -m pip install --user --quiet requests beautifulsoup4 || {
    echo "  依赖装不上，把上面的报错发给 Claude"
    echo ""
    echo "  按任意键关闭"
    read -k 1
    exit 1
  }
  echo ""
fi

python3 scrape.py
STATUS=$?

echo ""
echo "  ────────────────────────────"

if [ $STATUS -ne 0 ]; then
  echo "  ❌ 抓取失败了，先别上传，把上面的报错发给 Claude"
else
  # 看看有没有待翻译的
  NEW=$(python3 -c "import json; d=json.load(open('data/missing.json')); print(len(d['dishes']) + len(d['stations']))" 2>/dev/null)
  if [ "$NEW" = "0" ]; then
    echo "  ✅ 没有新菜要翻译"
    echo ""
    echo "  下一步：把 data/menu.json 传到 GitHub，手机刷新一下就行"
  else
    echo "  📝 有 $NEW 条新词要翻译"
    echo ""
    echo "  下一步：把 data/missing.json 的内容发给 Claude，"
    echo "         让它按 glossary 格式填好，粘回 data/glossary.json"
    echo "         然后把 menu.json 和 glossary.json 一起传到 GitHub"
    echo ""
    echo "  （回车键可以直接打开 missing.json）"
  fi
fi

echo ""
echo "  按任意键关闭这个窗口"
read -k 1

# 有新词就顺手打开文件
if [ "$NEW" != "0" ] && [ $STATUS -eq 0 ]; then
  open -e data/missing.json 2>/dev/null
fi
