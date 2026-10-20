import { resolveStoryboardGuide } from '@svs/schema'

/** `load_guide` 的主題。內容寫在這裡（隨 App 版本更新），不寫進伺服器的 instructions（每個工作階段都要付的長度）。 */
export const GUIDE_TOPICS = ['getting-started', 'storyboard', 'spending', 'sound'] as const
export type GuideTopic = (typeof GUIDE_TOPICS)[number]

const GETTING_STARTED = `# Making a video with Slima Video Studio

You are connected to the user's own copy of the app, running on their computer. Everything you change appears in the app window in real time.

Order of work (call get_capabilities for the tools that exist right now):
1. get_capabilities — mode (demo or real), current project, spending allowance, tools.
2. Project: list_projects / create_project / open_project. create_project and open_project switch the project shown in the app window; tell the user before doing it if they might be working in it.
3. Look and models: configure_project (art style, frame shape), list_models, set_models. In real mode the models decide the cost.
4. Story: split_story_into_scenes(story) turns the text into acts and scenes (and draft characters and locations). get_outline shows them; edit_outline fixes them.
5. Characters: list_characters (the story step creates drafts), create_character / update_character, set_character_anchor (the fixed look text; suggest_character_anchor drafts it), then generate_character_images → wait_for_generation → view_character_images (you can SEE the pictures) → pick_character_image → lock_character. A locked character's look is sent unchanged with every shot that includes it.
6. Shots: load_guide("storyboard") first, then split_scene_into_shots(sceneId) for each scene. list_shots / get_shot to review, update_shot / create_shot / delete_shots / reorder_shots to improve. undo / redo work like the app's own.
7. Pictures then video (look before you spend on video): generate_first_frames → wait_for_generation → view_first_frames (you can SEE them; fix a wrong shot with update_shot, then regenerate_shot what="first_frame") → generate_videos → wait_for_generation → view_video_stills (check for extra limbs/faces, a changed character, flicker; redo with regenerate_shot what="video"; adopt_version goes back to an older version) → assemble_film → view_video_stills with finalCut=true → export_film.
8. Sound (after the videos exist; load_guide("sound") first): get_sound → plan_sound → generate_narration per shot (it reads the shot's dialogue) and generate_music → adjust_sound_clip / set_sound_settings → mix_sound (REQUIRED after any change made after assemble_film: adjusted clips, new narration or music, settings) → analyze_sound → export_film. Narration uses the voice chosen in Settings unless you pass a voiceId from list_models. You cannot hear it, so check the numbers and warnings in get_sound.
9. Before a text step, estimate_cost (split_story_into_scenes, split_scene_into_shots) tells you what it would cost and whether the allowance covers it. For sound, plan_sound shows the estimate (free). Pictures and videos have no estimate tool: the app checks the cost itself when you start them and refuses, saying the estimate, if the allowance is too small (load_guide("spending")).

Notes
- Work in small steps and look at the result before spending more.
- Steps 4 and 5's "split" tools call a text model: free in demo mode, otherwise counted against the spending allowance (load_guide("spending")).
- Tool errors are plain-language messages; read them, they usually say what to do next.
`

const SPENDING = `# Spending

- Demo mode never spends money. In real mode, every tool that calls an AI model (text, image or video) first estimates its cost and reserves it from the spending allowance.
- The allowance is the card 「AI 工具的總額度」 under 設定 → AI 工具連線 in the app's Settings page; the person sets it and it starts at US$0. You cannot change it. If a tool says the allowance is too small, tell the user the estimate and ask them to raise 「AI 工具的總額度」 there.
- Reserved money is not refunded if the real cost turns out lower; the user can reset what has been used with 「已用的歸零」 on that card.
- Never try to work around a refusal.
`

const SOUND = `# Sound

You cannot hear audio. You work with numbers: analyze_sound measures the assembled film (loudness around −16 LUFS, true peak below −1 dBTP, each shot's level, quiet stretches, warnings); get_sound shows every shot's start time in the film, its length, its dialogue, the adopted narration and music, and warnings; the user listens to the result in the app.

What the film's sound is made of
- The video model's own sound ("native audio", settings.nativeAudio). Asking for it makes video about 50% more expensive and only applies to videos generated after you turn it on. muteNativeShotIds silences it for some shots.
- Narration: one spoken line per shot, read from the shot's dialogue. Write or fix the line with update_shot (dialogue), then generate_narration(shotId). Each call makes a new version; adopt_sound_clip switches back. It starts 0.4 s after the shot starts. A line longer than the shot is reported as a warning in get_sound: shorten the dialogue, lengthen the shot (update_shot durationSec) or lower the speed by using fewer words.
- Music: one instrumental track for the whole film (generate_music). A track shorter than the film is a warning. Music is quiet by default (−18 dB) and is lowered further while narration speaks (settings.duck).

Order: videos first (the film's length and each shot's real length come from them), then narration, then music, then adjust. assemble_film mixes whatever sound exists at that moment; if you change the sound after assembling, call mix_sound, then analyze_sound to check it, then export_film. Narration and music cost money: plan_sound gives the estimate, the spending allowance applies (load_guide("spending")), pass maxCostUsd if you want a hard limit.
`

/** 使用者自己改過的分鏡準則（設定頁）優先，沒改就是內建的。 */
export function guideText(topic: GuideTopic, customStoryboardGuide: string): string {
  if (topic === 'getting-started') return GETTING_STARTED
  if (topic === 'spending') return SPENDING
  if (topic === 'sound') return SOUND
  return `# Storyboard guide (set by the user in Settings; this is what the app's own AI storyboard step uses)\n\n${resolveStoryboardGuide(customStoryboardGuide)}\n`
}
