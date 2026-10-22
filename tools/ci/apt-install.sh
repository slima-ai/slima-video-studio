#!/usr/bin/env bash
# CI 裝（小的）系統套件用。GitHub runner 的 Ubuntu 鏡像（azure.archive.ubuntu.com）偶爾會慢到只剩約 40 KB/s，
# 2026-10-22 一天內把 CI 卡住好幾次。ffmpeg 這種大包改走 tools/ci/install-ffmpeg.sh（不用 apt）；這裡只留 e2e 要的幾個小套件。作法：
#   1. --no-install-recommends：不下載建議套件；
#   2. 網路逾時：update 與 install 都帶 Acquire::http::Timeout／Retries，停住的連線會被切掉重連，不是乾等；
#   3. 每一次嘗試都有時間上限（預設 300 秒），失敗或逾時就重試一次（總共 2 次）；已下載好的 .deb 留在 apt 的快取資料夾，
#      重試只補剩下的。
# 用法：bash tools/ci/apt-install.sh <套件…>
set -uo pipefail

ATTEMPT_SECONDS="${APT_ATTEMPT_SECONDS:-300}"
TRIES="${APT_TRIES:-2}"
NET=(-o Acquire::Retries=3 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20)

for ((attempt = 1; attempt <= TRIES; attempt++)); do
  if sudo timeout "$ATTEMPT_SECONDS" apt-get update "${NET[@]}" \
    && sudo timeout "$ATTEMPT_SECONDS" apt-get install -y --no-install-recommends "${NET[@]}" "$@"; then
    echo "已安裝：${*}（第 ${attempt} 次）"
    exit 0
  fi
  echo "::warning::apt 第 $attempt 次失敗或逾時（單次上限 $ATTEMPT_SECONDS 秒）"
done

echo "::error::apt 安裝失敗：$*"
exit 1
