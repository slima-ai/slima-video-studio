import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react'
import { ChevronDown, ChevronRight, Lock, Sparkles, Trash2 } from 'lucide-react'
import { memo, useEffect, useRef, useState, type CSSProperties } from 'react'

import { Spinner } from '../../components/skeleton'
import { useToast } from '../../components/toast'
import { assetUrl } from '../../lib/asset'
import { cn } from '../../lib/cn'
import {
  useCanvasActions,
  useConnectedPorts,
  useLinking,
  useLod,
  type RunEstimate,
} from './canvas-actions'
import { isRenamable } from './rename-box'
import { choicesFor } from './connection-rules'
import { blockedReason, deleteTip } from './delete-plan'
import { KindIcon } from './kind-icon'
import { OnelinerBody } from './oneliner'
import { anchorOf } from './run-confirm'
import {
  CUT_HEAD,
  CUT_SLOT_PITCH,
  GROUP_COLOR,
  KIND_COLOR,
  KIND_LABEL,
  PORT_TYPE_COLOR,
  portsOf,
  type CanvasNode,
  type CanvasNodeData,
  type PortDef,
} from './canvas-model'

const colorStyle = (kind: CanvasNodeData['kind']): CSSProperties =>
  ({ '--c': KIND_COLOR[kind] }) as CSSProperties

/** 連接點：點、滑過的小字，輸出點再多一顆「＋」。 */
function Port({ nodeId, port }: { nodeId: string; port: PortDef }) {
  const { openAdd, canAdd } = useCanvasActions()
  const linking = useLinking()
  const connected = useConnectedPorts().has(`${nodeId}|${port.id}`)
  const out = port.side === 'out'
  const addable =
    openAdd !== undefined &&
    (canAdd ? canAdd(port.id, port.side) : choicesFor(port.id, port.side).length > 0)
  // 拉線中：另一邊的點接得上就亮綠，接不上就淡掉
  const link =
    linking && linking.fromSide !== port.side
      ? linking.valid.has(`${nodeId}|${port.id}`)
        ? 'valid'
        : 'invalid'
      : undefined
  return (
    <>
      <Handle
        id={port.id}
        type={out ? 'source' : 'target'}
        position={out ? Position.Right : Position.Left}
        style={{
          top: port.top,
          // 主線的圓點用傳的東西的顏色（故事、畫面描述、圖、影片、成品）；參考一律灰色
          ...(port.tone === 'main' ? { '--port-c': PORT_TYPE_COLOR[port.type] } : {}),
        }}
        className={cn('svs-handle', port.tone === 'ref' && 'svs-handle-ref')}
        data-testid={`port-${nodeId}-${port.id}`}
        data-link={link}
        data-dangling={!connected}
      />
      <span className="port-label" data-side={port.side} data-link={link} style={{ top: port.top }}>
        {port.tone === 'ref' && port.side === 'in' && !port.label.startsWith('參考')
          ? `參考・${port.label}`
          : port.label}
      </span>
      {addable ? (
        <button
          type="button"
          aria-label={out ? `從「${port.label}」接一個新的` : `為「${port.label}」新增一個`}
          data-testid={`plus-${nodeId}-${port.id}`}
          data-side={port.side}
          className="port-plus nodrag"
          style={{ top: port.top }}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            openAdd(
              { nodeId, portId: port.id, side: port.side },
              // 輸出點的選單開在右邊，輸入點的開在左邊（選單約 248px 寬）
              { x: out ? rect.right + 8 : rect.left - 256, y: rect.top },
            )
          }}
        >
          ＋
        </button>
      ) : null}
    </>
  )
}

/** 拉線中這一格接不接得上：接得上的整格標綠、接不上的整格淡掉（拉出來的那一格不變）。 */
function useLinkState(id: string): 'valid' | 'invalid' | undefined {
  const linking = useLinking()
  if (!linking || linking.fromNode === id) return undefined
  return linking.validNodes.has(id) ? 'valid' : 'invalid'
}

/** 開啟詳情面板（鏡頭、圖、影片、剪輯）。 */
function OpenButton({ id }: { id: string }) {
  const { openPanel } = useCanvasActions()
  if (!openPanel) return null
  return (
    <button
      type="button"
      aria-label="開啟詳情"
      title="開啟詳情"
      data-testid={`open-${id}`}
      className="nodrag rounded px-1.5 py-0.5 text-xs hover:bg-fg/10"
      onClick={() => {
        openPanel(id)
      }}
    >
      ↗
    </button>
  )
}

/** ▶ 滑過時的說明：依這一格現在的狀態，說清楚按下去會做什麼。 */
export function runTipOf(data: CanvasNodeData): string {
  const status = data.status
  if (status === 'failed') return '重試這一步'
  if (data.kind === 'shot') return '生成這一鏡還缺的第一張畫面與影片'
  if (data.kind === 'image') {
    if (status === 'done') return '重做這一步：第一張畫面和影片都產生新的一版，舊的保留'
    if (status === 'stale') return '重跑：鏡頭改過了，第一張畫面和影片都重新生成'
    return '生成第一張畫面，接著生成影片（2 步）'
  }
  if (status === 'done') return '重做這一步：產生新的一版，舊的保留'
  if (status === 'stale') return '重跑影片：鏡頭改過了'
  return data.imageReady === true ? '生成影片' : '補跑第一張畫面後生成影片（2 步）'
}

/**
 * 刪除鈕：選到或滑過這一格才出現（用鍵盤停在上面也會出現）。刪不掉的照樣顯示但停用，滑過寫具體原因，
 * 按下去也會用提示再說一次；能刪的按下去就刪，提示附「復原」。
 */
function DeleteButton({
  id,
  data,
  selected,
  className,
}: {
  id: string
  data: CanvasNodeData
  selected: boolean
  className?: string
}) {
  const { deleteNode } = useCanvasActions()
  const toast = useToast()
  if (!deleteNode) return null
  const why = blockedReason({ data })
  return (
    <button
      type="button"
      aria-label="刪除"
      aria-disabled={why === undefined ? undefined : true}
      data-tip={why ?? deleteTip(data.kind)}
      data-testid={`delete-${id}`}
      className={cn(
        'nodrag flex size-6 shrink-0 items-center justify-center rounded transition-opacity',
        selected
          ? 'opacity-100'
          : 'opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100',
        why === undefined
          ? 'text-fg-muted hover:bg-danger/15 hover:text-danger'
          : 'cursor-not-allowed text-fg-subtle',
        className,
      )}
      onClick={(event) => {
        event.stopPropagation()
        if (why !== undefined) toast.show({ message: why })
        else deleteNode(id)
      }}
    >
      <Trash2 className="size-3.5" aria-hidden />
    </button>
  )
}

/** ▶ 執行；生成中換成 ■ 停止。說明用 data-tip（畫布統一顯示，確認面板打開時就收起來）。 */
function PlayButton({ id, data }: { id: string; data: CanvasNodeData }) {
  const { run, runEstimate, openRunMenu, stopNode } = useCanvasActions()
  const status = data.status
  const [tipText, setTipText] = useState<string>()
  if (status === 'running' || status === 'queued') {
    if (!stopNode) return null
    return (
      <button
        type="button"
        aria-label="停止"
        data-tip="停止這一鏡（做好的部分留著）"
        data-testid={`stop-${id}`}
        className="nodrag flex size-6 items-center justify-center rounded border border-border bg-surface text-[11px] hover:border-danger hover:text-danger"
        onClick={() => {
          stopNode(id)
        }}
      >
        ■
      </button>
    )
  }
  if (!run) return null
  const generating = data.kind === 'image' || data.kind === 'video'
  return (
    <span className="flex shrink-0 items-center">
      <button
        type="button"
        aria-label={status === 'failed' ? '重試' : '執行'}
        data-tip={tipText ? `${runTipOf(data)}・${tipText}` : runTipOf(data)}
        data-testid={`run-${id}`}
        className="nodrag rounded px-1.5 py-0.5 text-xs hover:bg-fg/10"
        onPointerEnter={() => {
          // 滑過就去問這一次大概多少錢，說明上補一句（說明 350 毫秒後才出現，來得及）
          setTipText(undefined)
          void runEstimate?.(id).then((estimate) => {
            if (estimate) setTipText(estimateText(estimate))
          })
        }}
        onClick={(event) => {
          run(id, anchorOf(event.currentTarget))
        }}
      >
        {status === 'failed' ? '重試' : '▶'}
      </button>
      {generating && openRunMenu ? (
        <button
          type="button"
          aria-label="選要跑多少"
          aria-haspopup="menu"
          data-tip="只跑這個、這個和後面的、整條"
          data-testid={`run-mode-${id}`}
          className="nodrag -ml-1 rounded px-1 py-0.5 text-[10px] text-fg-muted hover:bg-fg/10 hover:text-fg"
          onClick={(event) => {
            openRunMenu(id, anchorOf(event.currentTarget))
          }}
        >
          ▾
        </button>
      ) : null}
    </span>
  )
}

/** 預估的一句話：約多少錢、都生成好了、或為什麼還不能跑。 */
export function estimateText(estimate: RunEstimate): string {
  if (estimate.issue) return estimate.issue
  if (estimate.nothing) return '都已經生成好了'
  return `預估約 US$${estimate.usd.toFixed(2)}${estimate.lowerBound ? '（至少）' : ''}`
}

/** 生成中、排隊中：骨架畫面，寫這一步在做什麼、已經幾秒（排隊中說明在等什麼）。 */
function Working({ data }: { data: CanvasNodeData }) {
  const running = data.status === 'running'
  const [sec, setSec] = useState(0)
  useEffect(() => {
    if (!running) return undefined
    const from = Date.now()
    setSec(0)
    const timer = window.setInterval(() => {
      setSec(Math.floor((Date.now() - from) / 1000))
    }, 1000)
    return () => {
      window.clearInterval(timer)
    }
  }, [running])
  const text = running
    ? `${data.kind === 'image' ? '正在畫第一張畫面' : '正在生成影片'}… ${String(sec)} 秒`
    : data.kind === 'video'
      ? '排隊中：第一張畫面好了就開始'
      : '排隊中'
  return (
    <span
      data-testid="node-working"
      className="absolute inset-x-0 bottom-0 truncate rounded-b-md bg-black/55 px-2 py-1 text-center text-[11px] text-white"
    >
      {text}
    </span>
  )
}

const STATUS_BADGE: Readonly<Partial<Record<NonNullable<CanvasNodeData['status']>, string>>> = {
  queued: '排隊中',
  stale: '需要重跑',
  failed: '失敗',
}

/**
 * 卡片上一行「吃：… 出：…」：這一格吃哪些東西、做出什麼，每個名字前面的圓點是那種東西的顏色
 * （和連接點同色）。名字從連接點的定義來，所以和連線一致；已經有線接進來的亮著，還沒接的淡淡的。
 */
function IoLine({ id, data, bottom }: { id: string; data: CanvasNodeData; bottom: boolean }) {
  const connected = useConnectedPorts()
  const ports = portsOf(data)
  const eat = ports.filter((port) => port.side === 'in')
  const out = ports.filter((port) => port.side === 'out')
  // 影片節點沒有輸出連接點（成品由「放進成品」開關接），但它做出的就是影片
  if (data.kind === 'video' && out.length === 0) {
    out.push({ id: 'video-out', side: 'out', tone: 'main', type: 'video', label: '影片', top: 0 })
  }
  if (eat.length === 0 && out.length === 0) return null
  const group = (name: string, list: readonly PortDef[]) =>
    list.length === 0 ? null : (
      <span className="flex min-w-0 shrink-0 items-center gap-1" data-testid={`io-${name}`}>
        <b className="font-semibold">{name}：</b>
        {list.map((port) => {
          const linked = connected.has(`${id}|${port.id}`)
          return (
            <span
              key={port.id}
              data-testid={`io-${port.id}`}
              data-linked={linked}
              className={cn(
                'flex items-center gap-0.5 whitespace-nowrap',
                !linked && port.side === 'in' && 'opacity-60',
              )}
            >
              <i
                aria-hidden
                className="inline-block size-1.5 shrink-0 rounded-full"
                style={{ background: PORT_TYPE_COLOR[port.type] }}
              />
              {port.short ?? port.label}
            </span>
          )
        })}
      </span>
    )
  return (
    <p
      data-testid="node-io"
      className={cn(
        'lod-full flex shrink-0 items-center gap-x-2 overflow-hidden text-[11px] leading-[15px] text-fg-muted',
        bottom && 'mt-auto',
      )}
    >
      {group('吃', eat)}
      {group('出', out)}
    </p>
  )
}

function Title({ id, data }: { id: string; data: CanvasNodeData }) {
  const { focusNode, startRename } = useCanvasActions()
  // 角色、地點雙擊標題就地改名；鏡頭等其他格子雙擊還是置中
  const renamable = startRename !== undefined && isRenamable(id, data.kind)
  return (
    <b
      className="lod-mid flex min-w-0 cursor-default items-center gap-1.5 text-sm font-semibold"
      title={renamable ? '雙擊改名' : undefined}
      // 鏡頭號是自動編的、不能改名：雙擊是打開設定，先說清楚（不然會以為可以像場名一樣就地改）
      {...(data.kind === 'shot' ? { 'data-tip': '鏡頭號是自動編的；雙擊打開設定' } : {})}
      onDoubleClick={() => {
        if (renamable) startRename(id)
        else focusNode(id)
      }}
    >
      <KindIcon kind={data.kind} />
      <span className="truncate">{data.title}</span>
    </b>
  )
}

/** 16:9 縮圖：影片用 `<video>` 的第一格，圖用背景圖；還沒生成的是虛線空殼。 */
function Thumb({ data, ghost }: { data: CanvasNodeData; ghost: boolean }) {
  const lod = useLod()
  const busy = data.status === 'running' || data.status === 'queued'
  if (lod === 'low') return null
  if (busy) {
    const media = data.videoSrc ?? data.thumb
    return (
      <div
        className={cn(
          'lod-mid relative aspect-video w-full shrink-0 overflow-hidden rounded-md',
          media === undefined && 'svs-skeleton',
        )}
        style={data.thumb ? { background: data.thumb } : undefined}
      >
        {data.videoSrc ? (
          <video
            src={data.videoSrc}
            muted
            playsInline
            preload="metadata"
            className="size-full bg-black object-cover opacity-60"
          />
        ) : null}
        <Working data={data} />
      </div>
    )
  }
  if (ghost) {
    return (
      <div
        data-testid="node-ghost"
        className="lod-mid flex aspect-video w-full shrink-0 flex-col items-center justify-center gap-0.5 rounded-md border border-dashed border-fg-muted/60 text-[11px] text-fg-muted"
      >
        <span>還沒生成</span>
        <span className="lod-full text-fg-subtle">按 ▶ 開始</span>
      </div>
    )
  }
  if (data.videoSrc) {
    return (
      <video
        src={data.videoSrc}
        muted
        playsInline
        preload="metadata"
        aria-label={`${data.title}的預覽`}
        className="lod-mid aspect-video w-full shrink-0 rounded-md bg-black object-cover"
      />
    )
  }
  if (!data.thumb) return null
  return (
    <div
      className="lod-mid aspect-video w-full shrink-0 rounded-md bg-surface-overlay"
      style={{ background: data.thumb }}
    />
  )
}

/** 「放進成品」開關：關掉的鏡頭接成品時會跳過。 */
function InCutSwitch({ id, on }: { id: string; on: boolean }) {
  const { toggleInCut } = useCanvasActions()
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="放進成品"
      title={on ? '這一鏡會接進成品；關掉就跳過它' : '這一鏡接成成品時會跳過；打開才放進去'}
      data-testid={`incut-${id}`}
      className="nodrag lod-full flex shrink-0 items-center gap-1.5 rounded-full text-[11px] text-fg-muted"
      onClick={() => {
        toggleInCut(id)
      }}
    >
      放進成品
      <span
        aria-hidden
        className={cn(
          'relative inline-flex h-4 w-7 items-center rounded-full transition-colors duration-200',
          on ? 'bg-success' : 'bg-fg-muted/35',
        )}
      >
        <span
          className={cn(
            'absolute size-3 rounded-full bg-white shadow transition-transform duration-200',
            on ? 'translate-x-3.5' : 'translate-x-0.5',
          )}
        />
      </span>
    </button>
  )
}

/** 縮到最小（只畫色塊）時，鏡頭色塊上的大編號。 */
const numberOf = (title: string): string => /\d+/.exec(title)?.[0] ?? ''

/** 縮小時標題列的字小到看不見：鏡頭、一句話、角色、地點在卡片中間改寫一行大字的名稱（圖與影片有縮圖，不用）。 */
const NAMED_KINDS = new Set(['shot', 'oneliner', 'character', 'location'])

/**
 * 「AI 剛改」的小標記：貼在卡片左上角外面。滑過一下（算看過了）就收掉；選取、動它也會收掉。
 * 傳回 hover 事件要接的屬性，放在節點最外層。
 */
function useAiSeenOnHover(id: string, touched: boolean | undefined) {
  const { aiSeen } = useCanvasActions()
  const timer = useRef<number | undefined>(undefined)
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
    },
    [],
  )
  if (!touched || !aiSeen) return {}
  return {
    onMouseEnter: () => {
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        aiSeen(id)
      }, 1200)
    },
    onMouseLeave: () => {
      window.clearTimeout(timer.current)
    },
  }
}

function AiBadge({ id }: { id: string }) {
  return (
    <span
      data-testid={`ai-badge-${id}`}
      className="pointer-events-none absolute -top-2.5 left-3 z-10 flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold leading-none text-accent-fg shadow-card"
    >
      <Sparkles aria-hidden className="size-3" />
      AI 剛改
    </span>
  )
}

function CardImpl({ id, data, selected }: NodeProps<CanvasNode>) {
  const aiHover = useAiSeenOnHover(id, data.aiTouched)
  const generating = data.kind === 'image' || data.kind === 'video'
  const status = data.status
  const ghost = generating && status === 'idle'
  const badge = status ? STATUS_BADGE[status] : undefined
  const linkState = useLinkState(id)
  return (
    <div
      className="group/card relative size-full"
      data-testid={`node-${id}`}
      data-status={status}
      data-kind={data.kind}
      data-born={data.born}
      data-ai-flash={data.aiFlash}
      data-linkstate={linkState}
      {...aiHover}
    >
      {data.aiTouched ? <AiBadge id={id} /> : null}
      <div
        className={cn(
          'svs-card flex size-full flex-col rounded-lg border border-border bg-surface-raised text-fg shadow-card transition-shadow hover:shadow-lg',
          // 一句話的下拉選單會長出卡片外面，不能裁切
          data.kind === 'oneliner' ? 'overflow-visible' : 'overflow-hidden',
          selected && 'ring-2 ring-accent ring-offset-2 ring-offset-surface',
          data.inCut === false && 'opacity-55',
          ghost && 'border-dashed border-fg-muted/70',
          status === 'stale' && 'border-l-[var(--c)] [border-left-style:dashed]',
          data.glow && 'svs-glow',
        )}
        style={colorStyle(data.kind)}
      >
        <div
          className={cn(
            'relative flex h-9 shrink-0 items-center justify-between gap-2 rounded-t-[7px] px-3',
            status === 'running' && 'svs-bar-running',
          )}
          style={{ background: 'color-mix(in srgb, var(--c) 14%, transparent)' }}
        >
          <Title id={id} data={data} />
          <span className="lod-mid flex shrink-0 items-center gap-1.5">
            {/* 圖與影片的狀態標記放在內文那一行，不佔標題列（標題要完整顯示鏡頭號） */}
            {!generating && badge ? (
              <span className="rounded-full bg-accent px-2 py-px text-[11px] text-accent-fg">
                {badge}
              </span>
            ) : null}
            {generating || data.kind === 'shot' ? (
              <>
                {data.kind === 'shot' ? <OpenButton id={id} /> : null}
                <PlayButton id={id} data={data} />
              </>
            ) : null}
            {generating ? null : <DeleteButton id={id} data={data} selected={selected} />}
          </span>
        </div>
        {data.kind === 'shot' ? (
          <span aria-hidden className="lod-low-only svs-block-number">
            {numberOf(data.title)}
          </span>
        ) : NAMED_KINDS.has(data.kind) ? (
          <span aria-hidden className="lod-low-only svs-block-number svs-block-word">
            <span className="truncate">{data.title}</span>
          </span>
        ) : null}
        {NAMED_KINDS.has(data.kind) && !data.thumb ? (
          <span aria-hidden className="lod-mid-only svs-mid-name">
            <span className="truncate">{data.title}</span>
          </span>
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 px-3 py-2">
          {data.kind === 'shot' ? (
            <>
              <ShotDescription id={id} text={data.summary ?? ''} />
              {data.dialogue ? <ShotDialogue id={id} text={data.dialogue} /> : null}
              <p className="lod-full flex items-center gap-1.5 text-xs text-fg-muted">
                <span className="min-w-0 truncate">{data.meta}</span>
                {data.sceneId === undefined ? (
                  <span
                    data-testid="loose-badge"
                    data-tip="這個鏡頭不屬於任何場，不會接進成品；把它拖進場框，或按畫布上方的「歸進」"
                    className="shrink-0 rounded-full border border-warning px-2 py-px text-[11px] text-warning"
                  >
                    沒歸場
                  </span>
                ) : null}
              </p>
              <IoLine id={id} data={data} bottom={false} />
              <div className="lod-full flex flex-wrap gap-1">
                {(data.tags ?? []).map((tag) => {
                  const locked = data.lockedTags?.[tag]
                  return (
                    <span
                      key={tag}
                      data-testid="shot-character-tag"
                      title={
                        locked === undefined
                          ? undefined
                          : `${tag} 已鎖定第 ${String(locked)} 版：生成時會帶入固定外觀與參考圖`
                      }
                      className="inline-flex items-center gap-0.5 rounded border border-border px-1.5 text-[11px] text-fg-muted"
                    >
                      {locked === undefined ? (
                        tag
                      ) : (
                        <>
                          <Lock className="size-2.5" aria-label="已鎖定" />
                          {`${tag} v${String(locked)}`}
                        </>
                      )}
                    </span>
                  )
                })}
              </div>
            </>
          ) : null}
          {data.kind === 'oneliner' ? <OnelinerBody id={id} data={data} /> : null}
          {generating ? (
            <div className="lod-full flex h-4 items-center justify-between gap-2 text-xs text-fg-muted">
              <span className="flex min-w-0 items-center gap-1.5">
                {status === 'running' ? (
                  <span
                    data-testid="running-badge"
                    className="flex shrink-0 items-center gap-1 rounded-full bg-accent px-2 py-px text-[11px] text-accent-fg"
                  >
                    <Spinner label="生成中" />
                    生成中
                  </span>
                ) : null}
                {badge ? (
                  <span className="shrink-0 rounded-full bg-accent px-2 py-px text-[11px] text-accent-fg">
                    {badge}
                  </span>
                ) : null}
                <span className="truncate">{ghost ? '' : data.summary}</span>
              </span>
              {data.kind === 'video' ? <InCutSwitch id={id} on={data.inCut !== false} /> : null}
            </div>
          ) : null}
          {generating && status === 'failed' && data.error ? (
            <p
              data-testid="node-error"
              className="lod-full line-clamp-2 text-xs leading-snug text-danger"
            >
              {data.error}
            </p>
          ) : null}
          {data.kind === 'character' || data.kind === 'location' ? (
            <p className="lod-full line-clamp-2 text-xs text-fg-muted">{data.summary}</p>
          ) : null}
          {data.kind === 'note' ? <NoteBody id={id} text={data.summary ?? ''} /> : null}
          {generating || data.thumb || data.videoSrc ? <Thumb data={data} ghost={ghost} /> : null}
          {data.kind !== 'shot' && data.kind !== 'oneliner' && data.kind !== 'note' ? (
            <IoLine id={id} data={data} bottom />
          ) : null}
        </div>
        {generating && data.footer && !ghost ? (
          <p className="lod-full shrink-0 border-t border-border px-3 py-1.5 text-[11px] leading-[15px] text-fg-muted">
            <span className="block truncate">{data.footer}</span>
            <span className="block truncate" data-testid="node-usage">
              {data.usageText ?? '\u00a0'}
            </span>
          </p>
        ) : null}
      </div>
      {generating ? (
        // 圖與影片的標題要放得下「第 12 鏡・第一張畫面」：↗ 和刪除鈕不佔標題列，
        // 滑過、選到或鍵盤停上去才浮在卡片外面的右上角（一條小工具列）；▶ 一直都在標題列
        <span
          data-testid={`header-tools-${id}`}
          className={cn(
            'lod-mid absolute -top-[34px] right-1 z-10 flex items-center gap-0.5 rounded-md border border-border bg-surface-raised p-0.5 shadow-card transition-opacity focus-within:pointer-events-auto focus-within:opacity-100',
            selected
              ? 'opacity-100'
              : 'pointer-events-none opacity-0 group-hover/card:pointer-events-auto group-hover/card:opacity-100',
          )}
        >
          <OpenButton id={id} />
          <DeleteButton id={id} data={data} selected />
        </span>
      ) : null}
      {portsOf(data).map((port) => (
        <Port key={port.id} nodeId={id} port={port} />
      ))}
      {data.kind === 'shot' ? <StepsToggle id={id} expanded={data.expanded === true} /> : null}
      <span className="sr-only">{KIND_LABEL[data.kind]}</span>
    </div>
  )
}
export const CardNode = memo(CardImpl)

/** 鏡頭卡片右下角的「展開步驟 ▸」；展開時從卡片底部接到「整理 Prompt」。 */
function StepsToggle({ id, expanded }: { id: string; expanded: boolean }) {
  const { toggleSteps } = useCanvasActions()
  // 展開時卡片底部多一個連接點：卡片尺寸是固定給的，React Flow 不會自己重新量，要叫它量一次，線才接得上
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => {
    updateNodeInternals(id)
  }, [expanded, id, updateNodeInternals])
  return (
    <>
      {toggleSteps ? (
        <button
          type="button"
          data-testid={`steps-toggle-${id}`}
          aria-expanded={expanded}
          className="lod-full nodrag absolute bottom-1.5 right-2 flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] text-fg-muted hover:bg-fg/10 hover:text-fg"
          onClick={() => {
            toggleSteps(id)
          }}
        >
          {expanded ? '收合步驟' : '展開步驟'}
          {expanded ? (
            <ChevronDown className="size-3" aria-hidden />
          ) : (
            <ChevronRight className="size-3" aria-hidden />
          )}
        </button>
      ) : null}
      {expanded ? (
        <Handle
          id="shot-steps"
          type="source"
          position={Position.Bottom}
          isConnectable={false}
          className="svs-handle svs-step-handle"
        />
      ) : null}
    </>
  )
}

/** 「整理 Prompt」：送給模型的 Prompt，可以直接改（離開輸入框就存）；改過的可以回到自動整理的。 */
function PromptStep({
  shotKey,
  prompt,
  edited,
}: {
  shotKey: string
  prompt: string
  edited: boolean
}) {
  const { savePrompt } = useCanvasActions()
  const [draft, setDraft] = useState(prompt)
  // 後端的內容變了（別處改了、回到自動的）就跟著更新
  const [synced, setSynced] = useState(prompt)
  if (synced !== prompt) {
    setSynced(prompt)
    setDraft(prompt)
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      <textarea
        data-testid={`step-prompt-${shotKey}`}
        aria-label="送給模型的 Prompt"
        value={draft}
        maxLength={4000}
        onChange={(event) => {
          setDraft(event.target.value)
        }}
        onBlur={() => {
          const next = draft.trim()
          if (next !== '' && next !== prompt) savePrompt?.(shotKey, next)
        }}
        className="nodrag nowheel nopan min-h-0 flex-1 resize-none rounded border border-border bg-surface p-1.5 text-[11px] leading-snug"
      />
      <div className="flex h-4 items-center justify-between text-[11px] text-fg-muted">
        <span>{edited ? '你改過了' : '自動整理的'}</span>
        {edited ? (
          <button
            type="button"
            data-testid={`step-prompt-reset-${shotKey}`}
            className="nodrag rounded px-1 hover:bg-fg/10 hover:text-fg"
            onClick={() => savePrompt?.(shotKey, null)}
          >
            用自動整理的
          </button>
        ) : null}
      </div>
    </div>
  )
}

/** 展開步驟的一格：整理 Prompt、挑參考圖、送出模型。上面接上一步，下面（送出模型是右邊）接下一步。 */
function StepImpl({ id, data }: NodeProps<CanvasNode>) {
  const step = data.step
  const shotKey = data.shotId ?? ''
  if (!step) return null
  return (
    <div
      // 不能選、不能拖的格子 React Flow 會關掉滑鼠事件；裡面的 Prompt 和按鈕要能點，所以這裡打開
      className="svs-card group/card pointer-events-auto relative flex size-full flex-col gap-1.5 rounded-lg border border-dashed border-[var(--c)] bg-surface-raised px-3 py-2 text-fg shadow-card"
      style={colorStyle('step')}
      data-testid={`node-${id}`}
      data-kind="step"
      data-stage={step.stage}
    >
      <Handle
        id="step-in"
        type="target"
        position={Position.Top}
        isConnectable={false}
        className="svs-handle svs-step-handle"
      />
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-semibold">
          <KindIcon kind="step" />
          {data.title}
        </p>
        <DeleteButton id={id} data={data} selected={false} />
      </div>
      {step.stage === 'prompt' ? (
        <PromptStep shotKey={shotKey} prompt={step.prompt ?? ''} edited={step.edited === true} />
      ) : step.stage === 'refs' ? (
        (step.refs ?? []).length === 0 ? (
          <p className="text-[11px] leading-snug text-fg-muted">
            這一鏡不帶參考圖（出場角色和地點都還沒鎖定）
          </p>
        ) : (
          <ul className="flex gap-1.5" data-testid={`step-refs-${shotKey}`}>
            {(step.refs ?? []).map((ref) => (
              <li key={ref.name} className="w-12 text-center text-[10px] text-fg-muted">
                <span
                  className="block aspect-square w-full rounded border border-border bg-surface-overlay"
                  style={
                    ref.assetHash
                      ? { background: `url("${assetUrl(ref.assetHash)}") center / cover` }
                      : undefined
                  }
                />
                <span className="block truncate">{ref.name}</span>
              </li>
            ))}
          </ul>
        )
      ) : (
        <p className="text-[11px] leading-snug text-fg-muted" data-testid={`step-model-${shotKey}`}>
          {step.model}
        </p>
      )}
      <Handle
        id="step-out"
        type="source"
        position={step.stage === 'model' ? Position.Right : Position.Bottom}
        isConnectable={false}
        className="svs-handle svs-step-handle"
      />
    </div>
  )
}
export const StepNode = memo(StepImpl)

/** 剪輯卡的成品：第一格當縮圖，按中間的 ▶ 就在卡片上播放（出現控制列）。還沒接過就是一塊底色。 */
function FinalPreview({ data }: { data: CanvasNodeData }) {
  const [playing, setPlaying] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  if (!data.videoSrc) {
    return <div className="aspect-video w-full rounded-md" style={{ background: data.thumb }} />
  }
  return (
    <div className="relative">
      <video
        ref={video}
        data-testid="cut-final-video"
        src={data.videoSrc}
        playsInline
        preload="metadata"
        controls={playing}
        aria-label="成品"
        className="nodrag nowheel aspect-video w-full rounded-md bg-black object-cover"
        onEnded={() => {
          setPlaying(false)
        }}
      />
      {playing ? null : (
        <button
          type="button"
          data-testid="cut-play"
          aria-label="播放成品"
          className="nodrag absolute inset-0 m-auto flex size-10 items-center justify-center rounded-full bg-black/60 text-base text-white hover:bg-black/75"
          onClick={() => {
            setPlaying(true)
            void video.current?.play().catch(() => {
              setPlaying(false)
            })
          }}
        >
          ▶
        </button>
      )}
    </div>
  )
}

/** 剪輯：直長型，每一場一個編號輸入槽，下面是成品縮圖。 */
function CutImpl({ id, data, selected }: NodeProps<CanvasNode>) {
  const { run, rejoinFinal, exportFinal } = useCanvasActions()
  const hasFinal = data.videoSrc !== undefined
  const slots = data.slots ?? []
  const linkState = useLinkState(id)
  return (
    <div
      className="group/card relative size-full"
      data-testid={`node-${id}`}
      data-status={data.status}
      data-linkstate={linkState}
    >
      <div
        className={cn(
          'svs-card flex size-full flex-col overflow-hidden rounded-lg border border-border bg-surface-raised text-fg shadow-card',
          selected && 'ring-2 ring-accent ring-offset-2 ring-offset-surface',
        )}
        style={colorStyle('cut')}
      >
        <span aria-hidden className="lod-low-only svs-block-number svs-block-word">
          <span className="truncate">{data.title}</span>
        </span>
        <div
          className="flex shrink-0 items-center justify-between px-3"
          style={{
            height: CUT_HEAD,
            background: 'color-mix(in srgb, var(--c) 14%, transparent)',
          }}
        >
          <Title id={id} data={data} />
          <span className="lod-mid flex items-center gap-1">
            <OpenButton id={id} />
            {run ? (
              <button
                type="button"
                aria-label="全部生成再接成成品"
                data-tip="把還沒生成的都生成，再接成一支影片"
                data-testid="run-cut"
                className="nodrag rounded px-1.5 py-0.5 text-xs hover:bg-fg/10"
                onClick={(event) => {
                  run(id, anchorOf(event.currentTarget))
                }}
              >
                ▶
              </button>
            ) : null}
            <DeleteButton id={id} data={data} selected={selected} />
          </span>
        </div>
        <div
          className="flex shrink-0 flex-col gap-1 px-3 pt-2"
          style={{ height: slots.length * CUT_SLOT_PITCH + 12 }}
        >
          {slots.map((slot, index) => (
            <div
              key={slot.id}
              className="lod-full flex h-7 items-center gap-2 rounded-md border border-border px-2 text-xs"
            >
              <em className="inline-flex size-[18px] items-center justify-center rounded-full bg-accent text-[11px] not-italic text-accent-fg">
                {index + 1}
              </em>
              <span className="flex-1">第 {index + 1} 場</span>
              {slot.note ? (
                <span
                  className={cn(
                    'text-[11px]',
                    slot.partial === true ? 'font-semibold text-warning' : 'text-fg-muted',
                  )}
                  title={slot.why}
                >
                  {slot.note}
                </span>
              ) : null}
            </div>
          ))}
        </div>
        <div className="lod-mid flex flex-col gap-1 px-3 pb-2">
          <FinalPreview data={data} />
          <p
            data-testid="cut-footer"
            title={data.footer}
            className={cn(
              'lod-full truncate text-[11px]',
              data.finalStale === true ? 'font-semibold text-warning' : 'text-fg-muted',
            )}
          >
            {data.footer}
          </p>
          {/* 有成品才能重新接、匯出；還沒接過就用 ▶ 先接一次 */}
          <div className="lod-full flex gap-1.5">
            <button
              type="button"
              data-testid="cut-rejoin"
              disabled={!hasFinal || !rejoinFinal}
              title="用每一鏡現在用的影片重新接成一支（在本機處理、免費）"
              className="nodrag flex-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-fg/10 disabled:opacity-40"
              onClick={() => rejoinFinal?.()}
            >
              接成成品
            </button>
            <button
              type="button"
              data-testid="cut-export"
              disabled={!hasFinal || !exportFinal}
              title="把成品存成 MP4，放在專案的「匯出」資料夾"
              className="nodrag flex-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-fg/10 disabled:opacity-40"
              onClick={() => exportFinal?.()}
            >
              匯出 MP4
            </button>
          </div>
        </div>
      </div>
      {portsOf(data).map((port) => (
        <Port key={port.id} nodeId={id} port={port} />
      ))}
    </div>
  )
}
export const CutNode = memo(CutImpl)

/** 場框：群組框，隨內容伸縮；拖鏡頭經過時亮起並提示。 */
function FrameImpl({ id, data, selected }: NodeProps<CanvasNode>) {
  const { startRename, focusNode } = useCanvasActions()
  const linkState = useLinkState(id)
  const aiHover = useAiSeenOnHover(id, data.aiTouched)
  return (
    <div
      className="group/card relative size-full"
      data-testid={`node-${id}`}
      data-born={data.born}
      data-ai-flash={data.aiFlash}
      data-linkstate={linkState}
      {...aiHover}
    >
      {data.aiTouched ? <AiBadge id={id} /> : null}
      <div
        data-drop={data.hint !== undefined}
        data-selected={selected}
        className="svs-frame size-full rounded-2xl border-[1.5px] border-dashed border-border bg-accent/[0.04]"
      >
        <p
          className="svs-frame-grip svs-frame-title absolute inset-x-0 top-0 h-9 cursor-grab truncate px-4 pt-2.5 text-[13px] font-semibold text-fg-muted active:cursor-grabbing"
          title={startRename ? '雙擊改名' : undefined}
          onDoubleClick={() => {
            if (startRename) startRename(id)
            else focusNode(id)
          }}
        >
          <KindIcon kind="scene" className="mr-1.5 inline align-[-2px]" />
          {data.title}
          {data.summary ? `\u3000${data.summary}` : ''}
        </p>
        <DeleteButton id={id} data={data} selected={selected} className="absolute right-3 top-2" />
        {/* 縮小時字會小到看不見：改成跟著縮放放大的「第 N 場」，一眼看得出結構 */}
        <p aria-hidden className="svs-frame-grip svs-frame-big">
          第 {data.sceneNo ?? ''} 場
        </p>
      </div>
      {portsOf(data).map((port) => (
        <Port key={port.id} nodeId={id} port={port} />
      ))}
    </div>
  )
}
export const FrameNode = memo(FrameImpl)

/**
 * 便條的字：雙擊（或選取後按 Enter）就地編輯，離開輸入框就存；Esc 放棄這次的修改。
 * 編輯中的輸入框不拖動格子、不捲動畫布。
 */
function NoteBody({ id, text }: { id: string; text: string }) {
  const { updateFree } = useCanvasActions()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(text)
  useEffect(() => {
    if (!editing) setValue(text)
  }, [text, editing])
  useEffect(() => {
    // 選取後按 Enter：畫布發一個事件叫這張便條進入編輯
    const onEdit = (event: Event): void => {
      if ((event as CustomEvent<string>).detail === id) setEditing(true)
    }
    window.addEventListener('svs-edit-note', onEdit)
    return () => {
      window.removeEventListener('svs-edit-note', onEdit)
    }
  }, [id])
  if (editing) {
    return (
      <textarea
        // 一打開就可以打字
        autoFocus
        data-testid="note-text"
        aria-label="便條的內容"
        value={value}
        maxLength={2000}
        className="nodrag nowheel nopan min-h-0 flex-1 resize-none rounded-md border border-border bg-surface p-1.5 text-xs leading-snug"
        onChange={(event) => {
          setValue(event.target.value)
        }}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') {
            setValue(text)
            setEditing(false)
          }
        }}
        onBlur={() => {
          setEditing(false)
          if (value !== text) updateFree?.(id, { text: value })
        }}
      />
    )
  }
  return (
    <p
      data-testid="note-view"
      className={cn(
        'line-clamp-5 min-h-0 flex-1 whitespace-pre-wrap text-xs leading-snug',
        text === '' && 'text-fg-subtle',
      )}
      onDoubleClick={() => {
        setEditing(true)
      }}
    >
      {text === '' ? '雙擊寫字' : text}
    </p>
  )
}

/**
 * 鏡頭的畫面描述：雙擊就地改，Enter（Shift+Enter 換行）或離開輸入框就存，Esc 放棄；
 * 清空或沒改就不存。編輯中的輸入框不拖動格子、不捲動畫布。
 */
function ShotDescription({ id, text }: { id: string; text: string }) {
  const { saveShotDescription } = useCanvasActions()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(text)
  const done = useRef(false)
  useEffect(() => {
    if (!editing) setValue(text)
  }, [text, editing])
  if (editing) {
    const finish = (commit: boolean): void => {
      if (done.current) return
      done.current = true
      setEditing(false)
      const next = value.trim()
      if (commit && next !== '' && next !== text) saveShotDescription?.(id, next)
      else setValue(text)
    }
    return (
      <textarea
        autoFocus
        data-testid="shot-desc-edit"
        aria-label="這一鏡的畫面描述"
        value={value}
        maxLength={1000}
        className="nodrag nowheel nopan lod-full h-[46px] shrink-0 resize-none rounded-md border border-accent bg-surface px-1 py-0.5 text-xs leading-snug"
        onChange={(event) => {
          setValue(event.target.value)
        }}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') {
            event.preventDefault()
            finish(false)
          } else if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            finish(true)
          }
        }}
        onBlur={() => {
          finish(true)
        }}
      />
    )
  }
  return (
    <p
      data-testid="shot-desc"
      title={saveShotDescription ? '雙擊修改描述' : undefined}
      className="lod-full line-clamp-2 text-xs leading-snug"
      onDoubleClick={() => {
        if (!saveShotDescription) return
        done.current = false
        setValue(text)
        setEditing(true)
      }}
    >
      {text}
    </p>
  )
}

/**
 * 鏡頭的旁白台詞（一句話勾了「旁白」拆鏡時寫的，或在面板寫的）：寫在描述下面一行，雙擊就地改，
 * Enter 或離開輸入框就存，Esc 放棄；清空就是不念。
 */
function ShotDialogue({ id, text }: { id: string; text: string }) {
  const { saveShotDialogue } = useCanvasActions()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(text)
  const done = useRef(false)
  useEffect(() => {
    if (!editing) setValue(text)
  }, [text, editing])
  if (editing) {
    const finish = (commit: boolean): void => {
      if (done.current) return
      done.current = true
      setEditing(false)
      const next = value.trim()
      if (commit && next !== text) saveShotDialogue?.(id, next)
      else setValue(text)
    }
    return (
      <input
        autoFocus
        data-testid="shot-dialogue-edit"
        aria-label="這一鏡的旁白"
        value={value}
        maxLength={200}
        className="nodrag nowheel nopan lod-full h-5 shrink-0 rounded-md border border-accent bg-surface px-1 text-[11px]"
        onChange={(event) => {
          setValue(event.target.value)
        }}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') {
            event.preventDefault()
            finish(false)
          } else if (event.key === 'Enter') {
            event.preventDefault()
            finish(true)
          }
        }}
        onBlur={() => {
          finish(true)
        }}
      />
    )
  }
  return (
    <p
      data-testid="shot-dialogue"
      title={saveShotDialogue ? '雙擊修改旁白' : undefined}
      className="lod-full truncate text-[11px] leading-snug text-fg-muted"
      onDoubleClick={() => {
        if (!saveShotDialogue) return
        done.current = false
        setValue(text)
        setEditing(true)
      }}
    >
      旁白：{text}
    </p>
  )
}

/** 自訂群組：框住幾格一起搬動，可以命名、換色；不影響資料。只有標題列是抓手。 */
function GroupImpl({ id, data, selected }: NodeProps<CanvasNode>) {
  const { updateFree, startRename } = useCanvasActions()
  const aiHover = useAiSeenOnHover(id, data.aiTouched)
  const color = data.color ?? 'slate'
  return (
    <div
      className="group/card relative size-full"
      data-testid={`node-${id}`}
      data-color={color}
      data-ai-flash={data.aiFlash}
      style={{ '--c': GROUP_COLOR[color].hex } as CSSProperties}
      {...aiHover}
    >
      {data.aiTouched ? <AiBadge id={id} /> : null}
      <div data-selected={selected} className="svs-group size-full rounded-2xl">
        <div className="svs-group-grip absolute inset-x-0 top-0 flex h-9 cursor-grab items-center gap-2 px-3 active:cursor-grabbing">
          <span
            className="svs-group-title truncate text-[13px] font-semibold"
            title={startRename ? '雙擊改名' : undefined}
            onDoubleClick={() => {
              startRename?.(id)
            }}
          >
            {data.title}
          </span>
          {selected ? (
            <span className="nodrag ml-auto flex shrink-0 gap-1" role="group" aria-label="群組顏色">
              {Object.entries(GROUP_COLOR).map(([key, swatch]) => (
                <button
                  key={key}
                  type="button"
                  data-testid={`group-color-${key}`}
                  aria-label={`換成${swatch.label}色`}
                  aria-pressed={key === color}
                  className={cn(
                    'size-4 rounded-full border-2',
                    key === color ? 'border-fg' : 'border-transparent hover:border-fg/40',
                  )}
                  style={{ background: swatch.hex }}
                  onClick={(event) => {
                    // 換完顏色就放開焦點：接著按 F2、方向鍵還是對這個群組
                    event.currentTarget.blur()
                    if (key !== color) updateFree?.(id, { color: key as keyof typeof GROUP_COLOR })
                  }}
                />
              ))}
            </span>
          ) : null}
          <DeleteButton
            id={id}
            data={data}
            selected={selected}
            className={selected ? '' : 'ml-auto'}
          />
        </div>
        {/* 縮小時字會小到看不見：改成跟著縮放放大的名字 */}
        <p aria-hidden className="svs-group-grip svs-group-big">
          {data.title}
        </p>
      </div>
    </div>
  )
}
export const GroupNode = memo(GroupImpl)

export const NODE_TYPES = {
  card: CardNode,
  cut: CutNode,
  frame: FrameNode,
  freeGroup: GroupNode,
  step: StepNode,
}
