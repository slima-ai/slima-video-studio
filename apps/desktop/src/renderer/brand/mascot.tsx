import { cn } from '../lib/cn'
import atlasUrl from './slima-mage-atlas.webp'

/**
 * Slima 的巫師史萊姆（圖像歸 Slima 所有、不在 Apache-2.0 內，見同資料夾的 NOTICE）。
 * 一張 640×640 的圖拼了 4×4 共 16 格表情，每格 160px；這裡用 CSS 背景只露出其中一格，不另外切圖。
 */
const CELL = 160
const COLUMNS = 4

/** 要用的表情：值是那一格在圖裡的位置（列、欄，從 0 數）。 */
const FRAMES = {
  /** 睜眼等你說話 */
  idle: [0, 0],
  /** 瞇眼用力：正在想、正在做 */
  working: [1, 2],
  /** 開心：這一輪做完了 */
  done: [1, 3],
  /** 哭：出錯 */
  error: [2, 3],
  /** 冒汗：被停下來、被擋住 */
  blocked: [3, 2],
} as const satisfies Record<string, readonly [number, number]>

export type MascotMood = keyof typeof FRAMES

export const MASCOT_MOODS = Object.keys(FRAMES) as MascotMood[]

/** 只是裝飾（旁邊都有文字說明狀態），所以對讀屏軟體隱藏；`data-mood` 給測試與樣式用。 */
export function Mascot({
  mood = 'idle',
  size = 24,
  className,
}: {
  mood?: MascotMood
  /** 邊長，像素 */
  size?: number
  className?: string
}) {
  const [row, column] = FRAMES[mood]
  const scale = size / CELL
  return (
    <span
      aria-hidden
      data-testid="mascot"
      data-mood={mood}
      className={cn(
        'inline-block shrink-0 bg-no-repeat',
        mood === 'working' && 'motion-safe:animate-pulse',
        className,
      )}
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${atlasUrl})`,
        backgroundSize: `${CELL * COLUMNS * scale}px ${CELL * COLUMNS * scale}px`,
        backgroundPosition: `${-column * CELL * scale}px ${-row * CELL * scale}px`,
      }}
    />
  )
}
