// 繁體中文字串檔（key 的型別從這裡來）。每個功能一個檔案；新增檔案時用 tools/i18n/codemod.mjs，或手動加在標記前。
import { menu } from './menu'
import { help } from './help'
import { onboarding } from './onboarding'
import { projects } from './projects'
import { shell } from './shell'
import { endFrame } from './endFrame'
import { shots } from './shots'
import { settings } from './settings'
// <i18n:imports>

export const zhTW = {
  ...menu,
  ...help,
  ...onboarding,
  ...projects,
  ...shell,
  ...endFrame,
  ...shots,
  ...settings,
  // <i18n:spread>
} as const
