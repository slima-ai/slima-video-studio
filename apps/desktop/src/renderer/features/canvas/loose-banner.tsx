import { Button } from '../../components/button'

/**
 * 有鏡頭不屬於任何場：它們排在最右邊一欄、沒有場框，不會接進成品，卻照樣算進「全部生成」。
 * （從分鏡表頁新增、刪掉場之後都會這樣。）畫布上方提醒，可以一鍵看到它們、或歸進一個場。
 */
export function LooseBanner({
  count,
  sceneName,
  onShow,
  onAssign,
}: {
  count: number
  /** 歸進哪個場（最後一個場）的名字；沒有場就是 undefined，會先建一個新的場。 */
  sceneName: string | undefined
  onShow: () => void
  onAssign: () => void
}) {
  return (
    <div
      data-testid="loose-banner"
      role="status"
      className="absolute left-1/2 top-[68px] z-20 flex max-w-[640px] -translate-x-1/2 items-center gap-3 rounded-xl border border-warning/60 bg-surface-raised px-4 py-2 text-sm shadow-panel"
    >
      <span className="leading-snug">
        有 <b>{count}</b> 個鏡頭還沒歸到任何場：沒歸場的鏡頭不會接進成品（排在最右邊一欄）。
      </span>
      <Button size="sm" variant="secondary" data-testid="loose-show" onClick={onShow}>
        看它們
      </Button>
      <Button size="sm" variant="primary" data-testid="loose-assign" onClick={onAssign}>
        {sceneName === undefined ? '歸進一個新的場' : `歸進「${sceneName}」`}
      </Button>
    </div>
  )
}
