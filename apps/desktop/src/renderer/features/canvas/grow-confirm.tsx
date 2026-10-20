import { useState } from 'react'

import { isMac } from '../../lib/history'
import type { GrowConfirm as Pending } from './use-grow'
import { RunConfirm } from './run-confirm'

/**
 * 一句話的花費確認。「先產生分鏡」用白話分兩段說：這一步只寫分鏡約多少錢、下一步才生圖片和影片約多少錢；
 * 「一次做完整支」列出每一步。列出會做什麼；專案裡已有內容時，可以選刪掉現有內容重新生成，
 * 勾了就說清楚會刪掉幾個場、幾個鏡頭，以及可以用「復原」全部找回來。
 */
export function GrowConfirm({
  pending,
  onOk,
  onCancel,
}: {
  pending: Pending
  onOk: (replace: boolean) => void
  onCancel: () => void
}) {
  const [replace, setReplace] = useState(false)
  const { params, check } = pending
  const n = params.shotCount
  const storyboard = pending.stage === 'storyboard'
  const models = [check.models.llm, check.models.image, check.models.video].filter(
    (name): name is string => name !== undefined,
  )
  return (
    <RunConfirm
      anchor={pending.anchor}
      count={storyboard ? 1 : 1 + n * 3}
      title={
        replace
          ? '刪掉現有內容，重新' + (storyboard ? '產生分鏡' : '生成')
          : storyboard
            ? '先產生分鏡'
            : '一次做完整支短片'
      }
      lines={
        storyboard
          ? [
              `這一步只寫分鏡：把故事拆成 ${String(n)} 個鏡頭，約 US$${check.estimatedUsd.toFixed(2)}（只用文字模型）`,
              pending.nextUsd === undefined
                ? '下一步才生圖片和影片'
                : `下一步才生圖片和影片：${String(n)} 張第一張畫面、${String(n)} 支影片，約 US$${pending.nextUsd.toFixed(2)}`,
              '分鏡寫好後你可以先看、先改，要生成時再按右上角的「全部生成」，那裡會給準確的預估',
              '旁白與配樂也不在這一步：卡片上勾的聲音會記住，按「全部生成」時自動加',
              ...(check.models.llm === undefined ? [] : [`這一步用：${check.models.llm}`]),
              ...(check.demoMode ? ['示範模式：不會真的花錢，結果是假的'] : []),
            ]
          : [
              `寫分鏡：拆成 ${String(n)} 個鏡頭`,
              `${String(n)} 張第一張畫面`,
              `${String(n)} 支影片（每支 ${String(params.durationSec)} 秒）`,
              '接成一支完整的片子',
              ...(models.length > 0 ? [`用：${models.join('、')}`] : []),
              ...(check.demoMode ? ['示範模式：不會真的花錢，結果是假的'] : []),
            ]
      }
      costUsd={check.estimatedUsd}
      lowerBound={check.estimateIsLowerBound}
      {...(storyboard ? { costLabel: '這一步預估約', cachedNote: false } : {})}
      okLabel={replace ? '刪掉並生成' : storyboard ? '產生分鏡' : '全部做完'}
      danger={replace}
      extra={
        pending.hasContent ? (
          <div className="flex flex-col gap-2 text-sm">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                data-testid="grow-replace"
                checked={replace}
                className="mt-0.5"
                onChange={(event) => {
                  setReplace(event.target.checked)
                }}
              />
              <span>
                刪掉現有的內容，重新生成
                {replace ? null : (
                  <small className="block text-fg-muted">
                    不勾：新的鏡頭放進新的一場，接在現有內容後面，原本的都不動。
                  </small>
                )}
              </span>
            </label>
            {replace ? (
              <div
                data-testid="grow-replace-warning"
                className="rounded-lg border border-danger/50 bg-danger/10 px-3 py-2 text-fg"
              >
                <p className="font-semibold text-danger">
                  會刪掉 {String(pending.existing.scenes)} 個場、
                  {String(pending.existing.shots)} 個鏡頭
                </p>
                <p className="mt-0.5 text-fg-muted">
                  連同它們的圖、影片和大綱一起刪掉；角色和地點會留著。
                </p>
                <p className="mt-0.5 text-fg-muted">
                  生成後想回到原本的樣子：按上方的「復原」（{isMac() ? '⌘Z' : 'Ctrl+Z'}
                  ），刪掉的內容會全部回來。
                </p>
              </div>
            ) : null}
          </div>
        ) : null
      }
      onOk={() => {
        onOk(replace)
      }}
      onCancel={onCancel}
    />
  )
}
