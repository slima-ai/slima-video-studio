import {
  DEFAULT_TRAILER_GUIDE_EN,
  resolveProductionGuide,
  resolveStoryboardGuide,
} from '@svs/schema'

import {
  allowanceCard,
  cutCard,
  demoModeName,
  perRunLimitCard,
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
  'trailer',
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
7. Pictures then video (look before you spend on video): generate_first_frames → wait_for_generation → view_first_frames (you can SEE them; fix a wrong shot with update_shot, then regenerate_shot what="first_frame") → generate_videos → wait_for_generation → view_video_stills (check for extra limbs/faces, a changed character, flicker; redo with regenerate_shot what="video"; adopt_version goes back to an older version) → assemble_film (the app calls it ${joinIntoFilmButton()}, on the ${cutCard()} card) → view_video_stills with finalCut=true → export_film. To cut the start or end off a shot, use trim_shot (find the moment with view_video_stills atSeconds); assemble_film uses the cut and the sound follows the cut length, so trim BEFORE you plan narration and music.
8. Sound (after the videos exist; load_guide("sound") first): get_sound → plan_sound → generate_narration per shot (it reads the shot's dialogue) and generate_music → adjust_sound_clip / set_sound_settings → mix_sound (REQUIRED after any change made after assemble_film: adjusted clips, new narration or music, settings) → analyze_sound → export_film. Narration uses the voice chosen in Settings unless you pass a voiceId from list_models. You cannot hear it, so check the numbers and warnings in get_sound.
9. Before a step that costs money, estimate_cost tells you what it would cost and whether the allowance covers it: split_story_into_scenes, split_scene_into_shots, generate_first_frames, generate_videos (the same numbers the app shows in its own "generate all" confirmation). For sound, plan_sound shows the estimate (free). Tell the user the price in one line before you start. The app also checks the cost itself when you start a step and refuses, saying the estimate, if the allowance is too small (load_guide("spending")).

Notes
- Making a book trailer (a 15–120 s promo with text cards and a title card)? load_guide("trailer"), then plan_trailer(text) writes the whole script in place of steps 4 and 6 (split_story_into_scenes, split_scene_into_shots). Steps 5, 7 and 8 and the pictures, videos, trim_shot, sound, assemble_film and export_film are the same.
- Work in small steps and look at the result before spending more.
- Steps 4 and 5's "split" tools call a text model: free in demo mode, otherwise counted against the spending allowance (load_guide("spending")).
- Tool errors are plain-language messages; read them, they usually say what to do next.
`

const spending = (): string => `# Spending

- Demo mode never spends money. In real mode, every tool that calls an AI model (text, image or video) first estimates its cost and reserves it from the spending allowance.
- The allowance is the card ${allowanceCard()} under ${settingsAiTools()} in the app's Settings page; the person sets it and it starts at US$0. You cannot change it. If a tool says the allowance is too small, tell the user the estimate and ask them to raise ${allowanceCard()} there. Do not mix it up with ${perRunLimitCard()} under ${settingsGeneral()}: that one only caps a single generation, while ${allowanceCard()} caps everything AI tools spend in total.
- The reservation is a safety margin (the estimate times 1.25 for pictures and videos, times 2 for text). When everything has finished, the next tool you call turns it into what was really charged and gives the unused part back, so the allowance left grows again; while something is still generating it stays reserved. The user can also reset what has been used with ${resetUsedButton()} on that card.
- Moving from demo to real AI is something only the user can do, in two places: paste a service key (OpenRouter or fal.ai) on the card of that service under ${settingsApiKeys()} and press ${saveButton()}, then switch off ${demoModeName()} under ${settingsGeneral()}. ${settingsAiTools()} is NOT where keys go: it only lets AI tools like you connect to the app, and holds ${allowanceCard()}. If the user asks how to use real AI, tell them exactly this.
- Never try to work around a refusal.
`

const TRAILER = `# Making a book trailer

A trailer is not the whole story: it makes people want the story. The app writes the script (shots with seconds, picture, narration, text cards, a title card) and checks it against the rules below; you run the rest with the same tools as any film. Do not write the shots by hand with create_shot unless the user asks: plan_trailer already follows these rules and checks them.

Order of work
1. get_capabilities, then this guide. Ask the user (or take from their message) the book text, the length (default 30 s, 10–120 s), the kind (story: hook + three acts + title; teaser: 15–30 s social cut, no narration by default), the title, author, tagline and the last line (release date, where to buy). Blurbs, awards and sales figures: only the user's own words, passed in claims.
2. create_project (tell the user first; it switches the window), configure_project for the look, set_models if needed. plan_trailer with no project open creates one for you, also switching the window.
3. estimate_cost action plan_trailer (text price, free in demo mode), then plan_trailer(text, kind, targetSec, title, author, tagline, endLine). It REPLACES an earlier trailer script in the project (pass replaceGenerated=true only if the user agrees to lose generated pictures). It writes the script, checks it, writes again once if a rule fails, and fixes what is left by itself (fixedByTheApp lists what it changed). It also creates draft characters and place notes from the text.
4. get_trailer: look at every shot. beatKind video = moving picture (a video model makes it), still = one picture with a slow camera move made in the app (no video model, cheaper), card = text only, title = title card (title, author, tagline, end line, the cover if there is one). Check differenceSec (script seconds minus target: positive = too long), errors and warnings; errors must be fixed, warnings are advice. The shot's durationSec IS its length in the final film.
5. Fix with update_shot (durationSec, description, dialogue, cameraMove), add_card (a short text card after a shot), set_shot_motion (moving or still), update_trailer (settings; refit=true spreads the seconds again after a new targetSec). After any change that moves the total, get_trailer again until matches is true.
6. Characters: list_characters, then the usual generate_character_images → view_character_images → pick_character_image → lock_character (load_guide("production")). Draft characters from the script are not locked; unlocked looks drift between shots.
7. generate_first_frames (moving and still shots; cards and the title card need no picture) → view_first_frames → generate_videos (moving shots call the video model; still shots, cards and the title card are made inside the app and cost nothing) → wait_for_generation → view_video_stills. A video longer than its shot is cut to the shot's length; a shot longer than the video model's maximum gets a shorter video (get_trailer shows lengthOverMax): shorten the shot, make it still, or accept it.
8. Sound (load_guide("sound")): plan_sound → generate_narration per shot with narration → generate_music (the music description already follows the script) → assemble_film → mix_sound → analyze_sound → export_film. Trim BEFORE sound: trim_shot.
9. Check the length three ways and tell the user the numbers: get_trailer (scriptSec and filmSec), get_sound (totalSec, the sum of the shots' real lengths), and the exported file. They must agree with the target within one frame (about 0.04 s).

Money: moving shots and pictures cost money; text cards, still camera moves and the title card do not. Estimate before generating (estimate_cost) and say the price in one line first. Never raise the allowance yourself.

The rules the app writes and checks by
${DEFAULT_TRAILER_GUIDE_EN}

Shape of the film
- story: hook (about 13%: the strongest 1–2 pictures, no card or logo first) → world and hero (20%) → turn (17%, "until…") → escalate (30%, fast cuts of 1.5–2.5 s, little or no narration) → suspense (10%, one held picture, a question, a beat of near silence) → title (10%, cover, title, where to buy).
- teaser: the strongest picture first (about 2 s), then 3–5 fast picture shots with 2–3 short cards that together read as one question, then the title card. No narration, it must make sense with the sound off.
`

const SOUND = `# Sound

You cannot hear audio. You work with numbers: analyze_sound measures the assembled film (loudness around −16 LUFS, true peak below −1 dBTP, each shot's level, quiet stretches, warnings); get_sound shows every shot's start time in the film, its length, its dialogue, the adopted narration and music, and warnings; the user listens to the result in the app.

What the film's sound is made of
- The video model's own sound ("native audio", settings.nativeAudio). Asking for it makes video about 50% more expensive and only applies to videos generated after you turn it on. muteNativeShotIds silences it for some shots.
- Narration: one spoken line per shot, read from the shot's dialogue. Write or fix the line with update_shot (dialogue), then generate_narration(shotId). Each call makes a new version; adopt_sound_clip switches back. It starts 0.4 s after the shot starts. If the voiced line does not fit the shot, the text model shortens it once and it is voiced again: the shot's dialogue becomes the shorter line (generate_narration's result has shortened {from, to}) and it costs a second narration plus a small text call. If it is still too long, get_sound shows a warning: shorten the dialogue, lengthen the shot (update_shot durationSec) or use fewer words.
- Music: one instrumental track for the whole film (generate_music). In a trailer project the default description follows the script (each segment's start and end seconds and mood, a short silence before the title, one final accent, no vocals, the mood chosen in the trailer settings), the track is made 3 s longer than the film and fades out over the last 1.5 s; a prompt you pass replaces that description. A track shorter than the film is a warning. Music is quiet by default (−18 dB) and is lowered further while narration speaks (settings.duck). The user may import their own music file instead (the film panel's Sound area, "Use my own music…"): get_sound then shows source: imported and the file name. That track is the user's choice: do not generate new music over it, switch to another version or delete it; you can still adjust its volume and fade-out with adjust_sound_clip. A longer track is cut to the film length and fades out at the end.

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
  if (topic === 'trailer') return TRAILER
  if (topic === 'production') return resolveProductionGuide(customProductionGuide)
  return `# Storyboard guide (set by the user in Settings; this is what the app's own AI storyboard step uses)\n\n${resolveStoryboardGuide(customStoryboardGuide)}\n`
}
