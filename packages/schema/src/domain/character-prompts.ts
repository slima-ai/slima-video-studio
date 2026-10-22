/**
 * 角色概念圖與三視圖的提示詞範本。
 * 預設內容就是下面這三份；使用者可以在設定裡看到、改掉、或恢復預設。設定裡沒有自訂內容（空字串）就用預設。
 *
 * 範本裡的 `{{名稱}}` 這類記號會在生成時換成這個角色的內容（見 CHARACTER_PROMPT_VARS）；
 * 不認得的記號原樣留著。
 */
export const CHARACTER_PROMPT_KINDS = ['concept', 'conceptRef', 'turnaround'] as const
export type CharacterPromptKind = (typeof CHARACTER_PROMPT_KINDS)[number]

/** 範本可以用的記號與意思（設定畫面照這份列給使用者看）。 */
export const CHARACTER_PROMPT_VARS = [
  { name: '名稱', text: '角色的名字' },
  { name: '角色', text: '名字、年齡與外觀合成的一句話（沒有外觀就只有名字）' },
  { name: '外觀', text: '固定外觀描述；還沒寫就用長相與服裝' },
  { name: '外觀句', text: '「外觀：……。」整句；沒有外觀描述就是空的' },
  { name: '畫風', text: '專案選的畫風那一段文字' },
  {
    name: '參考圖說明',
    text: '「參考圖依序是：第 1 張是臉，第 2 張是身體。」整句；沒有標用途就是空的',
  },
] as const

export const DEFAULT_CHARACTER_PROMPTS: Record<CharacterPromptKind, string> = {
  /** 只有文字描述、沒有參考圖時的概念圖。 */
  concept: '角色設定圖，{{角色}}。全身站立，面向前方，表情自然，單色乾淨的背景。{{畫風}}',
  /** 角色身上有參考圖（上傳或接上去的圖）時的概念圖：照參考圖畫，只換畫風。 */
  conceptRef:
    '角色設定圖：參考圖是「{{名稱}}」本來的樣子，請照參考圖畫出這個角色，全身站立，面向前方，表情自然，單色乾淨的背景。' +
    '臉、眼睛的大小與位置、顏色、頭上與身上的裝飾和花紋、身體比例都必須和參考圖完全一致，不要重新設計，也不要多加或少掉任何部位。' +
    '{{參考圖說明}}{{外觀句}}畫風：{{畫風}}。' +
    'Character design sheet of the character in the reference image, full body, facing front, plain background, strictly consistent with the reference image.',
  /** 三視圖設定稿（以主圖為參考）。 */
  turnaround:
    '角色三視圖設定稿（character turnaround sheet）：參考圖裡的角色「{{名稱}}」，' +
    '在同一張橫式圖上由左到右並排三個全身站姿：正面、側面（面向右）、背面；A-pose，三個視角大小一致、站在同一條水平線上，' +
    '純白背景，沒有文字、標示或邊框。臉、髮型、服裝、配色必須和參考圖完全一致，不要重新設計。' +
    '{{外觀句}}{{畫風}}。' +
    'Full-body character turnaround sheet, front view, side view, back view side by side, A-pose, plain white background, no text, strictly consistent with the reference image.',
}

/** 自訂範本的字數上限（每一張圖都會送一次，太長只會變貴、也容易蓋過角色本身）。 */
export const CHARACTER_PROMPT_MAX_CHARS = 1500

export type CharacterPromptsSetting = Partial<Record<CharacterPromptKind, string>>

/** 實際使用的範本：使用者沒有自訂（空白）就用預設。 */
export function resolveCharacterPrompt(
  custom: string | undefined,
  kind: CharacterPromptKind,
): string {
  const text = custom?.trim() ?? ''
  return text === '' ? DEFAULT_CHARACTER_PROMPTS[kind] : text
}

/** 把範本裡的 `{{記號}}` 換成內容（一次換完，內容裡就算寫了 `{{…}}` 也不會被再換一次）；不認得的記號原樣留著。 */
export function renderCharacterPrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{([^{}]+)\}\}/g, (token, name: string) => vars[name] ?? token)
}
