<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useFundFlowGraph } from '../composables/useFundFlowGraph'
import LayoutToggle from './LayoutToggle.vue'
import NodeContextMenu from './NodeContextMenu.vue'
import rawData from '../data/data2.json'

const nodes = rawData.nodes
const nodeMap = new Map(nodes.map((n: any) => [n.id, n]))
const edges = rawData.edges.map((e: any, i: number) => {
  const srcNode = nodeMap.get(e.source) as any
  const tgtNode = nodeMap.get(e.target) as any
  let direction = 'center'
  if (tgtNode?.data?.direction === 'right') direction = 'right'
  else if (srcNode?.data?.direction === 'left') direction = 'left'
  return {
    id: `edge-${i}`,
    __direction: direction,
    ...e,
  }
})

const graphContainer = ref<HTMLElement | null>(null)
const {
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
} =
  useFundFlowGraph()
const nodeCount = ref(nodes.length)
const edgeCount = ref(edges.length)

const ctxMenu = ref({ visible: false, x: 0, y: 0, nodeId: '', isCenter: false })
function closeCtxMenu() {
  ctxMenu.value.visible = false
}

async function handleAddElement() {
  const added = await addElementToCanvas()
  if (!added) return
  const c = added.addedCount ?? added.nodeIds?.length ?? 0
  nodeCount.value += c
  edgeCount.value += c
}

onMounted(() => {
  if (graphContainer.value) {
    initGraph(graphContainer.value, nodes, edges, {
      onContextMenu: (nodeId, clientX, clientY, direction) => {
        ctxMenu.value = {
          visible: true,
          x: clientX,
          y: clientY,
          nodeId,
          isCenter: direction === 'center',
        }
      },
    })
  }
})
</script>

<template>
  <div class="graph-wrapper">
    <div class="graph-toolbar">
      <div class="graph-title">
        <h1>资金流向分析图</h1>
        <p class="graph-subtitle">
          {{ nodeCount }} 个地址 · {{ edgeCount }} 笔交易
        </p>
      </div>
      <div class="toolbar-right">
        <label class="hidden-switch">
          <input
            type="checkbox"
            :checked="showHiddenNodes"
            @change="toggleHiddenNodes(($event.target as HTMLInputElement).checked)"
          />
          <span class="switch-track">
            <span class="switch-thumb"></span>
          </span>
          <span class="switch-label">显示隐藏节点</span>
        </label>
        <button class="log-btn" @click="logVisibleNodes">输出节点</button>
        <button class="log-btn" @click="handleAddElement">批量添加节点</button>
        <LayoutToggle
          :current-layout="currentLayout"
          :is-transitioning="isTransitioning"
          @switch="switchLayout"
        />
      </div>
    </div>

    <div class="graph-legend">
      <div class="legend-item">
        <span class="legend-dot legend-dot--center"></span>
        <span>核心地址</span>
      </div>
      <div class="legend-item">
        <span class="legend-dot legend-dot--left"></span>
        <span>流入方</span>
      </div>
      <div class="legend-item">
        <span class="legend-dot legend-dot--right"></span>
        <span>流出方</span>
      </div>
      <div class="legend-sep"></div>
      <div class="legend-item legend-hint">
        <span>▶ 虚线动效表示资金流动方向</span>
      </div>
    </div>

    <div ref="graphContainer" class="graph-canvas" @contextmenu.prevent></div>

    <NodeContextMenu
      v-if="ctxMenu.visible"
      :x="ctxMenu.x"
      :y="ctxMenu.y"
      :is-center="ctxMenu.isCenter"
      @hide="hideNode(ctxMenu.nodeId); closeCtxMenu()"
      @highlight="highlightPath(ctxMenu.nodeId); closeCtxMenu()"
      @close="closeCtxMenu()"
    />

    <transition name="fade">
      <div v-if="isTransitioning" class="graph-loading">
        <span>布局重排中…</span>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.graph-wrapper {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #060d1a;
}

.graph-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  border-bottom: 1px solid #0f2040;
  flex-shrink: 0;
  background: #060d1a;
}

.graph-title h1 {
  font-size: 17px;
  font-weight: 700;
  color: #e2e8f0;
  letter-spacing: 0.04em;
}

.graph-subtitle {
  font-size: 12px;
  color: #334155;
  margin-top: 3px;
}

.graph-legend {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 8px 24px;
  border-bottom: 1px solid #0f2040;
  flex-shrink: 0;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #475569;
}

.legend-hint {
  color: #1e3a5f;
  font-size: 11px;
}

.legend-sep {
  flex: 1;
}

.legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  border: 2px solid;
  flex-shrink: 0;
}

.legend-dot--center {
  background: #0d2248;
  border-color: #22d3ee;
  box-shadow: 0 0 6px #22d3ee;
}

.legend-dot--left {
  background: #0d2a1a;
  border-color: #22c55e;
  box-shadow: 0 0 6px #22c55e66;
}

.legend-dot--right {
  background: #1e3a5f;
  border-color: #3b82f6;
  box-shadow: 0 0 6px #3b82f666;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.hidden-switch {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}

.hidden-switch input {
  display: none;
}

.switch-track {
  position: relative;
  width: 36px;
  height: 20px;
  background: #0f2040;
  border: 1px solid rgba(34, 211, 238, 0.3);
  border-radius: 10px;
  transition: background 0.2s, border-color 0.2s;
  flex-shrink: 0;
}

.hidden-switch input:checked + .switch-track {
  background: rgba(34, 211, 238, 0.2);
  border-color: rgba(34, 211, 238, 0.7);
}

.switch-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #475569;
  transition: transform 0.2s, background 0.2s;
}

.hidden-switch input:checked + .switch-track .switch-thumb {
  transform: translateX(16px);
  background: #22d3ee;
}

.switch-label {
  font-size: 12px;
  color: #475569;
  transition: color 0.2s;
}

.hidden-switch:has(input:checked) .switch-label {
  color: #22d3ee;
}

.log-btn {
  padding: 6px 14px;
  font-size: 12px;
  color: #22d3ee;
  background: transparent;
  border: 1px solid rgba(34, 211, 238, 0.3);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  letter-spacing: 0.03em;
}

.log-btn:hover {
  background: rgba(34, 211, 238, 0.08);
  border-color: rgba(34, 211, 238, 0.6);
}

.graph-canvas {
  flex: 1;
  width: 100%;
  overflow: hidden;
  background: #060d1a;
}

.graph-loading {
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: #0f2040;
  border: 1px solid #22d3ee44;
  color: #22d3ee;
  padding: 8px 20px;
  border-radius: 20px;
  font-size: 12px;
  pointer-events: none;
  letter-spacing: 0.04em;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
