#!/usr/bin/env bash
# CI 裝系統套件用。GitHub runner 的 Ubuntu 鏡像（azure.archive.ubuntu.com）偶爾會慢到下載一個套件要好幾分鐘，
# 2026-10-22 一天內三次把 CI 卡住（兩次 unit 被 20 分鐘上限取消、測試根本沒開始；一次 e2e-linux 在 300 秒上限內下載不完）。作法：
#   1. --no-install-recommends：不下載 pocketsphinx、mesa 驅動這類建議套件（下載量的大宗）；
#   2. 網路逾時：update 與 install 都帶 Acquire::http::Timeout／Retries，停住的連線會被切掉重連，不是乾等；
#   3. 每一次嘗試都有時間上限（預設 300 秒），失敗或逾時就重試一次（總共 2 次）；已下載好的 .deb 留在 apt 的快取資料夾，
#      重試只補剩下的；
#   4. 可選的 .deb 快取（APT_DEB_CACHE 指到一個資料夾，CI 用 actions/cache 保存）：下載過的套件下一次直接用，不再碰鏡像。
# 用法：[APT_DEB_CACHE=<資料夾>] bash tools/ci/apt-install.sh <套件…>
set -uo pipefail

ATTEMPT_SECONDS="${APT_ATTEMPT_SECONDS:-300}"
TRIES="${APT_TRIES:-2}"
ARCHIVES="${APT_ARCHIVES_DIR:-/var/cache/apt/archives}"
CACHE="${APT_DEB_CACHE:-}"
NET=(-o Acquire::Retries=3 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20)

# 先把快取裡的 .deb 放回 apt 的快取資料夾（版本與雜湊對得上的 apt 就不會再下載）
if [ -n "$CACHE" ] && compgen -G "$CACHE/*.deb" >/dev/null; then
  echo "從快取放回 $(ls "$CACHE"/*.deb | wc -l | tr -d ' ') 個 .deb"
  sudo cp -n "$CACHE"/*.deb "$ARCHIVES"/
fi

for ((attempt = 1; attempt <= TRIES; attempt++)); do
  if sudo timeout "$ATTEMPT_SECONDS" apt-get update "${NET[@]}" \
    && sudo timeout "$ATTEMPT_SECONDS" apt-get install -y --no-install-recommends "${NET[@]}" "$@"; then
    echo "已安裝：$*（第 $attempt 次）"
    if [ -n "$CACHE" ]; then
      mkdir -p "$CACHE"
      if compgen -G "$ARCHIVES/*.deb" >/dev/null; then
        sudo cp -n "$ARCHIVES"/*.deb "$CACHE"/
        sudo chown -R "$(id -u):$(id -g)" "$CACHE"
      fi
    fi
    exit 0
  fi
  echo "::warning::apt 第 $attempt 次失敗或逾時（單次上限 $ATTEMPT_SECONDS 秒）"
done

echo "::error::apt 安裝失敗：$*"
exit 1
