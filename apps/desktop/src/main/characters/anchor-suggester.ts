import type { MediaTools } from '@svs/media'
import type { ModelRegistry } from '@svs/providers'
import { AppError, storyLanguageNote, type Character } from '@svs/schema'
import { generateStructured } from '@svs/workflows'
import { z } from 'zod'

import type { ProjectManager } from '../project-manager'
import { findTools, type QueueAccess } from '../runtime/project-runtime'
import type { SettingsService } from '../settings/model-service'
import { createStudioServices } from '../studio-services'

export interface AnchorSuggesterDeps {
  projects: ProjectManager
  runtime: QueueAccess
  settingsService: SettingsService
  models: ModelRegistry
  tools?: () => MediaTools | undefined
}

const AnchorSchema = z.object({ anchor: z.string().min(1) })

const SYSTEM =
  '你負責把角色的長相和服裝，整理成一小段「固定外觀描述」，之後每次請 AI 畫這個角色都會原封不動貼上去，' +
  '所以要精簡、具體、不會因為場景不同而改變。' +
  '只寫看得到的特徵：年齡感與性別印象、髮型與髮色、眼睛顏色、臉型、身形、膚色、標誌性的小特徵（疤痕、痣、配件）與服裝。' +
  '不要寫個性、動作、表情、背景、情緒。用逗號分隔的短句，30 到 80 個字。' +
  '使用者沒有寫到的特徵不要自己編造。只輸出 JSON：{"anchor": "..."}。'

/**
 * 整理固定外觀描述給文字模型的 system prompt。使用者寫的長相與服裝不是中文時多一句「用同一種語言寫」；
 * 中文的內容一字不變。
 */
export function anchorSystemPrompt(content: string): string {
  return (
    SYSTEM +
    storyLanguageNote(
      content,
      '使用者寫的角色資料不是中文：這段描述請用使用者寫的語言寫，不要翻成中文（長度比照，約 20 到 50 個英文字）。',
    )
  )
}

/** 請 AI 把長相與服裝整理成固定外觀描述（只回傳建議，由使用者決定要不要存）。 */
export function createAnchorSuggester(
  deps: AnchorSuggesterDeps,
): (character: Character, outfit: string) => Promise<string> {
  const tools = deps.tools ?? findTools

  return async (character, outfit) => {
    if (character.appearance.trim() === '' && outfit.trim() === '') {
      throw new AppError({
        code: 'invalid_request',
        userMessage: '請先寫一點長相或服裝，AI 才有東西可以整理。',
      })
    }
    const model = deps.settingsService.resolveModel('llm')
    const handle = deps.projects.current()
    const queue = deps.runtime.queue()
    const tool = tools()
    if (!model) {
      throw new AppError({
        code: 'invalid_request',
        userMessage: '還沒有可用的文字模型：請到設定填入 OpenRouter 的服務金鑰（或打開示範模式）。',
      })
    }
    if (!handle || !queue || !tool) {
      throw new AppError({
        code: 'internal_error',
        userMessage: '生成服務還沒準備好，請重新啟動 App。',
      })
    }
    const studio = createStudioServices({ queue, handle, tools: tool, models: deps.models })
    const lines = [
      `名字：${character.name}`,
      character.age ? `年齡：${character.age}` : undefined,
      character.appearance.trim() ? `長相：${character.appearance.trim()}` : undefined,
      outfit.trim() ? `服裝：${outfit.trim()}` : undefined,
    ].filter((line) => line !== undefined)
    const result = await generateStructured(
      studio,
      {
        modelId: model,
        // 語言只看使用者寫的長相與服裝（名字不算，也不看 App 加的中文標籤）
        system: anchorSystemPrompt([character.appearance, outfit].join('\n')),
        messages: [{ role: 'user', content: lines.join('\n') }],
      },
      AnchorSchema,
      { signal: new AbortController().signal },
    )
    // 引擎只會替「工作流」入帳；這裡是單獨呼叫，自己記到花費帳本
    if (result.costUsd !== undefined && !handle.closed) {
      handle.repos.costs.record({
        projectId: handle.projectId,
        provider: result.provider,
        modelId: model,
        amountUsd: result.costUsd,
        estimated: false,
        jobId: result.jobId,
      })
    }
    return result.data.anchor.trim()
  }
}
