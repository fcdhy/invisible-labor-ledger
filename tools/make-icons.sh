#!/bin/bash
# 重新生成 PWA 图标：把 tools/*.html 用无头 Chrome 渲染成 PNG
# 用法：bash tools/make-icons.sh
CH="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_WIN="$(cygpath -w "$ROOT/assets/icons" 2>/dev/null || echo "$ROOT/assets/icons")"

shot () { # $1 size  $2 srcfile  $3 outname
  "$CH" --headless=new --disable-gpu --no-sandbox --force-device-scale-factor=1 \
    --hide-scrollbars --window-size="$1,$1" \
    --screenshot="$OUT_WIN\\$3.png" --virtual-time-budget=2500 \
    "file://$ROOT/tools/$2.html" >/dev/null 2>&1
  echo "$3: $(stat -c%s "$ROOT/assets/icons/$3.png" 2>/dev/null) bytes"
}

shot 512 icon-src icon-512
shot 192 icon-src icon-192
shot 512 icon-maskable-src icon-maskable-512
