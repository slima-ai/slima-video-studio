import type { ToolContext } from './define'
import { registerMetaTools } from './meta'
import { registerProjectTools } from './project'

/** 登錄所有工具。之後新增的工具都從這裡加。 */
export function registerAllTools(ctx: ToolContext): void {
  registerMetaTools(ctx)
  registerProjectTools(ctx)
}
