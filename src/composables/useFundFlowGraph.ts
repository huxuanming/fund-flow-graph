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
    ranksep: 180,
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

  // 折叠状态：key 格式为 `${nodeId}:left` 或 `${nodeId}:right`
  const collapsedSet = new Set<string>()

  // 当前高亮的边 ID 列表
  let highlightedEdgeIds: string[] = []

  // 数据中 hidden:true 的节点 ID（初始隐藏集合）
  let initiallyHiddenIds: string[] = []
  const initiallyHiddenPositions = new Map<string, [number, number]>()
  const LOCAL_RANK_GAP = 180
  const LOCAL_NODE_GAP = 72
  const LOCAL_NODE_W = 200
  const LOCAL_NODE_H = 56
  const LOCAL_COLLIDE_PAD_X = 18
  const LOCAL_COLLIDE_PAD_Y = 12

  // ── 折叠/展开 ──────────────────────────────────────────

  function getAllDescendants(
    rootId: string,
    side: 'left' | 'right',
  ): { nodeIds: string[]; edgeIds: string[] } {
    if (!graphInstance) return { nodeIds: [], edgeIds: [] }

    const visitedNodes = new Set<string>()
    const allNodeIds: string[] = []
    const queue: string[] = [rootId]

    while (queue.length > 0) {
      const currentId = queue.shift()!
      const currentData = graphInstance.getNodeData(currentId)
      const currentLevel = (currentData?.data?.level as number) ?? 0
      const relatedEdges = graphInstance.getRelatedEdgesData(currentId, 'both')

      for (const edge of relatedEdges) {
        const neighborId = (edge.source === currentId ? edge.target : edge.source) as string
        const neighborData = graphInstance.getNodeData(neighborId)
        const neighborLevel = (neighborData?.data?.level as number) ?? 0
        const neighborDirection = neighborData?.data?.direction as string

        if (
          neighborLevel > currentLevel &&
          neighborDirection === side &&
          !visitedNodes.has(neighborId)
        ) {
          visitedNodes.add(neighborId)
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

  async function toggleCollapse(nodeId: string, side: 'left' | 'right') {
    if (!graphInstance) return
    const key = `${nodeId}:${side}`
    const isCollapsed = collapsedSet.has(key)
    const { nodeIds, edgeIds } = getAllDescendants(nodeId, side)
    if (nodeIds.length === 0) return

    if (isCollapsed) {
      collapsedSet.delete(key)
      await graphInstance.showElement([...nodeIds, ...edgeIds])
      await syncEdgeVisibility()
    } else {
      collapsedSet.add(key)
      await graphInstance.hideElement([...nodeIds, ...edgeIds])
    }

    const dataUpdate = side === 'left'
      ? { collapsedLeft: !isCollapsed }
      : { collapsedRight: !isCollapsed }
    graphInstance.updateNodeData([{ id: nodeId, data: dataUpdate }])
    await graphInstance.draw()
  }

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

  function findPathToCenter(nodeId: string): string[] {
    if (!graphInstance) return []
    const allEdges = graphInstance.getEdgeData()
    const result: string[] = []
    let currentId = nodeId

    for (let i = 0; i < 5; i++) {
      const currentData = graphInstance.getNodeData(currentId)
      const currentLevel = (currentData?.data?.level as number) ?? 0
      if (currentLevel === 0) break

      const parentEdge = allEdges.find(e => {
        if (e.source !== currentId && e.target !== currentId) return false
        const neighborId = (e.source === currentId ? e.target : e.source) as string
        const neighborLevel = (graphInstance!.getNodeData(neighborId)?.data?.level as number) ?? 0
        return neighborLevel < currentLevel
      })
      if (!parentEdge?.id) break

      result.push(parentEdge.id as string)
      currentId = (parentEdge.source === currentId ? parentEdge.target : parentEdge.source) as string
    }
    return result
  }

  async function clearHighlight() {
    if (!graphInstance || highlightedEdgeIds.length === 0) return
    for (const id of highlightedEdgeIds) {
      await graphInstance.setElementState(id, [])
    }
    highlightedEdgeIds = []
  }

  async function highlightPath(nodeId: string) {
    if (!graphInstance) return
    await clearHighlight()

    const edgeIds = findPathToCenter(nodeId)
    if (edgeIds.length === 0) return

    for (const id of edgeIds) {
      await graphInstance.setElementState(id, 'highlighted')
    }
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
          endArrow: true,
          endArrowType: 'vee',
          endArrowFill: '#22d3ee',
          endArrowStroke: '#22d3ee',
          lineWidth: (d: any) => amountToLineWidth(d.data?.amount ?? 0),
          endArrowSize: (d: any) => 6 + amountToLineWidth(d.data?.amount ?? 0),
          endArrowOffset: (d: any) => 0 + amountToLineWidth(d.data?.amount ?? 0),
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

    // +/- 折叠按钮点击
    graphInstance.on('node:click', async (event: any) => {
      if (event.targetType !== 'node') return
      const shapeName: string = event.originalTarget?.className ?? ''
      if (shapeName === 'toggle-btn-right-bg') {
        await toggleCollapse(event.target.id as string, 'right')
      } else if (shapeName === 'toggle-btn-left-bg') {
        await toggleCollapse(event.target.id as string, 'left')
      }
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
      const srcHidden = srcStyle?.visibility === 'hidden'
      const tgtHidden = tgtStyle?.visibility === 'hidden'

      if (srcHidden || tgtHidden) {
        toHide.push(edgeId)
      } else {
        toShow.push(edgeId)
      }
    }

    if (toHide.length) await graphInstance.hideElement(toHide)
    if (toShow.length) await graphInstance.showElement(toShow)
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

  function destroyGraph() {
    if (graphInstance) {
      graphInstance.destroy()
      graphInstance = null
    }
    collapsedSet.clear()
    highlightedEdgeIds = []
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
  }
}
