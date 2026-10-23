import { msg, t, type MessageRef } from '@svs/schema'

import { SERVER_NAME } from '../mcp/connect'

/** Claude 看到的工具名前綴：`mcp__<伺服器名>__<工具名>`。 */
export const TOOL_PREFIX = `mcp__${SERVER_NAME}__`

/** 去掉前綴；不是我們的工具（理論上不會，白名單只開我們的）就原樣回傳。 */
export const bareToolName = (name: string): string =>
  name.startsWith(TOOL_PREFIX) ? name.slice(TOOL_PREFIX.length) : name

/**
 * 工具名換成白話（動詞開頭，例如「建立鏡頭」）。進行中寫「正在建立鏡頭…」，做完寫「建立鏡頭」。
 * 新增工具忘了補這裡也不會壞：沒有對照就退回「做了一個步驟」（不把英文工具名給使用者看，工具名只放在滑過的提示裡）。
 */
const LABELS: Readonly<Record<string, MessageRef>> = {
  get_capabilities: msg('chat.seeWhatTheAppCan'),
  load_guide: msg('chat.readTheFilmmakingGuide'),
  list_projects: msg('chat.listProjects'),
  get_current_project: msg('chat.checkTheCurrentProject'),
  create_project: msg('chat.createAProject'),
  open_project: msg('chat.openAProject'),
  configure_project: msg('chat.setTheStyleAndAspect'),
  list_models: msg('chat.listAvailableModels'),
  set_models: msg('chat.chooseModels'),
  get_outline: msg('chat.readTheOutline'),
  edit_outline: msg('chat.editTheOutline'),
  split_story_into_scenes: msg('chat.splitTheStoryIntoScenes'),
  split_scene_into_shots: msg('chat.splitASceneIntoShots'),
  estimate_cost: msg('chat.estimateThisStepSCost'),
  list_shots: msg('chat.listShots'),
  get_shot: msg('chat.lookAtAShot'),
  get_shot_references: msg('chat.checkWhichReferencePicturesA'),
  set_shot_references: msg('chat.setAShotSReference'),
  create_shot: msg('chat.createAShot'),
  update_shot: msg('chat.editAShot'),
  delete_shots: msg('chat.deleteShots'),
  reorder_shots: msg('chat.reorderShots'),
  list_characters: msg('chat.listCharacters'),
  create_character: msg('chat.createACharacter'),
  update_character: msg('chat.editACharacter'),
  suggest_character_anchor: msg('chat.askAiToWriteA'),
  set_character_anchor: msg('chat.saveACharacterSFixed'),
  list_project_images: msg('chat.listPicturesInTheProject'),
  add_character_reference: msg('chat.addAPictureAsA'),
  remove_character_reference: msg('chat.removeACharacterSReference'),
  generate_character_images: msg('chat.generateCharacterConceptPictures'),
  view_character_images: msg('chat.lookAtCharacterConceptPictures'),
  pick_character_image: msg('chat.pickACharacterConceptPicture'),
  lock_character: msg('chat.lockACharacter'),
  generate_first_frames: msg('chat.generateFirstFrames'),
  generate_videos: msg('chat.generateVideos'),
  regenerate_shot: msg('chat.regenerateAShot'),
  cancel_generation: msg('chat.cancelAGeneration'),
  get_generation_status: msg('chat.checkGenerationProgress'),
  wait_for_generation: msg('chat.waitForGenerationToFinish'),
  adopt_version: msg('chat.switchToAnotherVersion'),
  view_first_frames: msg('chat.lookAtFirstFrames'),
  view_video_stills: msg('chat.lookAtVideoFrames'),
  assemble_film: msg('chat.assembleTheFilm'),
  export_film: msg('chat.exportMp4'),
  get_sound: msg('chat.checkTheSound'),
  plan_sound: msg('chat.estimateSoundCost'),
  generate_narration: msg('chat.generateNarration'),
  generate_music: msg('chat.generateMusic'),
  adjust_sound_clip: msg('chat.adjustTheSound'),
  adopt_sound_clip: msg('chat.switchToAnotherNarrationOr'),
  remove_sound_clip: msg('chat.deleteANarrationOrMusic'),
  mix_sound: msg('chat.mixTheSound'),
  analyze_sound: msg('chat.checkTheAudio'),
  set_sound_settings: msg('chat.setUpTheSound'),
  undo: msg('chat.undo'),
  redo: msg('chat.redoUndoTheLastUndo'),
}

/** 已經換成 t() 的工具（做完與進行中各一句；英文語序不同，不能用「正在」＋名稱拼）。 */
const TRANSLATED_LABELS: Record<string, { done: MessageRef; doing: MessageRef }> = {
  set_shot_end_frame: {
    done: msg('endFrame.tool.set.done'),
    doing: msg('endFrame.tool.set.doing'),
  },
  generate_end_frame: {
    done: msg('endFrame.tool.generate.done'),
    doing: msg('endFrame.tool.generate.doing'),
  },
  clear_shot_end_frame: {
    done: msg('endFrame.tool.clear.done'),
    doing: msg('endFrame.tool.clear.doing'),
  },
}

/** 有沒有白話對照（測試用：每個 MCP 工具都要有）。 */
export const hasToolLabel = (tool: string): boolean => tool in LABELS || tool in TRANSLATED_LABELS

/** 做完或要列在清單上的樣子：「建立鏡頭」。 */
export function toolLabel(tool: string): string {
  const translated = TRANSLATED_LABELS[tool]
  if (translated) return t(translated.done)
  const known = LABELS[tool]
  return known === undefined ? t('chat.didAStep') : t(known)
}

/** 進行中的樣子：「正在建立鏡頭…」。 */
export function toolDoingLabel(tool: string): string {
  const translated = TRANSLATED_LABELS[tool]
  if (translated) return t(translated.doing)
  const known = LABELS[tool]
  return known === undefined ? t('chat.workingOnAStep') : t('chat.text', { known: t(known) })
}
