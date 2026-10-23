import { getLocale, type Locale } from '../i18n/locale'

/**
 * 分鏡準則：AI 把故事拆成鏡頭時一併參考的做法。
 * 預設內容是一份簡短的拍片基本概念（出處與說明見 docs/storyboard-guide.md）；
 * 使用者可以在設定裡看到、改掉、或恢復預設。設定裡沒有自訂內容（空字串）就用這份預設。
 * 中文與英文各一份（DEFAULT_STORYBOARD_GUIDE／DEFAULT_STORYBOARD_GUIDE_EN），沒自訂的人跟著介面語言挑。
 */
export const DEFAULT_STORYBOARD_GUIDE = `1. 一個鏡頭只做一件事
每個鏡頭只有一個主要動作、一個運鏡，不要寫「然後」「接著」。幾秒的畫面裝不下兩件事，需要兩件事就拆成兩個鏡頭。

2. 景別要有起伏
開場或換地點先用遠景交代環境，中景推進事情，近景留給情緒或關鍵的小東西。不要連續好幾個鏡頭都是同一個景別。遠景很適合表現角色渺小或孤單。

3. 相鄰兩鏡要有明顯差別
下一鏡的景別至少差一級，或機位明顯換個角度；只是稍微靠近一點，看起來像畫面跳了一下，不像換鏡。

4. 節奏有高低
先鋪陳、再升高、有一個最高點、最後放慢收尾。最高點前後可以放一個安靜或較慢的鏡頭來襯托；緊張的段落用動作方向明確的短鏡頭。整支片節奏都一樣會讓人覺得平。

5. 鏡頭之間要接得上
- 方向一致：角色往右跑，下一鏡還是往右，除非劇情就是要折返。
- 視線對得上：角色看向畫面外，下一鏡就給他看到的東西。
- 同一個場景裡，拍攝位置維持在角色連線的同一側，不要突然跳到另一側。
- 動作做到一半就切，比做完才切順。
- 上一鏡的結尾和下一鏡的開頭最好有呼應（形狀、顏色、方向）。

6. 運鏡要有目的
推近是聚焦或逼近，拉遠是揭露環境或讓角色孤立，橫移是跟隨或展示空間，仰拍給力量或壓迫感，俯拍給渺小或全貌，固定鏡頭留給對話、停頓與情緒落點。每一鏡都要選一個對的運鏡，不要預設不動。

7. 每個畫面都要看得懂
寫清楚誰是主體、佔畫面多大，用前景、背景、遠近來說位置，光線從哪裡來、是什麼氣氛。這樣才能直接拿去畫成首幀。不要把畫面切成上下或左右兩塊來描述（例如「臉在上半部、網在下半部」「左邊放……右邊放……」），圖片模型會真的畫成兩格拼貼；只描述一個構圖，例如「臉部近景，雙手握著網在前景下緣」。沒有對白時，靠動作、表情、光影和構圖說故事。

8. 替影片模型著想
- 只寫看得到的東西，說「要什麼」，不要說「不要什麼」。
- 太複雜的動作（連續變化、快速甩動、多個角色同時大動作）容易失敗，拆開或簡化。
- 角色在大景別裡通常比近距離特寫更穩定，特寫與大動作留給真正需要的一兩個鏡頭。
- 每個鏡頭的首幀要是一個構圖清楚、可以直接畫出來的畫面。

9. 鏡頭語言（欄位 size、angle、cameraMove；都是起點，不是死規則）
先定這一場要觀眾感覺什麼，再選鏡頭。
- size：extreme_wide 交代環境與孤單，wide、full 是人在環境裡，medium 適合對話與動作，close_up 表現情緒，extreme_close_up 整支片一兩次就好。
- angle：跟著情緒換，不要每一鏡都是 eye_level：high 讓人覺得渺小，low 有力量，over_shoulder 適合對話，side 看橫向的動作，back 跟著背影，dutch 表現不安（少用）。
- cameraMove：每一場至少有一個帶目的的運鏡：push_in 強調，pan 帶出空間，follow 跟著動作，pull_out 揭露或孤立，handheld 緊張，crane 壯闊；static 留給對話、停頓與情緒落點。同一種運鏡或角度不要連續超過兩鏡。
- 節奏：緊張 2 到 3 秒，一般 4 到 6 秒，揭露與最後一鏡 5 秒以上。
- 光線：同一場的光線與時段保持一致；暖柔光是安心，冷暗是孤單，強對比是緊張。
- 鏡頭之間只有直接切，不要寫溶接、淡出。`

/**
 * 英文介面用的預設準則：內容對照中文版翻成英文（9 條、不增減規則）。
 * 英文介面、沒有自訂準則的人，拆鏡 system prompt 的準則段用這份；中文介面一字不變。
 */
export const DEFAULT_STORYBOARD_GUIDE_EN = `1. One shot does one thing
Each shot has one main action and one camera move; do not write "then" or "next". A few seconds of picture cannot hold two things: if you need two, split them into two shots.

2. Vary the shot size
Open or change location with a wide shot that sets the scene, move the story along in medium shots, and keep close-ups for emotion or a small key object. Do not put several shots of the same size in a row. A wide shot is good for making a character feel small or alone.

3. Neighbouring shots must differ clearly
The next shot's size should differ by at least one step, or the camera should clearly take another angle; moving only slightly closer looks like the picture jumped, not like a cut.

4. Give the pacing highs and lows
Build up first, then rise, reach one peak, and slow down at the end. Put a quiet or slower shot before or after the peak to set it off; tense passages use short shots with a clear direction of movement. If the whole film runs at one pace it feels flat.

5. Shots must join up
- Keep direction consistent: if a character runs right, the next shot still goes right, unless the story is about turning back.
- Match eyelines: if a character looks off screen, the next shot shows what they see.
- Within one scene, keep the camera on the same side of the line between the characters; do not jump to the other side.
- Cutting in the middle of an action is smoother than cutting after it is finished.
- The end of one shot and the start of the next should echo each other (shape, colour, direction).

6. Camera moves need a purpose
Pushing in focuses or closes in; pulling out reveals the setting or isolates a character; a lateral move follows or shows space; a low angle gives power or pressure, a high angle gives smallness or the full picture; a static shot is for dialogue, pauses and emotional landings. Choose a fitting move for every shot; do not default to not moving.

7. Every picture must be readable
Say who the subject is and how much of the frame they fill, describe position with foreground, background and distance, and say where the light comes from and what mood it sets. That way the description can be drawn straight into a first frame. Do not describe the picture as split into top and bottom or left and right halves (for example "face in the upper half, net in the lower half" or "on the left put ... on the right put ..."): the image model will really draw a two-panel collage. Describe one composition, for example "close-up of the face, hands holding the net along the bottom edge of the foreground". With no dialogue, tell the story through action, expression, light and composition.

8. Think of the video model
- Write only what can be seen, and say what you want, not what you do not want.
- Complicated actions (continuous change, fast swings, several characters making big moves at once) tend to fail: split or simplify them.
- Characters are usually more stable in larger shot sizes than in close-ups; keep close-ups and big actions for the one or two shots that really need them.
- The first frame of every shot must be a clearly composed picture that can be drawn directly.

9. Shot language (fields size, angle, cameraMove; these are starting points, not hard rules)
Decide what the audience should feel in this scene first, then choose the shots.
- size: extreme_wide sets the scene and loneliness; wide and full put people in their surroundings; medium suits dialogue and action; close_up shows emotion; use extreme_close_up once or twice in the whole film.
- angle: change with the emotion and do not make every shot eye_level: high makes people feel small, low gives power, over_shoulder suits dialogue, side shows sideways action, back follows a figure from behind, dutch shows unease (use rarely).
- cameraMove: every scene has at least one move with a purpose: push_in emphasises, pan reveals space, follow tracks the action, pull_out reveals or isolates, handheld adds tension, crane adds grandeur; keep static for dialogue, pauses and emotional landings. Do not use the same move or angle for more than two shots in a row.
- Pacing: tense shots 2 to 3 seconds, ordinary shots 4 to 6 seconds, reveals and the last shot 5 seconds or more.
- Light: keep the light and time of day the same within one scene; warm soft light feels safe, cold dark light feels lonely, strong contrast feels tense.
- Between shots use straight cuts only; do not write dissolves or fades.`

/**
 * 自訂準則的字數上限（會跟著每次拆鏡一起送給文字模型，太長會變貴、也容易蓋過故事）。
 * 中文一個字就是一個意思，英文要寫成字母，同樣長度的準則英文約是中文的三倍字元數，所以兩種語言各一個上限。
 */
export const STORYBOARD_GUIDE_MAX_CHARS = 4000
export const STORYBOARD_GUIDE_MAX_CHARS_EN = 10000

/** 設定檔（schema）接受的上限：兩種語言裡比較大的那個；畫面上的上限依介面語言（storyboardGuideMaxChars）。 */
export const STORYBOARD_GUIDE_SCHEMA_MAX_CHARS = Math.max(
  STORYBOARD_GUIDE_MAX_CHARS,
  STORYBOARD_GUIDE_MAX_CHARS_EN,
)

/** 目前介面語言對應的預設準則：繁體中文用中文版，其他（英文、假語系）用英文版。 */
export function defaultStoryboardGuide(locale: Locale = getLocale()): string {
  return locale === 'zh-TW' ? DEFAULT_STORYBOARD_GUIDE : DEFAULT_STORYBOARD_GUIDE_EN
}

/** 目前介面語言的自訂準則字數上限。 */
export function storyboardGuideMaxChars(locale: Locale = getLocale()): number {
  return locale === 'zh-TW' ? STORYBOARD_GUIDE_MAX_CHARS : STORYBOARD_GUIDE_MAX_CHARS_EN
}

/** 這段文字是不是任何一種語言的內建預設（是的話不算「自訂」，會跟著介面語言換）。 */
export function isDefaultStoryboardGuide(text: string): boolean {
  const trimmed = text.trim()
  return (
    trimmed === DEFAULT_STORYBOARD_GUIDE.trim() || trimmed === DEFAULT_STORYBOARD_GUIDE_EN.trim()
  )
}

/**
 * 實際使用的準則：使用者沒有自訂（空白，或存的剛好是某一種語言的內建預設）就用目前介面語言的預設；
 * 自訂的原樣保留，不跟著語言換。
 */
export function resolveStoryboardGuide(custom: string | undefined): string {
  const text = custom?.trim() ?? ''
  return text === '' || isDefaultStoryboardGuide(text) ? defaultStoryboardGuide() : text
}

/** 接在拆鏡 system prompt 後面的段落；沒有準則（空字串）就什麼都不加。 */
export function storyboardGuidePrompt(guide: string): string {
  const text = guide.trim()
  return text === ''
    ? ''
    : `\n\n分鏡準則（安排鏡頭時請照這些原則，但不要違反上面的輸出格式）：\n${text}`
}
