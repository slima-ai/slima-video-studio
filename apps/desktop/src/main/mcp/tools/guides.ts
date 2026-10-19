import { resolveStoryboardGuide } from '@svs/schema'

/** `load_guide` 的主題。內容寫在這裡（隨 App 版本更新），不寫進伺服器的 instructions（每個工作階段都要付的長度）。 */
export const GUIDE_TOPICS = ['getting-started', 'storyboard', 'spending'] as const
export type GuideTopic = (typeof GUIDE_TOPICS)[number]

const GETTING_STARTED = `# Making a video with Slima Video Studio

You are connected to the user's own copy of the app, running on their computer. Everything you change appears in the app window in real time.

Order of work (call get_capabilities for the tools that exist right now):
1. get_capabilities — mode (demo or real), current project, spending allowance, tools.
2. Project: list_projects / create_project / open_project. create_project and open_project switch the project shown in the app window; tell the user before doing it if they might be working in it.
3. Look and models: configure_project (art style, frame shape), list_models, set_models. In real mode the models decide the cost.
4. Story: split_story_into_scenes(story) turns the text into acts and scenes (and draft characters and locations). get_outline shows them; edit_outline fixes them.
5. Shots: load_guide("storyboard") first, then split_scene_into_shots(sceneId) for each scene. list_shots / get_shot to review, update_shot / create_shot / delete_shots / reorder_shots to improve. undo / redo work like the app's own.
6. Before any step that calls an AI model, estimate_cost tells you what it would cost and whether the allowance covers it.

Notes
- Work in small steps and look at the result before spending more.
- Steps 4 and 5's "split" tools call a text model: free in demo mode, otherwise counted against the spending allowance (load_guide("spending")).
- Tool errors are plain-language messages; read them, they usually say what to do next.
`

const SPENDING = `# Spending

- Demo mode never spends money. In real mode, every tool that calls an AI model (text, image or video) first estimates its cost and reserves it from the spending allowance.
- The allowance is set by the person in the app's Settings page and starts at US$0. You cannot change it. If a tool says the allowance is too small, tell the user the estimate and ask them to raise it in Settings → AI tools.
- Reserved money is not refunded if the real cost turns out lower; the user can reset it in Settings.
- Never try to work around a refusal.
`

/** 使用者自己改過的分鏡準則（設定頁）優先，沒改就是內建的。 */
export function guideText(topic: GuideTopic, customStoryboardGuide: string): string {
  if (topic === 'getting-started') return GETTING_STARTED
  if (topic === 'spending') return SPENDING
  return `# Storyboard guide (set by the user in Settings; this is what the app's own AI storyboard step uses)\n\n${resolveStoryboardGuide(customStoryboardGuide)}\n`
}
