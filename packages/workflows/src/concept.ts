import type { Workflow } from '@svs/schema'

import type { QuickStyleId } from './styles'

import {
  NODE_TYPES,
  conceptPromptNode,
  conceptRefPromptNode,
  imageEditNode,
  imageNode,
  locationAnglePromptNode,
  locationConceptPromptNode,
  turnaroundPromptNode,
} from './nodes'

export interface ConceptWorkflowOptions {
  model: string
  style: QuickStyleId
  /** 這一張的變化編號（不同的編號會得到不同的圖）。 */
  variation: number
  now?: string
}

export interface CharacterConceptWorkflowOptions extends ConceptWorkflowOptions {
  /** 自訂的提示詞範本（設定裡改的）；沒給就用內建預設。 */
  template?: string
  /**
   * 角色有參考圖：改走「帶參考圖的圖片編輯」（照參考圖畫，`model` 要是做得到編輯的模型），
   * 輸入的 subject 要帶 `references`。
   */
  withReferences?: boolean
}

/**
 * 一張概念圖的工作流：[組 Prompt → 圖片]，有參考圖時是 [組 Prompt（帶入參考圖）→ 帶參考圖的圖片編輯]。
 * 一輪的 4 張各用不同的變化編號各跑一次。
 */
export function buildConceptWorkflow(options: CharacterConceptWorkflowOptions): Workflow {
  const stamp = options.now ?? new Date().toISOString()
  const at = { x: 0, y: 0 }
  const template = options.template?.trim() ? { template: options.template } : {}
  const withReferences = options.withReferences === true
  return {
    id: withReferences ? 'character-concept-reference' : 'character-concept',
    name: '角色概念圖',
    version: 1,
    createdAt: stamp,
    updatedAt: stamp,
    nodes: [
      { id: 'in', type: '$input', version: 1, params: {}, position: at },
      withReferences
        ? {
            id: 'prompt',
            type: NODE_TYPES.conceptRefPrompt,
            version: conceptRefPromptNode.version,
            params: { style: options.style, ...template },
            position: at,
          }
        : {
            id: 'prompt',
            type: NODE_TYPES.conceptPrompt,
            version: conceptPromptNode.version,
            params: { style: options.style, ...template },
            position: at,
          },
      withReferences
        ? {
            id: 'image',
            type: NODE_TYPES.imageEdit,
            version: imageEditNode.version,
            params: { aspectRatio: '1:1', variation: options.variation },
            modelId: options.model,
            position: at,
          }
        : {
            id: 'image',
            type: NODE_TYPES.image,
            version: imageNode.version,
            params: { aspectRatio: '1:1', variation: options.variation },
            modelId: options.model,
            position: at,
          },
      { id: 'out', type: '$output', version: 1, params: {}, position: at },
    ],
    edges: [
      { id: 'c0', from: { nodeId: 'in', port: 'item' }, to: { nodeId: 'prompt', port: 'subject' } },
      {
        id: 'c1',
        from: { nodeId: 'prompt', port: 'prompt' },
        to: { nodeId: 'image', port: 'prompt' },
      },
      ...(withReferences
        ? [
            {
              id: 'c3',
              from: { nodeId: 'prompt', port: 'references' },
              to: { nodeId: 'image', port: 'references' },
            },
          ]
        : []),
      { id: 'c2', from: { nodeId: 'image', port: 'image' }, to: { nodeId: 'out', port: 'value' } },
    ],
  }
}

export interface TurnaroundWorkflowOptions {
  /** 支援「帶參考圖編輯」的圖片模型。 */
  model: string
  style: QuickStyleId
  variation: number
  /** 自訂的提示詞範本（設定裡改的）；沒給就用內建預設。 */
  template?: string
  now?: string
}

/** 一組三視圖的工作流：[組 Prompt（帶入主圖）→ 帶參考圖的圖片編輯 → 設定稿]。切圖在工作流之外做。 */
export function buildTurnaroundWorkflow(options: TurnaroundWorkflowOptions): Workflow {
  const stamp = options.now ?? new Date().toISOString()
  const at = { x: 0, y: 0 }
  return {
    id: 'character-turnaround',
    name: '角色三視圖',
    version: 1,
    createdAt: stamp,
    updatedAt: stamp,
    nodes: [
      { id: 'in', type: '$input', version: 1, params: {}, position: at },
      {
        id: 'prompt',
        type: NODE_TYPES.turnaroundPrompt,
        version: turnaroundPromptNode.version,
        params: {
          style: options.style,
          ...(options.template?.trim() ? { template: options.template } : {}),
        },
        position: at,
      },
      {
        id: 'sheet',
        type: NODE_TYPES.imageEdit,
        version: imageEditNode.version,
        params: { aspectRatio: '16:9', variation: options.variation },
        modelId: options.model,
        position: at,
      },
      { id: 'out', type: '$output', version: 1, params: {}, position: at },
    ],
    edges: [
      { id: 't0', from: { nodeId: 'in', port: 'item' }, to: { nodeId: 'prompt', port: 'subject' } },
      {
        id: 't1',
        from: { nodeId: 'prompt', port: 'prompt' },
        to: { nodeId: 'sheet', port: 'prompt' },
      },
      {
        id: 't2',
        from: { nodeId: 'prompt', port: 'references' },
        to: { nodeId: 'sheet', port: 'references' },
      },
      { id: 't3', from: { nodeId: 'sheet', port: 'image' }, to: { nodeId: 'out', port: 'value' } },
    ],
  }
}

/** 一張場景概念圖的工作流：[組 Prompt → 圖片]。一輪的 4 張各用不同的變化編號各跑一次。 */
export function buildLocationConceptWorkflow(options: ConceptWorkflowOptions): Workflow {
  const stamp = options.now ?? new Date().toISOString()
  const at = { x: 0, y: 0 }
  return {
    id: 'location-concept',
    name: '場景概念圖',
    version: 1,
    createdAt: stamp,
    updatedAt: stamp,
    nodes: [
      { id: 'in', type: '$input', version: 1, params: {}, position: at },
      {
        id: 'prompt',
        type: NODE_TYPES.locationConceptPrompt,
        version: locationConceptPromptNode.version,
        params: { style: options.style },
        position: at,
      },
      {
        id: 'image',
        type: NODE_TYPES.image,
        version: imageNode.version,
        params: { aspectRatio: '16:9', variation: options.variation },
        modelId: options.model,
        position: at,
      },
      { id: 'out', type: '$output', version: 1, params: {}, position: at },
    ],
    edges: [
      { id: 'l0', from: { nodeId: 'in', port: 'item' }, to: { nodeId: 'prompt', port: 'subject' } },
      {
        id: 'l1',
        from: { nodeId: 'prompt', port: 'prompt' },
        to: { nodeId: 'image', port: 'prompt' },
      },
      { id: 'l2', from: { nodeId: 'image', port: 'image' }, to: { nodeId: 'out', port: 'value' } },
    ],
  }
}

/** 一個角度的工作流：[組 Prompt（帶入主場景圖）→ 帶參考圖的圖片編輯]。 */
export function buildLocationAngleWorkflow(options: TurnaroundWorkflowOptions): Workflow {
  const stamp = options.now ?? new Date().toISOString()
  const at = { x: 0, y: 0 }
  return {
    id: 'location-angle',
    name: '場景角度',
    version: 1,
    createdAt: stamp,
    updatedAt: stamp,
    nodes: [
      { id: 'in', type: '$input', version: 1, params: {}, position: at },
      {
        id: 'prompt',
        type: NODE_TYPES.locationAnglePrompt,
        version: locationAnglePromptNode.version,
        params: { style: options.style },
        position: at,
      },
      {
        id: 'angle',
        type: NODE_TYPES.imageEdit,
        version: imageEditNode.version,
        params: { aspectRatio: '16:9', variation: options.variation },
        modelId: options.model,
        position: at,
      },
      { id: 'out', type: '$output', version: 1, params: {}, position: at },
    ],
    edges: [
      { id: 'a0', from: { nodeId: 'in', port: 'item' }, to: { nodeId: 'prompt', port: 'subject' } },
      {
        id: 'a1',
        from: { nodeId: 'prompt', port: 'prompt' },
        to: { nodeId: 'angle', port: 'prompt' },
      },
      {
        id: 'a2',
        from: { nodeId: 'prompt', port: 'references' },
        to: { nodeId: 'angle', port: 'references' },
      },
      { id: 'a3', from: { nodeId: 'angle', port: 'image' }, to: { nodeId: 'out', port: 'value' } },
    ],
  }
}
