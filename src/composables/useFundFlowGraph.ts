import { ref, onUnmounted } from 'vue'
import { Graph } from '@antv/g6'

export type LayoutType = 'dagre' | 'circular'

type Direction = 'center' | 'left' | 'right'

const NODE_STYLE_MAP: Record<Direction, { fill: string; stroke: string; labelFill: string }> = {
  center: {
    fill: '#0d2248',
    stroke: '#22d3ee',
    labelFill: '#67e8f9',
  },
  left: {
    fill: '#0d2a1a',
    stroke: '#22c55e',
    labelFill: '#86efac',
  },
  right: {
    fill: '#1e3a5f',
    stroke: '#3b82f6',
    labelFill: '#93c5fd',
  },
}

function shortAddr(address: string): string {
  if (!address || address.length <= 12) return address
  return address.slice(0, 6) + '…' + address.slice(-4)
}

function formatAmount(amount: number): string {
  if (!amount) return ''
  if (amount >= 1e8) return (amount / 1e8).toFixed(2) + '亿'
  if (amount >= 1e4) return (amount / 1e4).toFixed(2) + '万'
  return amount.toFixed(2)
}

const LAYOUT_CONFIG = {
  dagre: {
    type: 'antv-dagre' as const,
    rankdir: 'LR' as const,
    nodesep: 60,
    ranksep: 100,
  },
  circular: {
    type: 'circular' as const,
    radius: 220,
  },
}

export function useFundFlowGraph() {
  const currentLayout = ref<LayoutType>('dagre')
  const isTransitioning = ref(false)

  // Graph 实例存储在普通变量中，不进入 Vue 响应式系统
  let graphInstance: Graph | null = null

  function initGraph(container: HTMLElement, nodes: any, edges: any) {
    if (graphInstance) return

    graphInstance = new Graph({
      container,
      autoFit: 'view',
      animation: true,
      data: {
        nodes:nodes as any,
        edges:edges as any,
      },
      node: {
        style: {
          size: (d: any) => d.data.direction === 'center' ? 64 : 50,
          fill: (d: any) => NODE_STYLE_MAP[d.data.direction as Direction]?.fill ?? '#1e3a5f',
          stroke: (d: any) => NODE_STYLE_MAP[d.data.direction as Direction]?.stroke ?? '#3b82f6',
          lineWidth: (d: any) => d.data.direction === 'center' ? 3 : 2,
          shadowColor: (d: any) => NODE_STYLE_MAP[d.data.direction as Direction]?.stroke ?? '#3b82f6',
          shadowBlur: (d: any) => d.data.direction === 'center' ? 20 : 10,
          labelText: (d: any) => shortAddr(d.data.address),
          labelFill: (d: any) => NODE_STYLE_MAP[d.data.direction as Direction]?.labelFill ?? '#93c5fd',
          labelFontSize: 11,
          labelFontWeight: 'bold',
          labelPlacement: 'bottom',
          labelBackground: true,
          labelBackgroundFill: '#0f172a',
          labelBackgroundOpacity: 0.85,
          labelBackgroundPadding: [3, 6, 3, 6] as [number, number, number, number],
        },
      },
      edge: {
        style: {
          stroke: '#334155',
          lineWidth: 1.5,
          endArrow: true,
          endArrowType: 'vee',
          labelText: (d: any) => formatAmount(d.data.amount),
          labelFill: '#94a3b8',
          labelFontSize: 10,
          labelBackground: true,
          labelBackgroundFill: '#1e293b',
          labelBackgroundOpacity: 0.9,
          labelBackgroundPadding: [2, 5, 2, 5] as [number, number, number, number],
        },
      },
      layout: LAYOUT_CONFIG.dagre,
      behaviors: ['drag-canvas', 'zoom-canvas', 'drag-element'],
    })

    graphInstance.render()
  }

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

  function destroyGraph() {
    if (graphInstance) {
      graphInstance.destroy()
      graphInstance = null
    }
  }

  onUnmounted(destroyGraph)

  return {
    currentLayout,
    isTransitioning,
    initGraph,
    switchLayout,
  }
}
