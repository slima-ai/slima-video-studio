import { beatKindLabel, t, type BeatKind, type ShotView } from '@svs/schema'

import type { MenuEntry } from '../canvas/menus'
import { kindOf } from './script-strip'

export interface BeatMenuActions {
  setKind: (kind: 'video' | 'still' | 'card') => void
  addCardAfter: () => void
  remove: () => void
}

const CHECKED = '✓'

/**
 * 腳本條上按右鍵的選單：會動｜不動｜字卡（目前的打勾）、在後面加一張字卡、刪掉這一格。
 * 片名卡只能在後面加字卡，不能改種類、不能刪（沒有片名卡就不是完整的預告片）。
 * 動作都是一步復原；加了、刪了格子之後長度會跟目標不一樣，由設定欄的「自動調整」排回去。
 */
export function beatMenuEntries(beat: ShotView, actions: BeatMenuActions): MenuEntry[] {
  const current: BeatKind = kindOf(beat)
  const isTitle = current === 'title'
  const kinds = (['video', 'still', 'card'] as const).map((kind): MenuEntry => ({
    label: beatKindLabel(kind),
    ...(current === kind ? { hint: CHECKED } : {}),
    ...(kind === 'card' && current !== 'card' && !beat.card?.text
      ? { disabled: true, why: t('trailer.menu.cardNeedsText') }
      : {}),
    onSelect: () => {
      if (kind !== current) actions.setKind(kind)
    },
  }))
  return [
    ...(isTitle ? [] : kinds),
    {
      label: t('trailer.menu.addCard'),
      ...(isTitle ? {} : { separated: true }),
      onSelect: actions.addCardAfter,
    },
    {
      label: t('trailer.menu.remove'),
      separated: true,
      danger: true,
      ...(isTitle ? { disabled: true, why: t('trailer.menu.titleCannotRemove') } : {}),
      onSelect: () => {
        if (!isTitle) actions.remove()
      },
    },
  ]
}
