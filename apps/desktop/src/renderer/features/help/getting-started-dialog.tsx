import { Button } from '../../components/button'
import { Modal } from '../../components/modal'
import { msg, t, type MessageRef } from '@svs/schema'

const STEPS: readonly { title: MessageRef; body: readonly MessageRef[] }[] = [
  {
    title: msg('help.step1.title'),
    body: [msg('help.step1.menu'), msg('help.step1.auto')],
  },
  {
    title: msg('help.step2.title'),
    body: [
      msg('help.step2.intro'),
      msg('help.step2.manual'),
      msg('help.step2.story'),
      msg('help.step2.sentence'),
    ],
  },
  {
    title: msg('help.step3.title'),
    body: [msg('help.step3.generate'), msg('help.step3.export')],
  },
]

/** 「？」選單裡的「怎麼開始」：三步驟。第二步的名字跟空白畫布三張卡的標題一樣。 */
export function GettingStartedDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal label={t('help.title')} onClose={onClose} testId="getting-started-dialog">
      <div className="flex w-[520px] max-w-full flex-col gap-3 p-5">
        <h2 className="text-base font-semibold">{t('help.title')}</h2>
        <ol className="space-y-4 text-sm">
          {STEPS.map((step, index) => (
            <li key={step.title.msgKey} data-testid="getting-started-step" className="flex gap-3">
              <span
                aria-hidden
                className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-fg"
              >
                {index + 1}
              </span>
              <div className="min-w-0 space-y-1">
                <h3 className="font-medium">{t(step.title)}</h3>
                {step.body.map((line) => (
                  <p key={line.msgKey} className="text-fg-muted">
                    {t(line)}
                  </p>
                ))}
              </div>
            </li>
          ))}
        </ol>
        <div className="flex justify-end">
          <Button variant="primary" onClick={onClose} autoFocus>
            {t('help.gotIt')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
