#!/usr/bin/env bash
# 從原始碼編出「可以合法再散布」的 FFmpeg（macOS）：GPL v2+，只開 libx264，沒有 nonfree。
#
# 為什麼要自己編：ffmpeg-static 下載的 macOS 版是用 --enable-nonfree 編的，FFmpeg 說明這種版本
# 「不可合法再散布」，不能放進公開下載的安裝檔。這支腳本只用官方原始碼與固定版本，任何人都能重現。
#
# 用法：tools/ffmpeg/build-macos.sh [輸出資料夾，預設 apps/desktop/build/ffmpeg/<arch>]
# 只需要 Xcode Command Line Tools（clang、make）、curl、git、shasum；arm64 不需要 nasm。
# Intel（x86_64）要先裝 nasm，並在 Intel 的機器（例如 GitHub 的 macos-13 runner）上跑。
set -euo pipefail

FFMPEG_VERSION="6.1.1"
FFMPEG_SHA256="8684f4b00f94b85461884c3719382f1261f0d9eb3d59640a1f4ac0873616f968"
FFMPEG_URL="https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz"
X264_URL="https://code.videolan.org/videolan/x264.git"
X264_COMMIT="b35605ace3ddf7c1a5d67a2eb553f034aef41d55" # x264 stable 分支，2026-10-19 取得

ARCH="$(uname -m)"
case "$ARCH" in arm64) DIR_ARCH=arm64 ;; x86_64) DIR_ARCH=x64 ;; *) echo "不支援的架構：$ARCH" >&2; exit 1 ;; esac
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-$ROOT/apps/desktop/build/ffmpeg/$DIR_ARCH}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/svs-ffmpeg.XXXXXX")"
JOBS="${JOBS:-8}" # 同一台機器上最多 8 個平行工作
trap 'rm -rf "$WORK"' EXIT

echo "== 下載 FFmpeg ${FFMPEG_VERSION}，核對 SHA-256"
curl -fsSL -o "$WORK/ffmpeg.tar.xz" "$FFMPEG_URL"
echo "${FFMPEG_SHA256}  $WORK/ffmpeg.tar.xz" | shasum -a 256 -c -
if command -v gpg >/dev/null 2>&1; then
  # 簽章：FFmpeg 發行金鑰（只是確認檔案與官方發行相符；金鑰本身的信任鏈沒有另外驗證）
  curl -fsSL -o "$WORK/ffmpeg.tar.xz.asc" "${FFMPEG_URL}.asc"
  curl -fsSL -o "$WORK/ffmpeg-devel.asc" "https://ffmpeg.org/ffmpeg-devel.asc"
  mkdir -p "$WORK/gnupg" && chmod 700 "$WORK/gnupg"
  GNUPGHOME="$WORK/gnupg" gpg --batch --quiet --import "$WORK/ffmpeg-devel.asc"
  GNUPGHOME="$WORK/gnupg" gpg --batch --verify "$WORK/ffmpeg.tar.xz.asc" "$WORK/ffmpeg.tar.xz"
fi
tar -xf "$WORK/ffmpeg.tar.xz" -C "$WORK"

echo "== 取得 x264（固定 commit ${X264_COMMIT:0:7}）"
git clone --quiet "$X264_URL" "$WORK/x264"
git -C "$WORK/x264" checkout --quiet "$X264_COMMIT"

PREFIX="$WORK/prefix"
mkdir -p "$PREFIX"
echo "== 編譯 x264（靜態）"
(cd "$WORK/x264" && ./configure --prefix="$PREFIX" --enable-static --disable-cli --disable-opencl --enable-pic >/dev/null && make -j"$JOBS" >/dev/null && make install >/dev/null)

echo "== 編譯 FFmpeg（GPL，只開 libx264，不含 nonfree）"
(cd "$WORK/ffmpeg-${FFMPEG_VERSION}" &&
  PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig" ./configure \
    --prefix="$WORK/out" --pkg-config-flags=--static \
    --extra-cflags="-I$PREFIX/include" --extra-ldflags="-L$PREFIX/lib" \
    --enable-gpl --enable-libx264 \
    --disable-ffplay --disable-ffprobe --disable-doc --disable-debug \
    --enable-static --disable-shared --disable-autodetect \
    --enable-videotoolbox --enable-audiotoolbox --enable-zlib >/dev/null &&
  make -j"$JOBS" >/dev/null)

mkdir -p "$OUT"
cp "$WORK/ffmpeg-${FFMPEG_VERSION}/ffmpeg" "$OUT/ffmpeg"
chmod 755 "$OUT/ffmpeg"
# 授權全文與「對應原始碼」的取得方式一起放在執行檔旁邊（GPL 義務）
cp "$WORK/ffmpeg-${FFMPEG_VERSION}/COPYING.GPLv3" "$OUT/COPYING.GPLv3"
cp "$WORK/ffmpeg-${FFMPEG_VERSION}/COPYING.GPLv2" "$OUT/COPYING.GPLv2"
cat >"$OUT/SOURCE.txt" <<TXT
This FFmpeg binary was built from the unmodified sources below (GPL v2 or later, libx264 only, no nonfree code):
  FFmpeg ${FFMPEG_VERSION}  ${FFMPEG_URL}  (SHA-256 ${FFMPEG_SHA256})
  x264 (GPL v2 or later)    ${X264_URL}  commit ${X264_COMMIT}
Build script: tools/ffmpeg/build-macos.sh in the Slima Video Studio repository.
TXT

echo "== 驗證"
"$OUT/ffmpeg" -hide_banner -version | head -1
"$OUT/ffmpeg" -hide_banner -L 2>&1 | head -2
if "$OUT/ffmpeg" -hide_banner -version | grep -q -- "--enable-nonfree"; then echo "含 nonfree，不可散布" >&2; exit 1; fi
"$OUT/ffmpeg" -hide_banner -encoders 2>/dev/null | grep -qE " libx264 " || { echo "沒有 libx264" >&2; exit 1; }
"$OUT/ffmpeg" -hide_banner -encoders 2>/dev/null | grep -qE " aac " || { echo "沒有 aac" >&2; exit 1; }
echo "完成：$OUT/ffmpeg"
