import {
  type AspectRatio,
  type AssetRef,
  type Workflow,
  type WorkflowEdge,
  type WorkflowNode,
} from '@svs/schema'

import {
  NODE_TYPES,
  breakdownNode,
  fixedImageNode,
  imageNode,
  shotPromptNode,
  videoNode,
  type CharacterAnchor,
  type CharacterAvoid,
  type SceneAnchor,
} from './nodes'
import type { QuickStyleId } from './styles'

export interface QuickStartOptions {
  /** 使用者寫的故事或一句話。 */
  story: string
  style: QuickStyleId
  /** 拆成幾個鏡頭。 */
  shotCount: number
  /** 每個鏡頭幾秒。 */
  durationSec: number
  aspectRatio: AspectRatio
  /** 各步驟用的模型（ModelCard id）。 */
  models: { llm: string; image: string; video: string }
  /** 想換一批結果時改這個數字（拆鏡、首幀、影片都會重新生成）。 */
  variation?: number
  audio?: boolean
  /** 影片的負面提示（見 ShotWorkflowOptions.negativePrompt）。 */
  negativePrompt?: string
  /** 各角色的「不要出現的特徵」（見 ShotWorkflowOptions.characterAvoids）。 */
  characterAvoids?: readonly CharacterAvoid[]
  /** 已鎖定角色的固定外觀描述；出場的角色對得上名字就帶進每個 Prompt。 */
  anchors?: readonly CharacterAnchor[]
  /** 專案裡已經建好的角色名字（不管有沒有鎖定）：拆鏡時請 AI 用一模一樣的名字。 */
  knownCharacters?: readonly string[]
  /** 分鏡準則：拆鏡時一併交給 AI 的做法；沒給就不附。 */
  storyboardGuide?: string
  /** 見 ShotWorkflowOptions.editModel。 */
  editModel?: { id: string; referenceLimit: number }
  /** 一句話勾了「旁白」：拆鏡時每一鏡另外寫一句旁白台詞；沒給（或 false）就不寫。 */
  narration?: boolean
  /** 只拆鏡（文字模型）：不生成圖片和影片、不接片。之後的步驟用畫布的「生成」補上。 */
  storyboardOnly?: boolean
  /** 工作流的 id 與時間戳（測試要固定時傳入）。 */
  id?: string
  now?: string
}

export const QUICK_START_IDS = { breakdown: 'breakdown', each: 'each', join: 'join' } as const

const node = (
  id: string,
  type: string,
  params: Record<string, unknown> = {},
  modelId?: string,
  version = 1,
): WorkflowNode => ({
  id,
  type,
  version,
  params,
  ...(modelId ? { modelId } : {}),
  position: { x: 0, y: 0 },
})

const edge = (id: string, from: [string, string], to: [string, string]): WorkflowEdge => ({
  id,
  from: { nodeId: from[0], port: from[1] },
  to: { nodeId: to[0], port: to[1] },
})

export interface ShotWorkflowOptions {
  style: QuickStyleId
  durationSec: number
  aspectRatio: AspectRatio
  models: { image: string; video: string }
  /** 首幀圖的變化編號；改這個只會重生首幀（影片因為輸入變了也會跟著重生）。 */
  imageVariation?: number
  /** 影片的變化編號；改這個只會重生影片，首幀沿用。 */
  videoVariation?: number
  audio?: boolean
  /** 影片的負面提示（使用者在設定頁改過的）；沒給或空字串就用各模型內建的清單。 */
  negativePrompt?: string
  /** 各角色的「不要出現的特徵」（只列有寫的）；出場角色的清單會併進影片的負面提示。 */
  characterAvoids?: readonly CharacterAvoid[]
  anchors?: readonly CharacterAnchor[]
  /** 已鎖定的場景卡；鏡頭指定的地點對得上，就帶入場景描述與參考圖。 */
  scenes?: readonly SceneAnchor[]
  /**
   * 有「帶參考圖編輯」的圖片模型時傳入：鏡頭有已鎖定角色的參考圖，首幀就用它編輯出來，
   * 參考圖張數不超過 referenceLimit。沒傳就一律純文字生圖。
   */
  editModel?: { id: string; referenceLimit: number }
  /**
   * 手動指定的參考圖（依序；name 是給圖片模型看的說明，例如「阿鐵的臉」）：有指定就只帶這幾張，
   * 不再自動挑；要搭配 editModel（沒有做得到編輯的圖片模型就帶不了）。
   */
  pinned?: readonly { ref: AssetRef; name: string }[]
  /** 鏡頭接了一張上傳的圖：不生圖，直接用它生影片（「image」節點換成固定的圖）。 */
  firstFrame?: AssetRef
  now?: string
}

/** 單一鏡頭的子流程：[組 Prompt → 首幀圖 → 圖生影片]。快速開始的「對每個鏡頭執行」與單鏡重生共用。 */
export function buildShotWorkflow(options: ShotWorkflowOptions): Workflow {
  const stamp = options.now ?? new Date().toISOString()
  return {
    id: 'quickstart-shot',
    name: '單鏡頭',
    version: 1,
    createdAt: stamp,
    updatedAt: stamp,
    nodes: [
      node('in', '$input'),
      node(
        'prompt',
        NODE_TYPES.shotPrompt,
        {
          style: options.style,
          anchors: options.anchors ?? [],
          scenes: options.scenes ?? [],
          ...(options.editModel ? { referenceLimit: options.editModel.referenceLimit } : {}),
          ...(options.pinned && options.pinned.length > 0 ? { pinned: options.pinned } : {}),
          // 沒有任何角色寫了就不放進參數，節點參數（與快取）和以前一樣
          ...(options.characterAvoids && options.characterAvoids.length > 0
            ? { avoids: options.characterAvoids }
            : {}),
        },
        undefined,
        shotPromptNode.version,
      ),
      options.firstFrame
        ? node(
            'image',
            NODE_TYPES.fixedImage,
            { image: options.firstFrame },
            undefined,
            fixedImageNode.version,
          )
        : node(
            'image',
            NODE_TYPES.image,
            {
              aspectRatio: options.aspectRatio,
              variation: options.imageVariation ?? 0,
              ...(options.editModel ? { editModel: options.editModel.id } : {}),
            },
            options.models.image,
            imageNode.version,
          ),
      node(
        'video',
        NODE_TYPES.video,
        {
          durationSec: options.durationSec,
          aspectRatio: options.aspectRatio,
          audio: options.audio ?? false,
          variation: options.videoVariation ?? 0,
          // 沒改過就不放進參數，舊專案的節點參數（與快取）完全不變
          ...(options.negativePrompt ? { negativePrompt: options.negativePrompt } : {}),
          ...(options.characterAvoids && options.characterAvoids.length > 0
            ? { characterAvoids: options.characterAvoids }
            : {}),
        },
        options.models.video,
        videoNode.version,
      ),
      node('out', '$output'),
    ],
    edges: [
      edge('b1', ['in', 'item'], ['prompt', 'shot']),
      ...(options.firstFrame ? [] : [edge('b2', ['prompt', 'imagePrompt'], ['image', 'prompt'])]),
      ...(options.editModel && !options.firstFrame
        ? [edge('b7', ['prompt', 'references'], ['image', 'references'])]
        : []),
      edge('b3', ['image', 'image'], ['video', 'image']),
      edge('b4', ['prompt', 'videoPrompt'], ['video', 'prompt']),
      edge('b6', ['prompt', 'cameraMove'], ['video', 'cameraMove']),
      // 有角色寫了「不要出現的特徵」才接這條線；沒有的話流程與以前完全一樣
      ...(options.characterAvoids && options.characterAvoids.length > 0
        ? [edge('b8', ['prompt', 'negativeExtra'], ['video', 'negativeExtra'])]
        : []),
      edge('b5', ['video', 'video'], ['out', 'value']),
    ],
  }
}

/**
 * 快速開始：故事 → 拆鏡 → 對每個鏡頭 [組 Prompt → 首幀圖 → 圖生影片] → 接成一支影片。
 * 回傳一般的 Workflow 資料（可存、可在節點圖編輯器顯示），不是特殊物件。
 */
export function buildQuickStart(options: QuickStartOptions): Workflow {
  const variation = options.variation ?? 0
  const stamp = options.now ?? new Date().toISOString()
  const body = buildShotWorkflow({
    style: options.style,
    durationSec: options.durationSec,
    aspectRatio: options.aspectRatio,
    models: options.models,
    imageVariation: variation,
    videoVariation: variation,
    ...(options.anchors ? { anchors: options.anchors } : {}),
    ...(options.editModel ? { editModel: options.editModel } : {}),
    ...(options.audio === undefined ? {} : { audio: options.audio }),
    ...(options.negativePrompt ? { negativePrompt: options.negativePrompt } : {}),
    now: stamp,
  })

  const { breakdown, each, join } = QUICK_START_IDS
  const breakdownWorkflowNode = node(
    breakdown,
    NODE_TYPES.breakdown,
    {
      story: options.story,
      shotCount: options.shotCount,
      durationSec: options.durationSec,
      style: options.style,
      variation,
      knownCharacters: [...(options.knownCharacters ?? [])],
      guide: options.storyboardGuide ?? '',
      narration: options.narration === true,
    },
    options.models.llm,
    breakdownNode.version,
  )
  return {
    id: options.id ?? 'quickstart',
    name: options.storyboardOnly === true ? '只寫分鏡' : '快速開始',
    version: 1,
    createdAt: stamp,
    updatedAt: stamp,
    nodes:
      options.storyboardOnly === true
        ? [breakdownWorkflowNode]
        : [
            breakdownWorkflowNode,
            node(each, 'forEach', { body, concurrency: 2 }),
            node(join, NODE_TYPES.concat),
          ],
    edges:
      options.storyboardOnly === true
        ? []
        : [
            edge('e1', [breakdown, 'shots'], [each, 'items']),
            edge('e2', [each, 'results'], [join, 'videos']),
          ],
  }
}

/** 預估花費用：「對每個鏡頭執行」節點最多會跑幾個項目。 */
export function quickStartItemCounts(
  options: Pick<QuickStartOptions, 'shotCount' | 'storyboardOnly'>,
): Record<string, number> {
  return options.storyboardOnly === true ? {} : { [QUICK_START_IDS.each]: options.shotCount }
}
