#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null; then echo "需要先安裝 Node.js:https://nodejs.org/ / Please install Node.js first."; read -n 1 -s; exit 1; fi
node leafpile-check.mjs . --slides
echo
read -n 1 -s -p "按任意鍵關閉 / Press any key"
