#!/usr/bin/env bash
# 取得「固定來源」的 Windows FFmpeg（x64）：gyan.dev 的 6.1.1 essentials build（GPL v3，沒有 nonfree），
# 用 GitHub 鏡像的固定發佈檔，核對 SHA-256，放進 apps/desktop/build/ffmpeg/win-x64/，旁邊附授權全文與來源說明。
# 這個執行檔就是 ffmpeg-static 目前附的那個（兩邊的 ffmpeg.exe SHA-256 相同，2026-10-19 核對）；固定下來之後，
# 安裝檔不再依賴 ffmpeg-static 在安裝當下下載什麼。
#
# 注意：這是別人編的執行檔，不是我們自己編的（macOS 版才是）。它靜態連結約 35 個第三方函式庫，
# 其中有 GPL 的 x264、x265、xvid；這些函式庫的「對應原始碼」我們沒有提供，見 SOURCE.txt 與 tools/ffmpeg/README.md。
#
# 用法：tools/ffmpeg/fetch-windows.sh [輸出資料夾，預設 apps/desktop/build/ffmpeg/win-x64]
# 需要：curl、tar（macOS／Linux／Windows 10 以後內建的 tar 都能解 zip）、shasum 或 sha256sum。
set -euo pipefail

VERSION="6.1.1"
ZIP_URL="https://github.com/GyanD/codexffmpeg/releases/download/${VERSION}/ffmpeg-${VERSION}-essentials_build.zip"
ZIP_SHA256="742e32fc9f92681f9f254b925e1b613fdd8074ba40749d4879aefdb009b94cc5"
EXE_SHA256="04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00"
FFMPEG_COMMIT="e38092ef93" # gyan.dev 的發佈說明寫的 FFmpeg 原始碼 commit

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-$ROOT/apps/desktop/build/ffmpeg/win-x64}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/svs-ffmpeg-win.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

echo "== 下載 gyan.dev ffmpeg ${VERSION} essentials，核對 SHA-256"
curl -fsSL -o "$WORK/ffmpeg.zip" "$ZIP_URL"
[ "$(sha256 "$WORK/ffmpeg.zip")" = "$ZIP_SHA256" ] || { echo "zip 的 SHA-256 不符" >&2; exit 1; }
tar -xf "$WORK/ffmpeg.zip" -C "$WORK"
SRC="$WORK/ffmpeg-${VERSION}-essentials_build"
[ "$(sha256 "$SRC/bin/ffmpeg.exe")" = "$EXE_SHA256" ] || { echo "ffmpeg.exe 的 SHA-256 不符" >&2; exit 1; }

mkdir -p "$OUT"
cp "$SRC/bin/ffmpeg.exe" "$OUT/ffmpeg.exe"
cp "$SRC/LICENSE" "$OUT/COPYING.GPLv3"
cp "$SRC/README.txt" "$OUT/README-gyan.txt"
cat >"$OUT/SOURCE.txt" <<TXT
This FFmpeg binary (ffmpeg.exe) is a third-party build, NOT built by Slima:
  FFmpeg ${VERSION} "essentials" 64-bit static Windows build from www.gyan.dev (GNU GPL v3)
  Download:  ${ZIP_URL}
  SHA-256 of the archive:     ${ZIP_SHA256}
  SHA-256 of ffmpeg.exe:      ${EXE_SHA256}
  FFmpeg source commit (as stated by the builder): https://github.com/FFmpeg/FFmpeg/commit/${FFMPEG_COMMIT}
  Build configuration: run "ffmpeg.exe -version" (it lists the enabled libraries; no --enable-nonfree).
  Builder's notes: README-gyan.txt (next to this file).
The binary statically links a number of third-party libraries (for example libx264, libx265 and xvid, which are GPL).
FFmpeg's own source is at the commit above; the sources of the statically linked libraries are the upstream projects named
in the configuration. Slima does not host a copy of those sources. See THIRD-PARTY-NOTICES.md and tools/ffmpeg/README.md
in the Slima Video Studio repository for the current status of this obligation.
TXT
echo "完成：$OUT"
ls -l "$OUT"
