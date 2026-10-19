import { isPortCompatible, type NodeDefinition } from '@svs/schema'

// 節點的型別與 defineNode 定義在 @svs/schema（工作流套件也要定義節點），引擎這裡轉出
export {
  defineNode,
  type InputSpec,
  type NodeDefinition,
  type NodeServices,
  type ReportedCost,
  type RunContext,
  type SubRunResult,
} from '@svs/schema'

/** 節點類型註冊表。 */
export class NodeRegistry {
  private readonly nodes = new Map<string, NodeDefinition>()

  register(definition: NodeDefinition): this {
    if (this.nodes.has(definition.type)) throw new Error(`節點類型重複註冊：${definition.type}`)
    this.nodes.set(definition.type, definition)
    return this
  }

  get(type: string): NodeDefinition | undefined {
    return this.nodes.get(type)
  }

  has(type: string): boolean {
    return this.nodes.has(type)
  }

  types(): string[] {
    return [...this.nodes.keys()]
  }
}

/** 輸出埠 → 輸入埠能不能連線（直接沿用 schema 的共用規則）。 */
export const canConnect = isPortCompatible
