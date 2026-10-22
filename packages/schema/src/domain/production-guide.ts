/**
 * 製片與一致性指南：AI 助理（Claude）替使用者定義角色、場景、挑參考圖、檢查一致性時參考的做法，
 * 透過 MCP 的 `load_guide("production")` 按需載入。預設內容是用我們自己的話寫的原則與流程，
 * 出處與「沒驗證的部分」見 docs/production-guide.md；使用者可以在設定裡看到、改掉、或恢復預設。
 * 設定裡沒有自訂內容（空字串）就用這份預設。
 *
 * 寫法：講原則和為什麼，不寫死張數與模型（那些由 get_capabilities／list_models 回答）；
 * 只提這一版 App 真的有的工具與做法。
 */
export const DEFAULT_PRODUCTION_GUIDE = `# Production and consistency: keeping the same people and places in every shot

Read this before you define characters or places, and again when a character or place stops looking the same from shot to shot. The storyboard guide covers how shots follow each other and the cinematography guide covers camera choices; this one covers how to make the look stay put.

Why it is hard
Image and video models do not remember anything between requests. A character looks the same in shot 5 as in shot 1 only when the same words and the same reference pictures go with every request. Consistency comes from what you lock and send, not from the model.

Define first, shoot later
1. List who and what appears: characters, places, and any object the story depends on. Decide what must never change from shot to shot: face, hair, clothes, colours, a place's layout and light.
2. Give each character one fixed look in plain words: what can be seen, short and concrete, no feelings. A locked look is sent word for word with every shot that includes the character, so write it once and never paraphrase it later.
3. Make the reference pictures before any shot picture. Pictures cost little next to video. Look at them yourself (view_character_images), fix the words or regenerate, then pick one and lock it.
4. If the character already has an original design picture, use it: ask the user to drop it onto the canvas, find it with list_project_images and attach it with add_character_reference, saying what it shows (face, body, turnaround, expression, costume, prop or general). The concept pictures are then drawn from it instead of from words alone, so the character stays the same as the original.

What a reference picture is for
- A character needs one clear front picture (the hero); an attached original design sheet counts as the best starting point. If shots will show the side or the back, the three-view sheet matters too: the app uses the side or back view for those angles and the hero for close-ups. Without a view to follow, the model invents the unseen side and the look drifts there. list_characters shows hasTurnaround; the user builds the sheet on the character card (you cannot yet), so tell them when a planned shot needs it.
- A place is a picture of the empty setting, no people in it, with a main view; add a pulled-back view and a reverse view if the scene cuts around. Keep light and time of day fixed inside one scene.
- If the user has made place cards on the canvas, a shot that names that place uses them automatically. You cannot create place cards with tools yet; say so when it would help, instead of describing the place differently in every shot.

Spend the reference slots where the shot needs them
Each image model accepts only a few reference pictures per request (get_capabilities and list_models tell you which model is in use). The app picks them for every shot from the size and angle: the face-forward picture for close-ups, the side or back view for those angles, the place picture for wide shots. A shot with several characters leaves each one fewer pictures, so crowded shots are the ones that drift first: keep them rare, or give the shot fewer characters.

Look before you spend more
Reference pictures, then first frames (view_first_frames), then video (view_video_stills). Check each stage against the references before starting the next, and fix a fault at the earliest stage where it appears: a wrong face in the first frame is cheaper to redo than the video made from it.

When something drifts
1. Compare the shot with the locked pictures and words: what exactly changed (colour, shape, a missing detail)?
2. Fix the cause once: sharpen the locked look, or replace the reference picture. Do not pile more words into one shot's prompt; the next shot will drift again.
3. Redo only that shot (regenerate_shot). If the same fault comes back every time, the model may be the limit; try another (list_models) and tell the user why.

Long or busy action
Do not ask one clip for a fight or a long chase. Split it into several short shots, one action each, so every shot has its own first frame, can be redone alone, and has a price you can quote.

Not yet proven (say so instead of promising)
- Some guides advise one close-up of the face and a separate picture of the body without the face. We found this only in one blog post and have not tested it here.
- Whether extra reference pictures sent to a video model keep a character steadier than the first-frame picture alone has not been tested here.
- A model's own consistency features differ by model and may not be available through the app yet.

Tell the user what you locked and why in a sentence each, and quote the price before anything that spends money.
`

/** 自訂指南的字數上限（只有 Claude 載入指南時才會讀到；太長會佔掉對話的空間）。 */
export const PRODUCTION_GUIDE_MAX_CHARS = 12000

/** 實際使用的指南：使用者沒有自訂（空白）就用預設。 */
export function resolveProductionGuide(custom: string | undefined): string {
  const text = custom?.trim() ?? ''
  return text === '' ? DEFAULT_PRODUCTION_GUIDE : text
}
