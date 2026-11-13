import { t } from '@svs/schema'

/** 捲到設定頁的某一區（跟頂端的小標籤一樣的做法）。 */
export function jumpToArea(id: string): void {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/**
 * 兩張名字很像的卡（單次花費上限／AI 工具的總額度）互相指到對方：一句話說「另一個額度也存在」，旁邊一個「前往」（不再把頁籤和卡名念一遍）。
 * 第一次用的人才不會把總額度填進單次上限（反過來也一樣）。
 */
export function AreaPointer({
  text,
  targetId,
  testId,
}: {
  text: string
  targetId: string
  testId: string
}) {
  return (
    <p className="mt-2 text-xs text-fg-muted" data-testid={testId}>
      {text}{' '}
      <button
        type="button"
        className="font-medium text-accent underline underline-offset-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
        onClick={() => {
          jumpToArea(targetId)
        }}
      >
        {t('settings.goThere')}
      </button>
    </p>
  )
}
