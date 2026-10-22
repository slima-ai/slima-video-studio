#!/usr/bin/env bash
# CI 裝系統套件用。GitHub runner 的 Ubuntu 鏡像（azure.archive.ubuntu.com）偶爾會慢到下載一個套件要好幾分鐘，
# 2026-10-22 一天內兩次把 unit 拖到 20 分鐘上限被取消（測試根本沒開始）。作法：
#   1. --no-install-recommends：不下載 pocketsphinx、mesa 驅動這類建議套件（這是下載量的大宗）；
#   2. 每一次嘗試都有時間上限（預設 300 秒）；
#   3. 失敗或逾時就重試一次（總共 2 次），還是不行才讓步驟失敗。
# 用法：bash tools/ci/apt-install.sh <套件…>
set -uo pipefail

ATTEMPT_SECONDS="${APT_ATTEMPT_SECONDS:-300}"
TRIES="${APT_TRIES:-2}"

for ((attempt = 1; attempt <= TRIES; attempt++)); do
  if sudo timeout "$ATTEMPT_SECONDS" apt-get update -o Acquire::Retries=3 -o Acquire::http::Timeout=30 \
    && sudo timeout "$ATTEMPT_SECONDS" apt-get install -y --no-install-recommends "$@"; then
    echo "已安裝：$*（第 $attempt 次）"
    exit 0
  fi
  echo "::warning::apt 第 $attempt 次失敗或逾時（單次上限 $ATTEMPT_SECONDS 秒）"
done

echo "::error::apt 安裝失敗：$*"
exit 1
