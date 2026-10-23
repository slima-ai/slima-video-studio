// English strings. Same keys as zh-TW (the compiler checks it: see EnglishDictionary in ../../dictionary.ts).
import { menu } from './menu'
import { help } from './help'
import { onboarding } from './onboarding'
import { projects } from './projects'
import { shell } from './shell'
import { endFrame } from './endFrame'
import { shots } from './shots'
import { settings } from './settings'
import { chat } from './chat'
import { claude } from './claude'
// <i18n:imports>

export const en = {
  ...menu,
  ...help,
  ...onboarding,
  ...projects,
  ...shell,
  ...endFrame,
  ...shots,
  ...settings,
  ...chat,
  ...claude,
  // <i18n:spread>
} as const
