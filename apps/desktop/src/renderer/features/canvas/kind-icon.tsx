import {
  BoxSelect,
  ListTree,
  Camera,
  Image as ImageIcon,
  Layers,
  MapPin,
  Scissors,
  Sparkles,
  StickyNote,
  User,
  Video,
  type LucideIcon,
} from 'lucide-react'

import { cn } from '../../lib/cn'
import { KIND_COLOR, type NodeKind } from './canvas-model'

/** 每種節點的圖示：標題旁、左側節點面板共用，一眼分辨場、角色、地點。 */
const KIND_ICON: Readonly<Record<NodeKind, LucideIcon>> = {
  oneliner: Sparkles,
  scene: Layers,
  shot: Camera,
  image: ImageIcon,
  video: Video,
  cut: Scissors,
  character: User,
  location: MapPin,
  freeImage: ImageIcon,
  freeVideo: Video,
  note: StickyNote,
  group: BoxSelect,
  step: ListTree,
}

export function KindIcon({ kind, className }: { kind: NodeKind; className?: string }) {
  const Icon = KIND_ICON[kind]
  return (
    <Icon
      aria-hidden
      className={cn('size-3.5 shrink-0', className)}
      style={{ color: KIND_COLOR[kind] }}
    />
  )
}

/** 種類色的底、種類圖示：節點面板與新增選單的項目前面用。 */
export function KindBadge({ kind }: { kind: NodeKind }) {
  return (
    <span
      className="flex size-6 shrink-0 items-center justify-center rounded-md"
      style={{ background: `color-mix(in srgb, ${KIND_COLOR[kind]} 20%, transparent)` }}
    >
      <KindIcon kind={kind} />
    </span>
  )
}
