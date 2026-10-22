#!/usr/bin/env bash
# CI 用：安裝固定版號的靜態 FFmpeg 與 ffprobe（Linux x64），不用 apt。
#
# 為什麼：GitHub runner 的 Ubuntu 鏡像（azure.archive.ubuntu.com）偶爾慢到只剩約 40 KB/s，ffmpeg 的 87 個相依套件（約 64 MB）
# 下載不完，2026-10-22 一天內把 CI 卡住好幾次（unit 被 20 分鐘上限取消、測試根本沒開始）。這裡改抓 GitHub release 上
# 固定版號的靜態版，走 GitHub 自己的 CDN。
#
# 來源：https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1（FFmpeg 6.1.1，GPL，ffmpeg-static 這個 npm 套件
# 用的就是它的建置；版本與 Ubuntu 24.04 的 apt 版相同）。下面的 SHA-256 是 GitHub 在 release 頁面公布的檔案雜湊
# （2026-10-23 用 GitHub API 核對）；壓縮檔與解壓後的執行檔各核對一次，不符就失敗。
#
# 裝好之後會跑 `ffmpeg -version`，並確認有 libx264 與 aac 編碼器：缺了就失敗，**不會悄悄退回 apt**。
# 用法：bash tools/ci/install-ffmpeg.sh        （裝到 $HOME/ffmpeg-bin，並加進 PATH）
set -euo pipefail

TAG="${FFMPEG_TAG:-b6.1.1}"
BASE_URL="${FFMPEG_BASE_URL:-https://github.com/eugeneware/ffmpeg-static/releases/download/$TAG}"
DEST="${FFMPEG_DEST:-$HOME/ffmpeg-bin}"

FFMPEG_GZ_SHA256="${FFMPEG_GZ_SHA256:-bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dffa}"
FFMPEG_SHA256="${FFMPEG_SHA256:-e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99}"
FFPROBE_GZ_SHA256="${FFPROBE_GZ_SHA256:-25d9b6ccb05e3d9de9e04e31e2506d8dd7f9f0418981965ac6df12e8d3afd067}"
FFPROBE_SHA256="${FFPROBE_SHA256:-4f231a1960d83e403d08f7971e271707bec278a9ae18e21b8b5b03186668450d}"

fail() {
  echo "::error::$*"
  exit 1
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

check_sha256() { # <檔案> <預期雜湊> <說明>
  local actual
  actual="$(sha256_of "$1")"
  [ "$actual" = "$2" ] || fail "$3的 SHA-256 不符：預期 $2，實際 $actual"
}

install_tool() { # <名稱 ffmpeg|ffprobe> <壓縮檔預期雜湊> <解壓後預期雜湊>
  local name="$1" gz_sha="$2" bin_sha="$3" gz="$DEST/$1.gz"
  curl --fail --location --silent --show-error \
    --retry "${FFMPEG_CURL_RETRY:-3}" --retry-delay 5 --retry-all-errors --connect-timeout 20 --max-time 240 \
    -o "$gz" "$BASE_URL/$name-linux-x64.gz" || fail "下載 $name 失敗（$BASE_URL/$name-linux-x64.gz）"
  check_sha256 "$gz" "$gz_sha" "$name 壓縮檔"
  gunzip -f "$gz"
  check_sha256 "$DEST/$name" "$bin_sha" "$name 執行檔"
  chmod +x "$DEST/$name"
}

mkdir -p "$DEST"
install_tool ffmpeg "$FFMPEG_GZ_SHA256" "$FFMPEG_SHA256"
install_tool ffprobe "$FFPROBE_GZ_SHA256" "$FFPROBE_SHA256"

"$DEST/ffmpeg" -hide_banner -version | head -n 1
encoders="$("$DEST/ffmpeg" -hide_banner -encoders)"
for encoder in libx264 aac; do
  grep -Eq "^ [VASD.]+ +$encoder( |$)" <<<"$encoders" || fail "這個 ffmpeg 沒有 $encoder 編碼器"
done

if [ -n "${GITHUB_PATH:-}" ]; then
  echo "$DEST" >> "$GITHUB_PATH"
fi
echo "已安裝 ffmpeg 與 ffprobe（${TAG}）到 ${DEST}"
