import { resolveProductionGuide, resolveStoryboardGuide } from '@svs/schema'

import {
  allowanceCard,
  cutCard,
  demoModeName,
  joinIntoFilmButton,
  resetUsedButton,
  saveButton,
  settingsAiTools,
  settingsApiKeys,
  settingsGeneral,
} from '../ui-labels'

/** `load_guide` 的主題。內容寫在這裡（隨 App 版本更新），不寫進伺服器的 instructions（每個工作階段都要付的長度）。 */
export const GUIDE_TOPICS = [
  'getting-started',
  'storyboard',
  'cinematography',
  'spending',
  'sound',
  'production',
] as const
export type GuideTopic = (typeof GUIDE_TOPICS)[number]

/** 每次取用時才組（裡面有按鈕名字，跟著介面語言）。 */
const gettingStarted = (): string => `# Making a video with Slima Video Studio

You are connected to the user's own copy of the app, running on their computer. Everything you change appears in the app window in real time.

Order of work (call get_capabilities for the tools that exist right now):
1. get_capabilities — mode (demo or real), current project, spending allowance, tools.
2. Project: list_projects / create_project / open_project. create_project and open_project switch the project shown in the app window; tell the user before doing it if they might be working in it.
3. Look and models: configure_project (art style, frame shape), list_models, set_models. In real mode the models decide the cost.
4. Story: split_story_into_scenes(story) turns the text into acts and scenes (and draft characters and locations). get_outline shows them; edit_outline fixes them.
5. Characters: load_guide("production") first (how to keep looks the same from shot to shot). list_characters (the story step creates drafts), create_character / update_character, set_character_anchor (the fixed look text; suggest_character_anchor drafts it), if the character already has an original design picture, ask the user to drop it onto the canvas, find it with list_project_images and attach it with add_character_reference (concept pictures are then drawn FROM that picture instead of from the text, so the character stays identical to the original), then generate_character_images → wait_for_generation → view_character_images (you can SEE the pictures) → pick_character_image → lock_character. A locked character's look is sent unchanged with every shot that includes it.
6. Shots: load_guide("storyboard") and load_guide("cinematography") first, then split_scene_into_shots(sceneId) for each scene. list_shots / get_shot to review, update_shot / create_shot / delete_shots / reorder_shots to improve. undo / redo work like the app's own.
7. Pictures then video (look before you spend on video): generate_first_frames → wait_for_generation → view_first_frames (you can SEE them; fix a wrong shot with update_shot, then regenerate_shot what="first_frame") → generate_videos → wait_for_generation → view_video_stills (check for extra limbs/faces, a changed character, flicker; redo with regenerate_shot what="video"; adopt_version goes back to an older version) → assemble_film (the app calls it ${joinIntoFilmButton()}, on the ${cutCard()} card) → view_video_stills with finalCut=true → export_film.
8. Sound (after the videos exist; load_guide("sound") first): get_sound → plan_sound → generate_narration per shot (it reads the shot's dialogue) and generate_music → adjust_sound_clip / set_sound_settings → mix_sound (REQUIRED after any change made after assemble_film: adjusted clips, new narration or music, settings) → analyze_sound → export_film. Narration uses the voice chosen in Settings unless you pass a voiceId from list_models. You cannot hear it, so check the numbers and warnings in get_sound.
9. Before a step that costs money, estimate_cost tells you what it would cost and whether the allowance covers it: split_story_into_scenes, split_scene_into_shots, generate_first_frames, generate_videos (the same numbers the app shows in its own "generate all" confirmation). For sound, plan_sound shows the estimate (free). Tell the user the price in one line before you start. The app also checks the cost itself when you start a step and refuses, saying the estimate, if the allowance is too small (load_guide("spending")).

Notes
- Work in small steps and look at the result before spending more.
- Steps 4 and 5's "split" tools call a text model: free in demo mode, otherwise counted against the spending allowance (load_guide("spending")).
- Tool errors are plain-language messages; read them, they usually say what to do next.
`

const spending = (): string => `# Spending

- Demo mode never spends money. In real mode, every tool that calls an AI model (text, image or video) first estimates its cost and reserves it from the spending allowance.
- The allowance is the card ${allowanceCard()} under ${settingsAiTools()} in the app's Settings page; the person sets it and it starts at US$0. You cannot change it. If a tool says the allowance is too small, tell the user the estimate and ask them to raise ${allowanceCard()} there.
- The reservation is a safety margin (the estimate times 1.25 for pictures and videos, times 2 for text). When everything has finished, the next tool you call turns it into what was really charged and gives the unused part back, so the allowance left grows again; while something is still generating it stays reserved. The user can also reset what has been used with ${resetUsedButton()} on that card.
- Moving from demo to real AI is something only the user can do, in two places: paste a service key (OpenRouter or fal.ai) on the card of that service under ${settingsApiKeys()} and press ${saveButton()}, then switch off ${demoModeName()} under ${settingsGeneral()}. ${settingsAiTools()} is NOT where keys go: it only lets AI tools like you connect to the app, and holds ${allowanceCard()}. If the user asks how to use real AI, tell them exactly this.
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

const CINEMATOGRAPHY = `# Cinematography: size, angle, camera move, pace and light

Read this before split_scene_into_shots and whenever you create or edit shots. The storyboard guide covers how shots fit together; this covers what each choice does. Decide what the viewer should feel first, then choose the shot.

Rules
1. One shot, one idea: one action, one camera move.
2. Neighbouring shots must differ: change size by a step or more, or change angle. Never the same size three times running.
3. Choose the camera move on purpose for every shot. Each scene needs at least one move with a purpose: push_in to stress something, pan to open up the space, follow to travel with an action. Do not repeat the same move, or the same angle, in more than two shots in a row. Keep static for dialogue, a pause, an emotional landing.
4. Video models fail more on big, fast motion and on close-ups of a moving character. Save those for the one or two shots that need them; a slow push_in, pan or follow on a wide shot is safe.
5. Describe what should be seen, never what to avoid. Describe one composition: place things by foreground, background and distance, never by splitting the frame into top and bottom or left and right parts ("face in the upper half, net in the lower half"); image models draw that literally as a two-panel collage. Say "close-up of the face, hands holding the net along the bottom edge of the frame" instead.

Size (size)
- extreme_wide: the place, its scale, a lone character. Opens or closes a scene.
- wide: a character inside their surroundings. full: the whole body, walking, gestures.
- medium: waist up, everyday talk and action.
- close_up: a face or key object; feelings, reactions.
- extreme_close_up: one tiny detail; once or twice in a film.

Angle (angle)
- eye_level: neutral default. high: small, exposed. low: strong, imposing.
- overhead: map-like, rare. over_shoulder: two people talking. side: motion across the frame.
- back: following someone, or hiding the face. dutch: unease; sparingly.

Camera move (cameraMove: a preset id, or null)
- static: calm, watching; for dialogue, a pause, an emotional landing.
- push_in: focus, closeness, dread. pull_out: reveal, or leaving someone alone.
- pan: sweeping a space. tilt: height or scale. follow: travelling with the subject.
- orbit: all sides of a subject; short shots only. handheld: urgency, realism.
- crane: rising or sinking; arrival, grand reveal, farewell. slow_motion: lingering on a moment.
Never combine two moves. Your own words also work ("slow push toward her face"); they go into the video prompt exactly as written, so keep them short.

Pace (durationSec, 1 to 15, default 3)
- 2 to 3 s is quick and tense, 4 to 6 s natural, 7 s or more for a reveal, a quiet beat or the last image.
- Shape a scene: set up, build, peak, release. Put a quieter shot beside the peak; let the last shot run longest.

Light (lighting, timeOfDay, mood)
- Say where light comes from and how hard: soft window light, hard noon sun, backlight, one lamp in the dark, flat overcast.
- Keep light and time of day constant within a scene.
- Warm and soft: comfort. Cool and dim: loneliness. Strong contrast: tension. Backlight at dawn or dusk: reveal.

Cuts only
The app joins shots with straight cuts. There is no dissolve, fade or wipe, so do not write them into descriptions. To smooth a cut, echo a shape, colour or direction across it, cut mid-action, or let narration or music run over it.

Feeling to shot
Starting points, not laws:
- Lonely: extreme_wide or wide, subject small in a corner; high or eye_level; a very slow pull_out, or static; 4 to 6 s; cold, dim, one light.
- Warm, trusting: medium then close_up; eye_level (over_shoulder for two people); slow push_in, or static on the words; 3 to 5 s; soft warm light.
- Tense: alternate close_up and wide; dutch, low or back; handheld, push_in as something closes in; 2 to 3 s; hard light, strong contrast.
- Reveal, awe: close_up reaction then extreme_wide (or reverse); low or overhead; pull_out, crane or tilt; hold the reveal 5 s or more after a small, short shot; backlight.
- Calm ending: wide or medium, steady; eye_level; slow pull_out, or static on the last image; one slow_motion detail; last shot 5 s or more; softer light.

Check each scene: sizes vary, at least one move has a purpose, no move or angle repeats more than twice in a row, neighbours differ, light is consistent, no shot does two things.
`

/** 使用者自己改過的分鏡準則、製片與一致性指南（設定頁）優先，沒改就是內建的。 */
export function guideText(
  topic: GuideTopic,
  customStoryboardGuide: string,
  customProductionGuide = '',
): string {
  if (topic === 'getting-started') return gettingStarted()
  if (topic === 'cinematography') return CINEMATOGRAPHY
  if (topic === 'spending') return spending()
  if (topic === 'sound') return SOUND
  if (topic === 'production') return resolveProductionGuide(customProductionGuide)
  return `# Storyboard guide (set by the user in Settings; this is what the app's own AI storyboard step uses)\n\n${resolveStoryboardGuide(customStoryboardGuide)}\n`
}
