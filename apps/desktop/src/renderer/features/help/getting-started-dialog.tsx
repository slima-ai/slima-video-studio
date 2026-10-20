import { Button } from '../../components/button'
import { Modal } from '../../components/modal'

const STEPS: readonly { title: string; body: readonly string[] }[] = [
  {
    title: '建專案',
    body: [
      '開 App 的首頁、或上方專案名旁邊的 ▾ 選單，選「新專案」，取個名字就開始。',
      '也可以先不建：在畫布上新增任何東西時，會自動建一個。專案會自動儲存，上方一直看得到「已自動儲存」。',
    ],
  },
  {
    title: '在畫布選一種開始方式',
    body: [
      '空白畫布上有三張卡，挑順手的（三個都只是起點，之後隨時能從左邊的「新增」加場、鏡頭、角色、地點，或用「圖片或影片」上傳素材）：',
      '・自己一步一步來：先加一個場和第一個鏡頭，自己寫畫面描述；要生成時再按 ▶。',
      '・貼一段故事：貼上故事，AI 幫你拆成場和鏡頭（分鏡），不生圖片和影片。',
      '・一句話：寫一句話，AI 做出整支短片；按「先產生分鏡」先看分鏡再生成，或按「一次做完整支」一次做完。',
    ],
  },
  {
    title: '生成與匯出',
    body: [
      '按格子上的 ▶，或上方的「全部生成」，生成圖片和影片；花錢之前會先給你看預估，示範模式不花錢。',
      '生成好之後，「剪輯」那一格會出現成品：在那一格按「匯出 MP4」（點開那一格，右邊的成品面板也有）；檔案放在專案的「匯出」資料夾（專案名旁邊的 ▾ 選單 › 在資料夾中顯示）。',
    ],
  },
]

/** 「？」選單裡的「怎麼開始」：三步驟。第二步的名字跟空白畫布三張卡的標題一樣。 */
export function GettingStartedDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal label="怎麼開始" onClose={onClose} testId="getting-started-dialog">
      <div className="flex w-[520px] max-w-full flex-col gap-3 p-5">
        <h2 className="text-base font-semibold">怎麼開始</h2>
        <ol className="space-y-4 text-sm">
          {STEPS.map((step, index) => (
            <li key={step.title} data-testid="getting-started-step" className="flex gap-3">
              <span
                aria-hidden
                className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-fg"
              >
                {index + 1}
              </span>
              <div className="min-w-0 space-y-1">
                <h3 className="font-medium">{step.title}</h3>
                {step.body.map((line) => (
                  <p key={line} className="text-fg-muted">
                    {line}
                  </p>
                ))}
              </div>
            </li>
          ))}
        </ol>
        <div className="flex justify-end">
          <Button variant="primary" onClick={onClose} autoFocus>
            知道了
          </Button>
        </div>
      </div>
    </Modal>
  )
}
