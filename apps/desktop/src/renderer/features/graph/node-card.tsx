import type { GraphCategory, GraphNodeStatus, GraphNodeView } from '@svs/schema'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'

import { assetUrl } from '../../lib/asset'
import { cn } from '../../lib/cn'
import { usageLine } from '../../lib/usage'
import { t, msg, type MessageRef } from '@svs/schema'

export type GraphFlowNode = Node<{ view: GraphNodeView }, 'step'>

const CATEGORY_BAR: Readonly<Record<GraphCategory, string>> = {
  input: 'bg-sky-400',
  prompt: 'bg-violet-400',
  image: 'bg-emerald-400',
  video: 'bg-amber-400',
  join: 'bg-pink-400',
  output: 'bg-slate-400',
}

export const STATUS_LABEL: Readonly<Record<GraphNodeStatus, MessageRef>> = {
  idle: msg('graph.notGenerated'),
  running: msg('graph.generating'),
  succeeded: msg('graph.done'),
  cached: msg('graph.reusingTheLastResult'),
  failed: msg('graph.failed'),
  blocked: msg('graph.anEarlierStepFailedSo'),
  cancelled: msg('graph.cancelled'),
}

const STATUS_TONE: Readonly<Record<GraphNodeStatus, string>> = {
  idle: 'bg-surface-overlay text-fg-muted',
  running: 'bg-accent/20 text-accent',
  succeeded: 'bg-success-soft text-success',
  cached: 'bg-success-soft text-success',
  failed: 'bg-danger-soft text-danger',
  blocked: 'bg-surface-overlay text-fg-muted',
  cancelled: 'bg-surface-overlay text-fg-muted',
}

function Preview({ view }: { view: GraphNodeView }) {
  const { preview } = view
  if (!preview) return null
  if (preview.kind === 'image') {
    return (
      <img
        data-testid="node-preview-image"
        src={assetUrl(preview.hash)}
        alt={t('graph.resultOf', { title: view.title })}
        className="aspect-video w-full rounded object-cover"
      />
    )
  }
  if (preview.kind === 'video') {
    return (
      <video
        data-testid="node-preview-video"
        src={assetUrl(preview.hash)}
        muted
        controls
        preload="metadata"
        className="nodrag aspect-video w-full rounded bg-black"
      />
    )
  }
  return (
    <p data-testid="node-preview-text" className="line-clamp-4 text-xs text-fg-muted">
      {preview.text}
    </p>
  )
}

/** 節點卡片：色條、名稱、用的模型、來源、狀態，以及這一步產生的畫面或影片。 */
export function NodeCard({ data, selected }: NodeProps<GraphFlowNode>) {
  const { view } = data
  const usage = usageLine(view)
  return (
    <div
      data-testid={`graph-node-${view.id}`}
      data-status={view.status}
      className={cn(
        'w-72 overflow-hidden rounded-lg border bg-surface-raised text-sm shadow-lg',
        selected ? 'border-accent' : 'border-border',
      )}
    >
      <div className={cn('h-1.5', CATEGORY_BAR[view.category])} />
      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-medium">{view.title}</h3>
          <span
            data-testid="node-status"
            className={cn('shrink-0 rounded px-1.5 py-0.5 text-xs', STATUS_TONE[view.status])}
          >
            {t(STATUS_LABEL[view.status])}
          </span>
        </div>
        {view.modelName ? (
          <p className="text-xs text-fg-muted">{t('graph.model', { modelName: view.modelName })}</p>
        ) : null}
        {view.summary ? <p className="line-clamp-2 text-xs text-fg-muted">{view.summary}</p> : null}
        {view.sources.length > 0 ? (
          <p data-testid="node-sources" className="text-xs text-fg-muted">
            {t('graph.from', { value: view.sources.join(t('list.comma')) })}
          </p>
        ) : null}
        <Preview view={view} />
        {view.error ? (
          <p role="alert" className="text-xs text-danger">
            {view.error}
          </p>
        ) : null}
        {usage ? (
          <p data-testid="node-usage" className="text-xs text-fg-muted">
            {usage}
          </p>
        ) : null}
      </div>
      {view.inputs.map((port, index) => (
        <Handle
          key={`in-${port.name}`}
          id={port.name}
          type="target"
          position={Position.Left}
          style={{ top: 28 + index * 18 }}
          title={port.name}
        />
      ))}
      {view.outputs.map((port, index) => (
        <Handle
          key={`out-${port.name}`}
          id={port.name}
          type="source"
          position={Position.Right}
          style={{ top: 28 + index * 18 }}
          title={port.name}
        />
      ))}
    </div>
  )
}
