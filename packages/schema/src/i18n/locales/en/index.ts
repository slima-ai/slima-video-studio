// English strings. Same keys as zh-TW (the compiler checks it: see EnglishDictionary in ../../dictionary.ts).
import { menu } from './menu'
import { help } from './help'
import { onboarding } from './onboarding'
// <i18n:imports>

export const en = {
  ...menu,
  ...help,
  ...onboarding,
  // <i18n:spread>
} as const
