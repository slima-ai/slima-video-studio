import type { AspectRatio, Workflow } from '@svs/schema'

import { NODE_TYPES, endFramePromptNode, imageEditNode } from './nodes'

export interface EndFrameWorkflowOptions {
  /** 做得到「帶參考圖編輯」的圖片模型。 */
  model: string
  aspectRatio: AspectRatio
  /** 變化編號：再生一張用不同的編號，才不會拿到同一張。 */
  variation: number
  now?: string
}

/** 尾幀的工作流：[組 Prompt（首幀＋角色主圖當參考）→ 帶參考圖的圖片編輯]；輸入 item 是 EndFrameSubject。 */
export function buildEndFrameWorkflow(options: EndFrameWorkflowOptions): Workflow {
  const stamp = options.now ?? new Date().toISOString()
  const at = { x: 0, y: 0 }
  return {
    id: 'shot-end-frame',
    name: 'End frame',
    version: 1,
    createdAt: stamp,
    updatedAt: stamp,
    nodes: [
      { id: 'in', type: '$input', version: 1, params: {}, position: at },
      {
        id: 'prompt',
        type: NODE_TYPES.endFramePrompt,
        version: endFramePromptNode.version,
        params: {},
        position: at,
      },
      {
        id: 'image',
        type: NODE_TYPES.imageEdit,
        version: imageEditNode.version,
        params: { aspectRatio: options.aspectRatio, variation: options.variation },
        modelId: options.model,
        position: at,
      },
      { id: 'out', type: '$output', version: 1, params: {}, position: at },
    ],
    edges: [
      { id: 'e0', from: { nodeId: 'in', port: 'item' }, to: { nodeId: 'prompt', port: 'subject' } },
      {
        id: 'e1',
        from: { nodeId: 'prompt', port: 'prompt' },
        to: { nodeId: 'image', port: 'prompt' },
      },
      {
        id: 'e2',
        from: { nodeId: 'prompt', port: 'references' },
        to: { nodeId: 'image', port: 'references' },
      },
      { id: 'e3', from: { nodeId: 'image', port: 'image' }, to: { nodeId: 'out', port: 'value' } },
    ],
  }
}
