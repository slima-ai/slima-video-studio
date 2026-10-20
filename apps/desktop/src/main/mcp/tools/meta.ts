import { z } from 'zod'

import { defineTool, type ToolContext } from './define'
import { GUIDE_TOPICS, guideText } from './guides'

/** 這個伺服器的全貌：模式、目前專案、用哪些模型、可以花多少、有哪些工具與指南。先呼叫它。 */
export function registerMetaTools(ctx: ToolContext): void {
  defineTool(ctx, {
    name: 'get_capabilities',
    title: 'What can I do here',
    description:
      'Call this first. Returns the app version, whether it runs in demo mode (fake results, never spends money) or real mode, the current project, the model in use for text/image/video, the spending allowance you may use, the available tools and the guides you can load.',
    input: {},
    hints: { readOnly: true },
    run: async () => {
      const [project, models] = await Promise.all([
        ctx.caller.call('project.current', {}),
        ctx.caller.call('models.list', {}),
      ])
      const settings = ctx.settings.get()
      const nameOf = (id: string | undefined): string | null =>
        id === undefined ? null : (models.models.find((m) => m.id === id)?.displayName ?? id)
      return {
        app: ctx.info,
        mode: settings.demoMode ? 'demo' : 'real',
        project: project ? { name: project.name, aspectRatio: project.aspectRatio } : null,
        models: {
          text: nameOf(models.selected.llm),
          image: nameOf(models.selected.t2i),
          video: nameOf(models.selected.i2v),
        },
        spending: {
          ...ctx.allowance.status(),
          note: settings.demoMode
            ? 'Demo mode: nothing you do spends real money.'
            : 'Real mode: tools that call an AI model are checked against this allowance. Only the user can change it (app Settings → AI tools).',
        },
        tools: [...ctx.toolNames],
        guides: [...GUIDE_TOPICS],
      }
    },
  })

  defineTool(ctx, {
    name: 'load_guide',
    title: 'Load a guide',
    description:
      'Load a guide by topic: "getting-started" (the order of work), "storyboard" (how to plan shots; the same guide the app uses, as edited by the user), "cinematography" (what each shot size, angle, camera move, pace and light does), "spending" (how the spending allowance works), "sound" (narration and music).',
    input: { topic: z.enum(GUIDE_TOPICS).describe('Which guide to load') },
    hints: { readOnly: true },
    run: ({ topic }) =>
      Promise.resolve({ topic, text: guideText(topic, ctx.settings.get().storyboardGuide) }),
  })
}
