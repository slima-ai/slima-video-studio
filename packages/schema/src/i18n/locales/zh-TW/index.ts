// 繁體中文字串檔（key 的型別從這裡來）。每個功能一個檔案；新增檔案時用 tools/i18n/codemod.mjs，或手動加在標記前。
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
import { list } from './list'
import { canvas } from './canvas'
import { files } from './files'
import { queue } from './queue'
import { records } from './records'
import { outline } from './outline'
import { storyboard } from './storyboard'
import { sound } from './sound'
import { slima } from './slima'
import { graph } from './graph'
import { history } from './history'
import { footer } from './footer'
import { services } from './services'
import { labels } from './labels'
import { errors } from './errors'
import { mock } from './mock'
import { nodes } from './nodes'
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
  ...chat,
  ...claude,
  ...list,
  ...canvas,
  ...files,
  ...queue,
  ...records,
  ...outline,
  ...storyboard,
  ...sound,
  ...slima,
  ...graph,
  ...history,
  ...footer,
  ...services,
  ...labels,
  ...errors,
  ...mock,
  ...nodes,
  // <i18n:spread>
} as const
