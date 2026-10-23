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

Read this before you define characters or places, and again when one drifts from shot to shot. Shot order and camera choices are in the storyboard and cinematography guides.

Why it is hard
Image and video models remember nothing between requests. A character looks the same in shot 5 as in shot 1 only when the same words and pictures go with every request: consistency comes from what you lock and send.

Define first, shoot later
1. List characters, places and any object the story depends on, and decide what must never change: face, hair, clothes, colours, a place's layout and light.
2. Give each character one fixed look in plain words: what can be seen, short and concrete, no feelings. A locked look is sent word for word with every shot that includes the character, so never paraphrase it.
3. Make the reference pictures before any shot picture. Look at them yourself (view_character_images), fix the words or regenerate, then pick one and lock it.
4. If the character already has an original design picture, use it: ask the user to drop it onto the canvas, find it with list_project_images and attach it with add_character_reference, saying what it shows.

What a reference picture is for
- A character needs one clear front picture (the hero); an attached original design sheet is the best start. If shots show the side or back, the three-view sheet matters too: the app uses those views for those angles and the hero for close-ups; without one, the model invents the unseen side and the look drifts. Only the user can build the sheet (list_characters shows hasTurnaround): say when a shot needs it.
- A place is a picture of the empty setting, no people, with a main view; add a pulled-back and a reverse view if the scene cuts around.

Spend the reference slots where the shot needs them
Each image model accepts only a few reference pictures per request (get_capabilities, list_models). For locked characters and places the app picks per shot from size and angle: the hero first (side or back view for those angles), then the character's attached pictures that fit (face, expression for close-ups; body, costume for wide and side shots), then the front view; the place takes one slot. Crowded shots drift first: each character gets fewer pictures.
If the pick shows the wrong face, outfit or place, look with get_shot_references, then choose by hand with set_shot_references (an empty list returns to automatic). The first frame must then be regenerated, which costs money: quote it first.

Write each shot in three places
- description: only what the first frame shows (who is where, pose, expression, setting). It is a still picture, so movement or camera words ("the camera pans left") reach the image model as if part of the picture.
- action: only what happens during the seconds, as who does what from where to where ("the small yellow dome hops once to the left and lands"). Name each subject by how it looks; do not re-describe its looks. For a character with no mouth or limbs, say in the action that it stays as it is: given no motion, a video model tends to invent one (in one real test a faceless character grew an expression and a mouth).
- cameraMove: camera movement goes in this field only, never in description or action.
- Features a character must never grow in video go in its avoid list (update_character; English, comma separated), not in shot words. List only what this character lacks and every other character in the same shot lacks too (a mouthless slime: mouth, eyebrows, arms, legs). Lists of all characters in a shot are combined as written, so a word one character needs and another forbids breaks the first: drop it or split the shots. Only video models that accept a negative prompt use it.
Size and position: image models do not follow numbers. Say what is in front and behind, who is near the frame edge, how far apart things are, not only "a quarter of the frame" (one test: a quarter came out near 18%).
Style: the app adds the project's art style (configure_project) to every prompt. Keep descriptions in its vocabulary, naming it when needed (for example hand-drawn picture book); words from another look (photo, lens) pull one shot away from the rest.

Look before you spend more
Reference pictures, then first frames (view_first_frames), then video (view_video_stills). Check each stage against the references before the next and fix a fault at the earliest stage: a wrong face is cheaper to redo in the first frame than in the video.

When something drifts
1. Compare the shot with the locked pictures and words: what exactly changed?
2. Fix the cause once: sharpen the locked look or replace the reference picture. Piling words into one shot's prompt only moves the drift to the next shot.
3. Redo only that shot (regenerate_shot). If the same fault keeps returning, the model may be the limit; try another (list_models).

Long or busy action
Do not ask one clip for a fight or a long chase. Split it into short shots, one action each, so each can be redone alone and priced.

Reference pictures for the video model
In one real test (Kling via OpenRouter, one clip per setting) sending reference pictures made the character worse: with two it grew arms and legs, with four it became a faceless ball. The app marks this not recommended; rely on the first frame.

Not yet proven (say so instead of promising)
- Some guides advise one close-up of the face and a separate picture of the body without the face; we found this only in one blog post and it has not been tested here.

Tell the user what you locked and why; quote prices before spending.
`

/** 自訂指南的字數上限（只有 Claude 載入指南時才會讀到；太長會佔掉對話的空間）。 */
export const PRODUCTION_GUIDE_MAX_CHARS = 12000

/** 實際使用的指南：使用者沒有自訂（空白）就用預設。 */
export function resolveProductionGuide(custom: string | undefined): string {
  const text = custom?.trim() ?? ''
  return text === '' ? DEFAULT_PRODUCTION_GUIDE : text
}
