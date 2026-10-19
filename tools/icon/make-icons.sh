#!/usr/bin/env bash
# 從小饅頭素材做 App 圖示：1024×1024 PNG（macOS 慣例：824 的圓角方塊、四周留邊、淡陰影）、.icns、.ico、Linux 用的 512 PNG。
# 需要 ImageMagick（magick）與 macOS 的 iconutil。用法：tools/icon/make-icons.sh <素材 png> <輸出資料夾>
set -euo pipefail
SRC="$1"; OUT="$2"; W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
mkdir -p "$OUT"
# 1. 只留最大的一塊（小饅頭本體），去掉彩帶、愛心等小東西
magick "$SRC" -alpha extract -threshold 8% -define connected-components:keep-top=1 -connected-components 8 -alpha off -depth 16 -fill white +opaque black -morphology Dilate Disk:1 -blur 0x0.8 "$W/mask.png"
# 原圖的本體是半透明的蠟筆色：墊在小饅頭的奶油黃上變成不透明，再套上柔邊的遮罩
magick "$SRC" -background '#F5DA77' -alpha remove -alpha off "$W/flat.png"
magick "$W/flat.png" "$W/mask.png" -alpha off -compose CopyOpacity -composite -trim +repage "$W/body.png"
# 2. 圓角方塊底：824×824、半徑 185，垂直漸層（淺天藍）
magick -size 824x824 gradient:'#D6EBF8'-'#F4F9FC' "$W/bg.png"
magick -size 824x824 xc:none -fill white -draw "roundrectangle 0,0 823,823 185,185" "$W/round.png"
magick "$W/round.png" -alpha extract "$W/round-mask.png"
magick "$W/bg.png" -alpha off "$W/round-mask.png" -compose CopyOpacity -composite "$W/tile.png"
# 3. 小饅頭放大、放中間偏下（寬約 560），腳下一圈淡淡的影子
magick "$W/body.png" -filter Lanczos -resize 560x "$W/body-big.png"
magick -size 560x70 xc:none -fill 'rgba(120,90,40,0.22)' -draw "ellipse 280,35 240,24 0,360" -blur 0x10 "$W/shadow.png"
magick "$W/tile.png" "$W/shadow.png" -gravity center -geometry +0+215 -compose Over -composite "$W/body-big.png" -gravity center -geometry +0+25 -compose Over -composite "$W/tile2.png"
# 4. 1024 畫布：方塊置中，下方一層淡淡的陰影
magick "$W/tile.png" -alpha extract -background black -gravity center -extent 1024x1024 -blur 0x18 "$W/sha.png"
magick -size 1024x1024 xc:black "$W/sha.png" -alpha off -compose CopyOpacity -composite -channel A -evaluate multiply 0.30 +channel "$W/sh.png"
magick -size 1024x1024 xc:none "$W/sh.png" -gravity center -geometry +0+14 -compose Over -composite "$W/tile2.png" -gravity center -geometry +0+0 -compose Over -composite "$OUT/icon.png"
# 5. 其他格式
magick "$OUT/icon.png" -resize 512x512 "$OUT/icon-512.png"
IS="$W/icon.iconset"; mkdir -p "$IS"
for s in 16 32 128 256 512; do
  magick "$OUT/icon.png" -resize ${s}x${s} "$IS/icon_${s}x${s}.png"
  magick "$OUT/icon.png" -resize $((s*2))x$((s*2)) "$IS/icon_${s}x${s}@2x.png"
done
iconutil -c icns "$IS" -o "$OUT/icon.icns"
# Windows 的圖示不留邊：把 824 方塊裁出來（含一點邊）再做多尺寸 ico
magick "$OUT/icon.png" -gravity center -crop 880x880+0+0 +repage "$W/win.png"
magick "$W/win.png" -define icon:auto-resize=256,128,64,48,32,24,16 "$OUT/icon.ico"
echo "完成：$OUT/icon.png icon-512.png icon.icns icon.ico"
