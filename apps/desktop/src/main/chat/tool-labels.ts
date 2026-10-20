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
const LABELS: Readonly<Record<string, string>> = {
  get_capabilities: '了解 App 能做什麼',
  load_guide: '讀取拍片指南',
  list_projects: '查看專案清單',
  get_current_project: '查看目前的專案',
  create_project: '建立專案',
  open_project: '打開專案',
  configure_project: '設定畫風與畫面比例',
  list_models: '查看可用的模型',
  set_models: '設定模型',
  get_outline: '查看大綱',
  edit_outline: '修改大綱',
  split_story_into_scenes: '把故事拆成場',
  split_scene_into_shots: '把場拆成鏡頭',
  estimate_cost: '估算拆分的花費',
  list_shots: '查看鏡頭清單',
  get_shot: '查看鏡頭',
  create_shot: '建立鏡頭',
  update_shot: '修改鏡頭',
  delete_shots: '刪除鏡頭',
  reorder_shots: '調整鏡頭順序',
  list_characters: '查看角色清單',
  create_character: '建立角色',
  update_character: '修改角色',
  suggest_character_anchor: '請 AI 整理角色的固定外觀描述',
  set_character_anchor: '儲存角色的固定外觀描述',
  generate_character_images: '生成角色概念圖',
  view_character_images: '查看角色概念圖',
  pick_character_image: '挑一張角色概念圖',
  lock_character: '鎖定角色',
  generate_first_frames: '生成第一張畫面',
  generate_videos: '生成影片',
  regenerate_shot: '重新生成鏡頭',
  cancel_generation: '取消生成',
  get_generation_status: '查看生成進度',
  wait_for_generation: '等待生成完成',
  adopt_version: '換用另一個版本',
  view_first_frames: '查看第一張畫面',
  view_video_stills: '查看影片畫面',
  assemble_film: '接成成品',
  export_film: '匯出 MP4',
  get_sound: '查看聲音',
  plan_sound: '估算聲音花費',
  generate_narration: '生成旁白',
  generate_music: '生成配樂',
  adjust_sound_clip: '調整聲音',
  adopt_sound_clip: '換用另一個版本的旁白或配樂',
  remove_sound_clip: '刪除一個旁白或配樂版本',
  mix_sound: '混音',
  analyze_sound: '檢查聲音',
  set_sound_settings: '設定聲音',
  undo: '復原',
  redo: '重做（取消剛才的復原）',
}

/** 有沒有白話對照（測試用：每個 MCP 工具都要有）。 */
export const hasToolLabel = (tool: string): boolean => tool in LABELS

/** 做完或要列在清單上的樣子：「建立鏡頭」。 */
export function toolLabel(tool: string): string {
  return LABELS[tool] ?? '做了一個步驟'
}

/** 進行中的樣子：「正在建立鏡頭…」。 */
export function toolDoingLabel(tool: string): string {
  const known = LABELS[tool]
  return known === undefined ? '正在做一個步驟…' : `正在${known}…`
}
