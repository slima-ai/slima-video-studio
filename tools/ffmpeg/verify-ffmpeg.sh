#!/usr/bin/env bash
# 檢查一支編好的 ffmpeg 可以合法散布、又有預告片要用的東西：沒有 nonfree、有 libx264 與 aac、有 zoompan 與 fade。
# 用法：tools/ffmpeg/verify-ffmpeg.sh <ffmpeg 路徑>
#
# 注意：這裡每一個檢查都先把 ffmpeg 的輸出收進變數，再用 grep 找。不要寫成
# `ffmpeg ... | grep -q ...`：grep -q 一找到就結束，ffmpeg 還在寫的時候會被 SIGPIPE 砍掉（結束碼 141），
# 在 `set -o pipefail` 底下整條管線被當成失敗（#258）；`if ... | grep -q nonfree` 更糟，會把「有 nonfree」誤判成「沒有」。
set -euo pipefail

FFMPEG="${1:?用法：verify-ffmpeg.sh <ffmpeg 路徑>}"

# 把輸出存進變數；ffmpeg 自己失敗就整個停（印出的 stderr 會留給人看）
version="$("$FFMPEG" -hide_banner -version)"
encoders="$("$FFMPEG" -hide_banner -encoders 2>/dev/null)"
filters="$("$FFMPEG" -hide_banner -filters 2>/dev/null)"

if grep -q -- "--enable-nonfree" <<<"$version"; then echo "含 nonfree，不可散布" >&2; exit 1; fi
grep -qE " libx264 " <<<"$encoders" || { echo "沒有 libx264" >&2; exit 1; }
grep -qE " aac " <<<"$encoders" || { echo "沒有 aac" >&2; exit 1; }
# 預告片：靜態鏡頭的運鏡要 zoompan、每段淡入淡出要 fade（afterPack 打包時也會再查一次）
for f in zoompan fade; do
  grep -qE "^ [A-Z.]+ +${f} +" <<<"$filters" || { echo "沒有 ${f} 濾鏡" >&2; exit 1; }
done
