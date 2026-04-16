import { ref, onUnmounted } from 'vue'
import { Graph } from '@antv/g6'
import dagre from 'dagre'
import '../edges/TraceEdge'
import '../edges/FlowEdge'
import '../nodes/FlowNode'
import { formatAmount } from '../utils/number'

export type LayoutType = 'dagre' | 'circular'

interface InitGraphOptions {
  onContextMenu?: (nodeId: string, clientX: number, clientY: number, direction: string) => void
}

function amountToLineWidth(amount: number): number {
  if (!amount || amount <= 0) return 1
  // 对数刻度：1万 → 1px，10亿 → 6px
  const logMin = Math.log10(1e4)
  const logMax = Math.log10(1e9)
  const logVal = Math.log10(Math.max(amount, 1e4))
  const ratio = Math.min((logVal - logMin) / (logMax - logMin), 1)
  return 1 + ratio * 5
}

  const LAYOUT_CONFIG = {
  dagre: {
    type: 'dagre',
    rankdir: 'LR',
    controlPoints: true,
    nodesep: 50,
    ranksep: 200,
    nodeSize: [260, 60],
  },
  circular: {
    type: 'circular' as const,
    radius: 280,
  },
}

export function useFundFlowGraph() {
  const currentLayout = ref<LayoutType>('dagre')
  const isTransitioning = ref(false)
  const showHiddenNodes = ref(false)

  let graphInstance: Graph | null = null

  // 当前高亮的边 ID 列表
  let highlightedEdgeIds: string[] = []
  let hoveredNodeId: string | null = null

  // 数据中 hidden:true 的节点 ID（初始隐藏集合）
  let initiallyHiddenIds: string[] = []
  const initiallyHiddenPositions = new Map<string, [number, number]>()
  const LOCAL_RANK_GAP = 180
  const LOCAL_NODE_GAP = 72
  const LOCAL_NODE_W = 200
  const LOCAL_NODE_H = 56
  const LOCAL_COLLIDE_PAD_X = 18
  const LOCAL_COLLIDE_PAD_Y = 12
  let dynamicNodeSeq = 0

  // ── 隐藏节点 ──────────────────────────────────────────

  function getAllDescendantsAny(rootId: string): { nodeIds: string[]; edgeIds: string[] } {
    if (!graphInstance) return { nodeIds: [], edgeIds: [] }

    const visited = new Set<string>()
    const allNodeIds: string[] = []
    const queue: string[] = [rootId]

    while (queue.length > 0) {
      const currentId = queue.shift()!
      const currentLevel = (graphInstance.getNodeData(currentId)?.data?.level as number) ?? 0
      const relatedEdges = graphInstance.getRelatedEdgesData(currentId, 'both')

      for (const edge of relatedEdges) {
        const neighborId = (edge.source === currentId ? edge.target : edge.source) as string
        const neighborLevel = (graphInstance.getNodeData(neighborId)?.data?.level as number) ?? 0

        if (neighborLevel > currentLevel && !visited.has(neighborId)) {
          visited.add(neighborId)
          allNodeIds.push(neighborId)
          queue.push(neighborId)
        }
      }
    }

    const hiddenSet = new Set(allNodeIds)
    const allEdgeIds = graphInstance
      .getEdgeData()
      .filter(e => hiddenSet.has(e.source as string) || hiddenSet.has(e.target as string))
      .map(e => e.id as string)
      .filter(Boolean)

    return { nodeIds: allNodeIds, edgeIds: allEdgeIds }
  }

  async function hideNode(nodeId: string) {
    if (!graphInstance) return
    const nodeData = graphInstance.getNodeData(nodeId)
    if (nodeData?.data?.direction === 'center') return // 源节点不可隐藏

    const { nodeIds: descendantIds, edgeIds: descendantEdgeIds } = getAllDescendantsAny(nodeId)

    const selfEdgeIds = graphInstance
      .getEdgeData()
      .filter(e => e.source === nodeId || e.target === nodeId)
      .map(e => e.id as string)
      .filter(Boolean)

    const allEdgeIds = [...new Set([...selfEdgeIds, ...descendantEdgeIds])]
    await graphInstance.hideElement([nodeId, ...descendantIds, ...allEdgeIds])
    await syncEdgeVisibility()
  }

  // ── 突出源点关联 ───────────────────────────────────────

  function findPathsToCenter(nodeId: string): string[] {
    if (!graphInstance) return []

    const memo = new Map<string, boolean>()
    const visiting = new Set<string>()
    const edgeIds = new Set<string>()

    const dfs = (currentId: string): boolean => {
      const cached = memo.get(currentId)
      if (cached !== undefined) return cached

      const currentLevel = (graphInstance!.getNodeData(currentId)?.data?.level as number) ?? 0
      if (currentLevel === 0) {
        memo.set(currentId, true)
        return true
      }

      if (visiting.has(currentId)) return false
      visiting.add(currentId)

      let canReachCenter = false
      const relatedEdges = graphInstance!.getRelatedEdgesData(currentId, 'both')

      for (const edge of relatedEdges) {
        const neighborId = (edge.source === currentId ? edge.target : edge.source) as string
        const neighborLevel = (graphInstance!.getNodeData(neighborId)?.data?.level as number) ?? 0

        // 仅沿“更接近源点”的方向回溯
        if (neighborLevel >= currentLevel) continue

        if (dfs(neighborId)) {
          if (edge.id) edgeIds.add(edge.id as string)
          canReachCenter = true
        }
      }

      visiting.delete(currentId)
      memo.set(currentId, canReachCenter)
      return canReachCenter
    }

    dfs(nodeId)
    return Array.from(edgeIds)
  }

  async function clearHighlight() {
    if (!graphInstance || highlightedEdgeIds.length === 0) return
    const clearStates: Record<string, string[]> = {}
    for (const id of highlightedEdgeIds) clearStates[id] = []
    await graphInstance.setElementState(clearStates, false)
    highlightedEdgeIds = []
  }

  async function highlightPath(nodeId: string) {
    if (!graphInstance) return
    await clearHighlight()

    const edgeIds = findPathsToCenter(nodeId)
    if (edgeIds.length === 0) return

    const nextStates: Record<string, string[]> = {}
    for (const id of edgeIds) nextStates[id] = ['highlighted']
    await graphInstance.setElementState(nextStates, false)
    highlightedEdgeIds = edgeIds
  }

  // ── 初始化图 ───────────────────────────────────────────

  function initGraph(
    container: HTMLElement,
    nodes: any,
    edges: any,
    options: InitGraphOptions = {},
  ) {
    if (graphInstance) return

    // 先隐藏容器，避免“先显示再隐藏”的首屏闪烁
    container.style.visibility = 'hidden'

    graphInstance = new Graph({
      container,
      autoFit: 'center',
      animation: true,
      data: {
        nodes: nodes as any,
        edges: edges as any,
      },
      node: {
        type: 'flow-node',
      },
      edge: {
        type: 'trace-edge',
        state: {
          highlighted: {
            stroke: '#f59e0b',
            endArrowFill: '#f59e0b',
            endArrowStroke: '#f59e0b',
            shadowColor: '#f59e0b',
            shadowBlur: 12,
          },
        },
        style: {
          lineDash: [7, 5],
          shadowColor: 'transparent',
          shadowBlur: 0,
          endArrow: true,
          // endArrowType: 'vee',
          endArrowFill: '#f00',
          endArrowStroke: '#22d3ee',
          lineWidth: (d: any) => amountToLineWidth(d.data?.amount ?? 0),
          endArrowSize: (d: any) => 6 + amountToLineWidth(d.data?.amount ?? 0),
          endArrowOffset: 0, // (d: any) => amountToLineWidth(d.data?.amount ?? 0),
          startLabelText: (d: any) => {
            if (d.__direction === 'left') {
              const amount = d.data.amount
              const txCount = d.data.txCount
              return `${txCount}笔\n${formatAmount(amount)}`
            }
          },
          endLabelText: (d: any) => {
            if (d.__direction === 'right') {
              const amount = d.data.amount
              const txCount = d.data.txCount
              return `${txCount}笔\n${formatAmount(amount)}`
            }
          },
          // labelText: (d: any) => formatAmount(d.data.amount),
          labelFill: '#94a3b8',
          labelFontSize: 10,
          labelBackground: true,
          labelBackgroundFill: '#1e293b',
          labelBackgroundOpacity: 0.9,
          labelBackgroundPadding: [2, 5, 2, 5] as [number, number, number, number],
          orthPath: {
            type: 'orth',
            radius: 20,
            directionSide: (d: any) => {
              if (d.__direction === 'left') return 'left'
              if (d.__direction === 'right') return 'right'
              return undefined
            },
            firstOffsetRatio: (_d: any) => 0.1,
            secondOffsetRatio: (_d: any) => 0.1,
          },
        },
      },
      layout: LAYOUT_CONFIG[currentLayout.value],
      plugins: [
        {
          type: 'tooltip',
          style: {
            '.tooltip': {
              background: 'unset',
              padding: 'unset',
            },
          },
          getContent: (e: any, items: any) => {
            const item = items[0]
            if (e.targetType === 'node') {
              return `
              <div style="cursor:default;background:rgba(5,12,28,0.96);border:1px solid rgba(0,212,255,0.2);border-radius:8px;padding:10px 14px;min-width:220px;box-shadow:0 4px 24px rgba(0,0,0,0.6)">
                <h4 style="margin:0 0 6px;color:#00D4FF;font-weight:600;font-size:12px">节点信息</h4>
                <div style="margin:3px 0;color:#9BB8D0;word-break:break-all;font-size:12px"><strong style="color:#C4DCEE">地址: </strong>${item.data.address}</div>
                ${item.data.label ? `<div style="margin:3px 0;color:#9BB8D0;font-size:12px"><strong style="color:#C4DCEE">标注: </strong>${item.data.label}</div>` : ''}
              </div>`
            } else if (e.targetType === 'edge') {
              return `
              <div style="cursor:default;background:rgba(5,12,28,0.96);border:1px solid rgba(0,212,255,0.2);border-radius:8px;padding:10px 14px;min-width:180px;box-shadow:0 4px 24px rgba(0,0,0,0.6)">
                <h4 style="margin:0 0 6px;color:#00D4FF;font-weight:600;font-size:12px">交易信息</h4>
                <div style="margin:3px 0;color:#9BB8D0;font-size:12px"><strong style="color:#C4DCEE">交易笔数: </strong>${item.data.txCount} 笔</div>
              </div>`
            }
            return '暂无信息'
          },
        },
      ],
      behaviors: ['drag-canvas', 'zoom-canvas', 'drag-element'],
    })

    graphInstance.render().then(async () => {
      if (!graphInstance) return
      initiallyHiddenIds = graphInstance
        .getNodeData()
        .filter(n => n.data?.hidden === true)
        .map(n => n.id as string)

      initiallyHiddenPositions.clear()
      for (const id of initiallyHiddenIds) {
        try {
          const p = graphInstance.getElementPosition(id as string)
          initiallyHiddenPositions.set(id, [p[0], p[1]])
        } catch {
          // ignore
        }
      }

      if (initiallyHiddenIds.length > 0) {
        const hiddenSet = new Set(initiallyHiddenIds)
        const edgeIds = graphInstance
          .getEdgeData()
          .filter(e => hiddenSet.has(e.source as string) || hiddenSet.has(e.target as string))
          .map(e => e.id as string)
          .filter(Boolean)
        await graphInstance.hideElement([...initiallyHiddenIds, ...edgeIds], false)
        await syncEdgeVisibility()
      }
    }).finally(() => {
      container.style.visibility = ''
    })

    // +/- 节点操作按钮点击：+ 新增子节点，- 隐藏当前节点
    graphInstance.on('node:click', async (event: any) => {
      if (event.targetType !== 'node') return
      const shapeName: string = event.originalTarget?.className ?? ''
      if (shapeName === 'toggle-btn-right-plus-bg') {
        await addRandomChildNode(event.target.id as string, 'right')
      } else if (shapeName === 'toggle-btn-left-plus-bg') {
        await addRandomChildNode(event.target.id as string, 'left')
      } else if (shapeName === 'toggle-btn-left-minus-bg' || shapeName === 'toggle-btn-right-minus-bg') {
        await hideNode(event.target.id as string)
      }
    })

    graphInstance.on('node:pointerenter', async (event: any) => {
      const nodeId = event.target?.id as string | undefined
      if (!nodeId || !graphInstance) return

      const updates: Array<{ id: string; style: Record<string, any> }> = []
      if (hoveredNodeId && hoveredNodeId !== nodeId) {
        updates.push({ id: hoveredNodeId, style: { showToggleControls: false } })
      }
      updates.push({ id: nodeId, style: { showToggleControls: true } })
      hoveredNodeId = nodeId

      graphInstance.updateNodeData(updates as any)
      await graphInstance.draw()
    })

    graphInstance.on('node:pointerleave', async (event: any) => {
      const nodeId = event.target?.id as string | undefined
      if (!nodeId || !graphInstance) return
      if (hoveredNodeId !== nodeId) return

      hoveredNodeId = null
      graphInstance.updateNodeData([{ id: nodeId, style: { showToggleControls: false } }] as any)
      await graphInstance.draw()
    })

    // 右键菜单
    graphInstance.on('node:contextmenu', (event: any) => {
      event.preventDefault?.()
      const nodeId = event.target?.id as string
      const nodeData = graphInstance!.getNodeData(nodeId)
      const direction = (nodeData?.data?.direction as string) ?? ''
      const clientX = event.clientX ?? event.client?.x ?? 0
      const clientY = event.clientY ?? event.client?.y ?? 0
      options.onContextMenu?.(nodeId, clientX, clientY, direction)
    })

    // 点击画布空白处清除高亮
    graphInstance.on('canvas:click', clearHighlight)
  }

  // ── 布局切换 ──────────────────────────────────────────

  async function switchLayout(type: LayoutType) {
    if (!graphInstance || isTransitioning.value || type === currentLayout.value) return

    isTransitioning.value = true
    currentLayout.value = type

    try {
      graphInstance.setLayout(LAYOUT_CONFIG[type])
      await graphInstance.layout()
    } finally {
      isTransitioning.value = false
    }
  }

  // ── 边可见性同步 ──────────────────────────────────────
  // 确保两端有任一节点被隐藏的边都不显示

  async function syncEdgeVisibility() {
    if (!graphInstance) return
    const toHide: string[] = []
    const toShow: string[] = []

    for (const edge of graphInstance.getEdgeData()) {
      const edgeId = edge.id as string
      if (!edgeId) continue
      const srcStyle = graphInstance.getElementRenderStyle(edge.source as string) as any
      const tgtStyle = graphInstance.getElementRenderStyle(edge.target as string) as any
      const edgeStyle = graphInstance.getElementRenderStyle(edgeId) as any
      const srcHidden = srcStyle?.visibility === 'hidden'
      const tgtHidden = tgtStyle?.visibility === 'hidden'
      const edgeHidden = edgeStyle?.visibility === 'hidden'

      if (srcHidden || tgtHidden) {
        if (!edgeHidden) toHide.push(edgeId)
      } else {
        if (edgeHidden) toShow.push(edgeId)
      }
    }

    if (toHide.length) await graphInstance.hideElement(toHide, false)
    if (toShow.length) await graphInstance.showElement(toShow, false)
  }

  function getNodeLevel(nodeId: string): number {
    if (!graphInstance) return 0
    return (graphInstance.getNodeData(nodeId)?.data?.level as number) ?? 0
  }

  function getNodeDirection(nodeId: string): 'left' | 'right' | 'center' {
    if (!graphInstance) return 'center'
    const v = graphInstance.getNodeData(nodeId)?.data?.direction as string | undefined
    if (v === 'left' || v === 'right' || v === 'center') return v
    return 'center'
  }

  function getChildrenByLevel(nodeId: string): string[] {
    if (!graphInstance) return []
    const selfLevel = getNodeLevel(nodeId)
    return graphInstance
      .getRelatedEdgesData(nodeId, 'both')
      .map(e => (e.source === nodeId ? e.target : e.source) as string)
      .filter(id => getNodeLevel(id) > selfLevel)
  }

  function computeHiddenLocalPositions(hiddenIds: string[]): Record<string, [number, number]> {
    if (!graphInstance || hiddenIds.length === 0) return {}

    const hiddenSet = new Set(hiddenIds)
    const positions: Record<string, [number, number]> = {}
    type ComponentLayout = {
      rootId: string
      parentId: string | null
      dir: 'left' | 'right' | 'center'
      nodeIds: string[]
      nodeXY: Record<string, [number, number]>
      rootXY: [number, number]
      minY: number
      maxY: number
    }
    const components: ComponentLayout[] = []
    type Box = { minX: number; maxX: number; minY: number; maxY: number }

    const getNodeBoxSize = (id: string): { w: number; h: number } => {
      const d = getNodeDirection(id)
      return { w: LOCAL_NODE_W, h: d === 'center' ? 64 : LOCAL_NODE_H }
    }

    const makeBox = (x: number, y: number, w: number, h: number): Box => ({
      minX: x - w / 2 - LOCAL_COLLIDE_PAD_X,
      maxX: x + w / 2 + LOCAL_COLLIDE_PAD_X,
      minY: y - h / 2 - LOCAL_COLLIDE_PAD_Y,
      maxY: y + h / 2 + LOCAL_COLLIDE_PAD_Y,
    })

    const overlap = (a: Box, b: Box): boolean =>
      !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY)

    const parentMap = new Map<string, string | null>()
    for (const id of hiddenIds) {
      const level = getNodeLevel(id)
      const related = graphInstance.getRelatedEdgesData(id, 'both')
      let pickedParent: string | null = null
      let pickedLevel = -Infinity
      for (const e of related) {
        const neighborId = (e.source === id ? e.target : e.source) as string
        const lv = getNodeLevel(neighborId)
        if (lv < level && lv > pickedLevel) {
          pickedParent = neighborId
          pickedLevel = lv
        }
      }
      parentMap.set(id, pickedParent)
    }

    const roots = hiddenIds.filter(id => {
      const p = parentMap.get(id)
      return !p || !hiddenSet.has(p)
    })

    const assigned = new Set<string>()
    for (const rootId of roots) {
      const parentId = parentMap.get(rootId) ?? null
      const componentNodes: string[] = []
      const queue = [rootId]
      while (queue.length > 0) {
        const current = queue.shift()!
        if (assigned.has(current)) continue
        assigned.add(current)
        componentNodes.push(current)
        for (const child of getChildrenByLevel(current)) {
          if (hiddenSet.has(child) && !assigned.has(child)) queue.push(child)
        }
      }
      if (componentNodes.length === 0) continue

      const dir = getNodeDirection(rootId)
      const rankdir = dir === 'left' ? 'RL' : 'LR'
      const g = new dagre.graphlib.Graph({ directed: true, multigraph: true, compound: false })
      g.setGraph({ rankdir, nodesep: LOCAL_NODE_GAP, ranksep: LOCAL_RANK_GAP, marginx: 0, marginy: 0 })
      g.setDefaultEdgeLabel(() => ({}))

      for (const id of componentNodes) {
        const h = getNodeDirection(id) === 'center' ? 64 : LOCAL_NODE_H
        g.setNode(id, { width: LOCAL_NODE_W, height: h })
      }

      const nodeSet = new Set(componentNodes)
      const componentEdges = graphInstance
        .getEdgeData()
        .filter(e => nodeSet.has(e.source as string) && nodeSet.has(e.target as string))

      for (const e of componentEdges) {
        const src = e.source as string
        const tgt = e.target as string
        const sLv = getNodeLevel(src)
        const tLv = getNodeLevel(tgt)
        const from = sLv <= tLv ? src : tgt
        const to = sLv <= tLv ? tgt : src
        const edgeId = (e.id as string) || `${from}->${to}`
        g.setEdge(from, to, { minlen: 1, weight: 1 }, edgeId)
      }

      dagre.layout(g)

      const rootLayout = g.node(rootId)
      if (!rootLayout) continue

      let minY = Number.POSITIVE_INFINITY
      let maxY = Number.NEGATIVE_INFINITY
      const nodeXY: Record<string, [number, number]> = {}
      for (const id of componentNodes) {
        const n = g.node(id)
        if (!n) continue
        nodeXY[id] = [n.x, n.y]
        const h = getNodeDirection(id) === 'center' ? 64 : LOCAL_NODE_H
        minY = Math.min(minY, n.y - h / 2)
        maxY = Math.max(maxY, n.y + h / 2)
      }
      if (!Number.isFinite(minY) || !Number.isFinite(maxY)) continue

      components.push({
        rootId,
        parentId,
        dir,
        nodeIds: componentNodes,
        nodeXY,
        rootXY: [rootLayout.x, rootLayout.y],
        minY,
        maxY,
      })
    }

    // 同一父节点下的多个隐藏子树，按组件高度做垂直打包，避免重叠
    const groups = new Map<string, ComponentLayout[]>()
    for (const comp of components) {
      const key = `${comp.parentId ?? '__orphan__'}::${comp.dir}`
      const list = groups.get(key) ?? []
      list.push(comp)
      groups.set(key, list)
    }

    for (const [key, comps] of groups.entries()) {
      const [parentKey] = key.split('::')
      comps.sort((a, b) => String(a.rootId).localeCompare(String(b.rootId)))

      // 当前已显示节点作为静态障碍物，局部布局结果必须避开这些节点
      const obstacleBoxes: Box[] = []
      for (const node of graphInstance.getNodeData()) {
        const id = node.id as string
        if (!id || hiddenSet.has(id)) continue
        const style = graphInstance.getElementRenderStyle(id) as any
        if (style?.visibility === 'hidden') continue
        const p = graphInstance.getElementPosition(id) as [number, number]
        const { w, h } = getNodeBoxSize(id)
        obstacleBoxes.push(makeBox(p[0], p[1], w, h))
      }

      let baseY = 0
      if (parentKey !== '__orphan__') {
        const p = graphInstance.getElementPosition(parentKey) as [number, number]
        baseY = p[1]
      } else {
        const ys = comps.map(c => (initiallyHiddenPositions.get(c.rootId) ?? [0, c.rootXY[1]])[1])
        baseY = ys.reduce((sum, y) => sum + y, 0) / Math.max(ys.length, 1)
      }

      const heights = comps.map(c => c.maxY - c.minY)
      const gap = LOCAL_NODE_GAP
      const totalHeight = heights.reduce((s, h) => s + h, 0) + gap * Math.max(0, comps.length - 1)
      let cursorTop = baseY - totalHeight / 2

      for (let i = 0; i < comps.length; i++) {
        const comp = comps[i]
        const compHeight = heights[i]
        const targetMinY = cursorTop

        let targetRootX: number
        if (comp.parentId) {
          const parentPos = graphInstance.getElementPosition(comp.parentId) as [number, number]
          const sign = comp.dir === 'left' ? -1 : 1
          targetRootX = parentPos[0] + sign * LOCAL_RANK_GAP
        } else {
          targetRootX = initiallyHiddenPositions.get(comp.rootId)?.[0] ?? comp.rootXY[0]
        }

        const dx = targetRootX - comp.rootXY[0]
        const dy = targetMinY - comp.minY
        const candidate = comp.nodeIds
          .map(id => {
            const xy = comp.nodeXY[id]
            if (!xy) return null
            const { w, h } = getNodeBoxSize(id)
            return { id, x: xy[0] + dx, y: xy[1] + dy, w, h }
          })
          .filter(Boolean) as Array<{ id: string; x: number; y: number; w: number; h: number }>

        const hasCollision = (extraDy: number) => {
          for (const n of candidate) {
            const box = makeBox(n.x, n.y + extraDy, n.w, n.h)
            for (const obstacle of obstacleBoxes) {
              if (overlap(box, obstacle)) return true
            }
          }
          return false
        }

        let extraDy = 0
        if (hasCollision(0)) {
          const step = Math.max(LOCAL_NODE_GAP / 2, 24)
          for (let k = 1; k <= 120; k++) {
            const down = step * k
            if (!hasCollision(down)) {
              extraDy = down
              break
            }
            const up = -step * k
            if (!hasCollision(up)) {
              extraDy = up
              break
            }
          }
        }

        for (const id of comp.nodeIds) {
          const xy = comp.nodeXY[id]
          if (!xy) continue
          positions[id] = [xy[0] + dx, xy[1] + dy + extraDy]
          const { w, h } = getNodeBoxSize(id)
          obstacleBoxes.push(makeBox(positions[id][0], positions[id][1], w, h))
        }

        cursorTop += compHeight + gap
      }
    }

    return positions
  }

  function collectNodeStates() {
    if (!graphInstance) return []
    return graphInstance.getNodeData().map(n => {
      const style = graphInstance!.getElementRenderStyle(n.id as string) as any
      return {
        id: n.id,
        data: {
          address: n.data?.address,
          direction: n.data?.direction,
          level: n.data?.level,
          labelType: n.data?.labelType,
          riskScore: n.data?.riskScore,
          label: n.data?.label,
          hidden: style?.visibility === 'hidden',
        }
      }
    })
  }

  function logVisibleNodes() {
    const allNodes = collectNodeStates()
    console.log(`[资金流向图] 全部节点 (${allNodes.length} 个):`)
    console.log(allNodes)
    console.log(JSON.stringify(allNodes))
  }

  async function toggleHiddenNodes(show: boolean) {
    if (!graphInstance || initiallyHiddenIds.length === 0) return
    showHiddenNodes.value = show

    const hiddenSet = new Set(initiallyHiddenIds)
    const edgeIds = graphInstance
      .getEdgeData()
      .filter(e => hiddenSet.has(e.source as string) || hiddenSet.has(e.target as string))
      .map(e => e.id as string)
      .filter(Boolean)

    const all = [...initiallyHiddenIds, ...edgeIds]
    if (show) {
      const positions = computeHiddenLocalPositions(initiallyHiddenIds)
      if (Object.keys(positions).length > 0) {
        await graphInstance.translateElementTo(positions, false)
      }
      await graphInstance.showElement(all, false)
    } else {
      await graphInstance.hideElement(all, false)
    }
    await syncEdgeVisibility()
  }

  function getRankGapByLayout(): number {
    const cfg = LAYOUT_CONFIG[currentLayout.value] as any
    const layoutRanksep = typeof cfg?.ranksep === 'number' ? cfg.ranksep : LOCAL_RANK_GAP
    // 新增子节点中心点偏移 = 布局间隔 + 节点半宽
    return layoutRanksep + LOCAL_NODE_W
  }

  async function addRandomChildNode(parentId: string, forcedSide?: 'left' | 'right', batchCount = 5) {
    if (!graphInstance) return null
    const parentData = graphInstance.getNodeData(parentId)
    if (!parentData?.id) return null

    const parentDirection = (parentData.data?.direction as string) ?? 'center'
    const side: 'left' | 'right' =
      forcedSide ??
      (parentDirection === 'center'
        ? (Math.random() < 0.5 ? 'left' : 'right')
        : (parentDirection === 'left' ? 'left' : 'right'))

    const parentLevel = (parentData.data?.level as number) ?? 0
    const childLevel = parentLevel + 1
    const rankGap = getRankGapByLayout()
    const parentPos = graphInstance.getElementPosition(parentId) as [number, number]
    // 子节点 x 固定按布局间隔（ranksep）偏移
    const targetX = parentPos[0] + (side === 'right' ? rankGap : -rankGap)

    const occupiedY = graphInstance
      .getNodeData()
      .filter(n => n.id !== parentId && n.data?.direction === side && ((n.data?.level as number) ?? 0) === childLevel)
      .filter(n => {
        const style = graphInstance!.getElementRenderStyle(n.id as string) as any
        return style?.visibility !== 'hidden'
      })
      .map(n => (graphInstance!.getElementPosition(n.id as string) as [number, number])[1])

    const snap = (v: number) => Math.round(v / LOCAL_NODE_GAP) * LOCAL_NODE_GAP
    const baseY = snap(parentPos[1])
    const minGap = LOCAL_NODE_GAP * 0.9
    const isAvailable = (y: number) => occupiedY.every(oy => Math.abs(oy - y) >= minGap)
    const pickAvailableY = () => {
      let y = baseY
      if (!isAvailable(y)) {
        for (let i = 1; i <= 80; i++) {
          const down = baseY + i * LOCAL_NODE_GAP
          if (isAvailable(down)) return down
          const up = baseY - i * LOCAL_NODE_GAP
          if (isAvailable(up)) return up
        }
      }
      return y
    }

    const count = Math.max(1, Math.floor(batchCount))
    const ts = Date.now()
    const nodesToAdd: any[] = []
    const edgesToAdd: any[] = []
    const targetPositions: Record<string, [number, number]> = {}
    const addedNodeIds: string[] = []
    // 入场起点改为父节点附近，实现“从父节点发散”
    const startX = parentPos[0]
    const startY = parentPos[1]

    for (let i = 0; i < count; i++) {
      const targetY = pickAvailableY()
      occupiedY.push(targetY)

      dynamicNodeSeq += 1
      const nodeId = `added-node-${ts}-${dynamicNodeSeq}`
      const edgeId = `added-edge-${ts}-${dynamicNodeSeq}`

      nodesToAdd.push({
        id: nodeId,
        style: {
          x: startX,
          y: startY,
          size: [LOCAL_NODE_W, LOCAL_NODE_H],
        },
        data: {
          address: `新增地址-${dynamicNodeSeq}`,
          direction: side,
          level: childLevel,
          labelType: 0,
          riskScore: 0,
          label: '新增子节点',
          hidden: false,
        },
      })
      addedNodeIds.push(nodeId)

      edgesToAdd.push(side === 'right'
        ? {
            id: edgeId,
            source: parentId,
            target: nodeId,
            __direction: 'right',
            data: {
              amount: 10000 + dynamicNodeSeq * 1000,
              txCount: 1,
              transferTime: new Date().toISOString().slice(0, 19).replace('T', ' '),
            },
          }
        : {
            id: edgeId,
            source: nodeId,
            target: parentId,
            __direction: 'left',
            data: {
              amount: 10000 + dynamicNodeSeq * 1000,
              txCount: 1,
              transferTime: new Date().toISOString().slice(0, 19).replace('T', ' '),
            },
          })

      targetPositions[nodeId] = [targetX, targetY]
    }

    const parentStyle = graphInstance.getElementRenderStyle(parentId) as any
    const parentOriginalZ = Number.isFinite(parentStyle?.zIndex) ? Number(parentStyle.zIndex) : 0
    const tempParentZ = 9999
    const tempChildZ = parentOriginalZ - 1

    await graphInstance.setElementZIndex(parentId, tempParentZ)
    for (const node of nodesToAdd) {
      node.style = {
        ...(node.style || {}),
        zIndex: tempChildZ,
      }
    }

    graphInstance.addNodeData(nodesToAdd as any)
    await graphInstance.draw()
    await graphInstance.translateElementTo(targetPositions, true)
    await graphInstance.setElementZIndex({
      [parentId]: parentOriginalZ,
      ...Object.fromEntries(addedNodeIds.map(id => [id, 0])),
    })

    graphInstance.addEdgeData(edgesToAdd as any)
    await graphInstance.draw()
    await syncEdgeVisibility()

    return { addedCount: count }
  }

  async function addElementToCanvas(batchCount = 3) {
    if (!graphInstance) return null

    const centerNode =
      graphInstance.getNodeData().find(n => n.data?.direction === 'center') ??
      graphInstance.getNodeData()[0]
    if (!centerNode?.id) return null

    const centerPos = graphInstance.getElementPosition(centerNode.id as string) as [number, number]
    const snap = (v: number) => Math.round(v / LOCAL_NODE_GAP) * LOCAL_NODE_GAP
    const baseY = snap(centerPos[1])
    const minGap = LOCAL_NODE_GAP * 0.9

    const collectSideVisibleLevel1Nodes = (side: 'left' | 'right') =>
      graphInstance!
        .getNodeData()
        .filter(n => n.id !== centerNode.id && n.data?.direction === side && ((n.data?.level as number) ?? 0) === 1)
        .filter(n => {
          const style = graphInstance!.getElementRenderStyle(n.id as string) as any
          return style?.visibility !== 'hidden'
        })

    const rightNodes = collectSideVisibleLevel1Nodes('right')
    const leftNodes = collectSideVisibleLevel1Nodes('left')
    const rightOccupiedY = rightNodes.map(n => (graphInstance!.getElementPosition(n.id as string) as [number, number])[1])
    const leftOccupiedY = leftNodes.map(n => (graphInstance!.getElementPosition(n.id as string) as [number, number])[1])

    // 新增节点优先对齐同侧子节点现有 x 轴（若存在）。
    const pickTargetX = (side: 'left' | 'right') => {
      const sameSideNodes = side === 'right' ? rightNodes : leftNodes
      const fallbackX = centerPos[0] + (side === 'right' ? LOCAL_RANK_GAP : -LOCAL_RANK_GAP)
      return sameSideNodes.length > 0
        ? (graphInstance!.getElementPosition(sameSideNodes[0].id as string) as [number, number])[0]
        : fallbackX
    }

    const pickAvailableY = (occupiedY: number[]) => {
      const isAvailable = (y: number) => occupiedY.every(oy => Math.abs(oy - y) >= minGap)
      if (isAvailable(baseY)) return baseY
      for (let i = 1; i <= 80; i++) {
        const down = baseY + i * LOCAL_NODE_GAP
        if (isAvailable(down)) return down
        const up = baseY - i * LOCAL_NODE_GAP
        if (isAvailable(up)) return up
      }
      return baseY
    }

    const ts = Date.now()
    const nodesToAdd: any[] = []
    const edgesToAdd: any[] = []
    const targetPositions: Record<string, [number, number]> = {}
    const nodeIds: string[] = []
    const edgeIds: string[] = []
    const count = Math.max(1, Math.floor(batchCount))

    for (let i = 0; i < count; i++) {
      dynamicNodeSeq += 1
      const side: 'left' | 'right' = dynamicNodeSeq % 2 === 0 ? 'left' : 'right'
      const nodeId = `added-node-${ts}-${dynamicNodeSeq}`
      const edgeId = `added-edge-${ts}-${dynamicNodeSeq}`
      const targetX = pickTargetX(side)
      const occupiedY = side === 'right' ? rightOccupiedY : leftOccupiedY
      const targetY = pickAvailableY(occupiedY)
      occupiedY.push(targetY)

      const startX = targetX + (side === 'right' ? 260 : -260)
      nodesToAdd.push({
        id: nodeId,
        style: {
          x: startX,
          y: targetY,
          size: [LOCAL_NODE_W, LOCAL_NODE_H],
        },
        data: {
          address: `新增地址-${dynamicNodeSeq}`,
          direction: side,
          level: 1,
          labelType: 0,
          riskScore: 0,
          label: '新增节点',
          hidden: false,
        },
      })

      edgesToAdd.push(side === 'right'
        ? {
            id: edgeId,
            source: centerNode.id as string,
            target: nodeId,
            __direction: 'right',
            data: {
              amount: 10000 + dynamicNodeSeq * 1000,
              txCount: 1,
              transferTime: new Date().toISOString().slice(0, 19).replace('T', ' '),
            },
          }
        : {
            id: edgeId,
            source: nodeId,
            target: centerNode.id as string,
            __direction: 'left',
            data: {
              amount: 10000 + dynamicNodeSeq * 1000,
              txCount: 1,
              transferTime: new Date().toISOString().slice(0, 19).replace('T', ' '),
            },
          })
      targetPositions[nodeId] = [targetX, targetY]
      nodeIds.push(nodeId)
      edgeIds.push(edgeId)
    }

    graphInstance.addNodeData(nodesToAdd)
    await graphInstance.draw()
    await graphInstance.translateElementTo(targetPositions, true)
    graphInstance.addEdgeData(edgesToAdd)
    await graphInstance.draw()
    await syncEdgeVisibility()

    return { nodeIds, edgeIds, addedCount: count }
  }

  function destroyGraph() {
    if (graphInstance) {
      graphInstance.destroy()
      graphInstance = null
    }
    highlightedEdgeIds = []
    hoveredNodeId = null
    initiallyHiddenIds = []
  }

  onUnmounted(destroyGraph)

  return {
    currentLayout,
    isTransitioning,
    initGraph,
    switchLayout,
    hideNode,
    highlightPath,
    logVisibleNodes,
    showHiddenNodes,
    toggleHiddenNodes,
    addElementToCanvas,
  }
}
