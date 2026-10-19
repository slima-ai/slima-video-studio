import type { ToolContext } from './define'
import { registerMetaTools } from './meta'
import { registerProjectTools } from './project'
import { registerSetupTools } from './setup'
import { registerShotTools } from './shots'
import { registerStoryTools } from './story'

/** 登錄所有工具。之後新增的工具都從這裡加。 */
export function registerAllTools(ctx: ToolContext): void {
  registerMetaTools(ctx)
  registerProjectTools(ctx)
  registerSetupTools(ctx)
  registerStoryTools(ctx)
  registerShotTools(ctx)
}
