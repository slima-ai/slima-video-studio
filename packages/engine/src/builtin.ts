import { WorkflowSchema, type Workflow, t } from '@svs/schema'
import { z } from 'zod'

import { AppError } from '@svs/schema'
import { defineNode, NodeRegistry } from './node'

export const INPUT_NODE = '$input'
export const OUTPUT_NODE = '$output'
export const FOR_EACH_NODE = 'forEach'

/**
 * 子工作流的入口：把這次執行的外部輸入（item、index）變成輸出。
 * 輸出取決於外部輸入、不在快取鍵裡，所以本身不能快取；下游的快取鍵會用它輸出的雜湊，內容相同照樣命中。
 */
const inputNode = defineNode({
  type: INPUT_NODE,
  version: 1,
  inputs: {},
  outputs: { item: 'json', index: 'json' },
  params: z.object({}),
  cacheable: false,
  run: ({ runInputs }) => ({ item: runInputs.item ?? null, index: runInputs.index ?? null }),
})

/** 子工作流的出口：收到的值就是這個子 Run 的結果。 */
const outputNode = defineNode({
  type: OUTPUT_NODE,
  version: 1,
  inputs: { value: { type: 'json' } },
  outputs: { value: 'json' },
  params: z.object({}),
  run: ({ inputs }) => ({ value: inputs.value ?? null }),
})

export const ForEachParamsSchema = z.object({
  /** 對每個項目執行的子工作流；必須有一個 `$input` 與一個 `$output` 節點。 */
  body: WorkflowSchema,
  /** 同時處理幾個項目。 */
  concurrency: z.number().int().positive().default(4),
})

/**
 * 「對每個項目執行」：把 items 的每一項交給 body 子工作流，各自成為一個子 Run，
 * 結果依原順序收集成陣列。子 Run 的節點各自走快取，所以只改一個項目就只會重跑那一個。
 * 這個節點本身不快取（每次都要展開），省下的工作由子節點的快取達成。
 */
const forEachNode = defineNode({
  type: FOR_EACH_NODE,
  version: 1,
  inputs: { items: { type: 'json' } },
  outputs: { results: 'json' },
  params: ForEachParamsSchema,
  cacheable: false,
  run: async ({ params, inputs, runSub, signal }) => {
    const items = inputs.items
    if (!Array.isArray(items)) {
      throw new AppError({
        code: 'invalid_request',
        userMessage: t('errors.forEachItemNeedsA'),
      })
    }
    const results: unknown[] = new Array<unknown>(items.length)
    let next = 0
    let failed = 0
    const worker = async (): Promise<void> => {
      while (next < items.length && !signal.aborted) {
        const index = next++
        const sub = await runSub(params.body, { item: items[index], index }, String(index))
        if (sub.status === 'succeeded') results[index] = sub.result ?? null
        else failed++
      }
    }
    await Promise.all(Array.from({ length: Math.min(params.concurrency, items.length) }, worker))
    if (signal.aborted)
      throw new AppError({ code: 'cancelled', userMessage: t('errors.cancelled') })
    if (failed > 0) {
      throw new AppError({
        code: 'node_failed',
        userMessage: t('errors.ofItemsFailed', {
          value: String(failed),
          value2: String(items.length),
        }),
      })
    }
    return { results }
  },
})

/** 引擎內建的節點。 */
export function createRegistry(): NodeRegistry {
  return new NodeRegistry().register(inputNode).register(outputNode).register(forEachNode)
}

/** 檢查子工作流的出入口，並回傳（供 forEach 驗證用）。 */
export function checkBody(body: Workflow): string | undefined {
  const inputs = body.nodes.filter((n) => n.type === INPUT_NODE).length
  const outputs = body.nodes.filter((n) => n.type === OUTPUT_NODE).length
  if (inputs !== 1)
    return t('errors.aSubWorkflowMustHave', { inputNode: INPUT_NODE, value: String(inputs) })
  if (outputs !== 1)
    return t('errors.aSubWorkflowMustHave2', { outputNode: OUTPUT_NODE, value: String(outputs) })
  return undefined
}
