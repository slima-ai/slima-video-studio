import { QUICK_STYLE_IDS, QUICK_STYLE_LABELS, type QuickStyleId } from '@svs/schema'

export { QUICK_STYLE_IDS, type QuickStyleId }

export interface QuickStyle {
  id: QuickStyleId
  /** 給使用者看的白話名稱。 */
  label: string
  /** 接在每個鏡頭 Prompt 後面的畫風描述。 */
  fragment: string
  /** 這個風格比較適合哪一類模型（對應 ModelCard.styleFit）。 */
  fit: 'realistic' | 'animation'
}

export const QUICK_STYLES: Readonly<Record<QuickStyleId, QuickStyle>> = {
  realistic: {
    id: 'realistic',
    label: QUICK_STYLE_LABELS.realistic,
    fragment: '寫實電影質感，自然光線，細節豐富，photorealistic, cinematic lighting',
    fit: 'realistic',
  },
  anime: {
    id: 'anime',
    label: QUICK_STYLE_LABELS.anime,
    fragment: '日系動畫風格，賽璐珞上色，乾淨的線條，japanese anime style, cel shading',
    fit: 'animation',
  },
  '3d': {
    id: '3d',
    label: QUICK_STYLE_LABELS['3d'],
    fragment: '3D 動畫電影風格，柔和光影，圓潤造型，3D animated film, soft lighting',
    fit: 'animation',
  },
  watercolor: {
    id: 'watercolor',
    label: QUICK_STYLE_LABELS.watercolor,
    fragment: '水彩插畫風格，柔和暈染，紙張質感，watercolor illustration, soft washes',
    fit: 'animation',
  },
  painted: {
    id: 'painted',
    label: QUICK_STYLE_LABELS.painted,
    fragment:
      '手繪繪本插畫風：整個畫面（角色和背景）都是同一種水粉與水彩的手繪筆觸，看得到筆痕與紙張紋理，形狀簡化、色塊柔和，夜色也是柔和的繪本配色，不是照片、不是寫實的繪景、不是 3D 渲染，hand-painted picture-book illustration, gouache and watercolor, visible brush strokes and paper texture, simplified shapes, soft painted backgrounds drawn in the same style as the characters, storybook night palette, NOT photorealistic, NOT matte painting, NOT cinematic photography, NOT 3D render',
    fit: 'animation',
  },
}
