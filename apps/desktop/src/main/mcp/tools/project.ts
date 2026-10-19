import { basename } from 'node:path'
import { z } from 'zod'

import { McpToolError } from '../bridge'
import { defineTool, type ToolContext } from './define'

/** 專案的「代號」：專案資料夾的名稱（不含路徑）。AI 工具只看得到代號，看不到電腦上的完整路徑。 */
const refOf = (dir: string): string => basename(dir)

const projectView = (p: { id: string; name: string; aspectRatio: string }) => ({
  id: p.id,
  name: p.name,
  aspectRatio: p.aspectRatio,
})

export function registerProjectTools(ctx: ToolContext): void {
  defineTool(ctx, {
    name: 'list_projects',
    title: 'List projects',
    description:
      'List the projects in the app\'s projects folder, newest first. Each has a "ref" you can pass to open_project, and "current" says which one is open in the app window now.',
    input: {},
    hints: { readOnly: true },
    run: async () => {
      const { projects } = await ctx.caller.call('project.list', {})
      return {
        projects: projects.map((p) => ({
          ref: refOf(p.dir),
          name: p.name,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          current: p.current,
        })),
      }
    },
  })

  defineTool(ctx, {
    name: 'get_current_project',
    title: 'Get the current project',
    description: 'The project open in the app window right now, or null if none is open.',
    input: {},
    hints: { readOnly: true },
    run: async () => {
      const project = await ctx.caller.call('project.current', {})
      return { project: project ? projectView(project) : null }
    },
  })

  defineTool(ctx, {
    name: 'create_project',
    title: 'Create a project',
    description:
      'Create a new empty project and open it. NOTE: this closes the project currently shown in the app window and shows the new one instead, so the user sees the window change.',
    input: { name: z.string().trim().min(1).max(60).describe('Project name, e.g. the film title') },
    hints: { readOnly: false },
    run: async ({ name }) => {
      const project = await ctx.caller.call('project.createNew', { name })
      return { project: projectView(project) }
    },
  })

  defineTool(ctx, {
    name: 'open_project',
    title: 'Open a project',
    description:
      'Open an existing project by the "ref" from list_projects. NOTE: this switches the project shown in the app window, so the user sees the window change; avoid it while they may be editing another project.',
    input: { ref: z.string().min(1).describe('The "ref" of a project from list_projects') },
    hints: { readOnly: false, idempotent: true },
    run: async ({ ref }) => {
      const { projects } = await ctx.caller.call('project.list', {})
      const found = projects.find((p) => refOf(p.dir) === ref)
      if (!found) {
        throw new McpToolError(
          `找不到代號為「${ref}」的專案。請先用 list_projects 看有哪些專案。`,
          'project_not_found',
        )
      }
      const project = await ctx.caller.call('project.open', { dir: found.dir })
      return { project: projectView(project) }
    },
  })
}
