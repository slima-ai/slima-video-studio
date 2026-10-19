import { resolveStoryboardGuide } from '@svs/schema'

/** `load_guide` 的主題。內容寫在這裡（隨 App 版本更新），不寫進伺服器的 instructions（每個工作階段都要付的長度）。 */
export const GUIDE_TOPICS = ['getting-started', 'storyboard', 'spending'] as const
export type GuideTopic = (typeof GUIDE_TOPICS)[number]

const GETTING_STARTED = `# Making a video with Slima Video Studio

You are connected to the user's own copy of the app, running on their computer. Everything you change appears in the app window in real time.

Typical order (use only the tools that exist; call get_capabilities for the current list):
1. get_capabilities — mode (demo or real), current project, spending allowance.
2. list_projects / create_project / open_project — pick or start a project. open_project and create_project switch the project shown in the app window; tell the user before doing it if they might be working in it.
3. Spending tools (anything that calls an AI model) are checked against the spending allowance first. See load_guide("spending").

Notes
- Work in small steps and look at results before spending more.
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
