<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useFundFlowGraph } from '../composables/useFundFlowGraph'
import LayoutToggle from './LayoutToggle.vue'
import rawData from '../data/data1.json'

const nodes = rawData.nodes
const edges = rawData.edges.map((e: any, i: number) => ({
  id: `edge-${i}`,
  ...e,
}))

const graphContainer = ref<HTMLElement | null>(null)
const { currentLayout, isTransitioning, initGraph, switchLayout } = useFundFlowGraph()

onMounted(() => {
  if (graphContainer.value) {
    initGraph(graphContainer.value, nodes, edges)
  }
})
</script>

<template>
  <div class="graph-wrapper">
    <div class="graph-toolbar">
      <div class="graph-title">
        <h1>资金流向分析图</h1>
        <p class="graph-subtitle">
          {{ nodes.length }} 个地址 · {{ edges.length }} 笔交易
        </p>
      </div>
      <LayoutToggle
        :current-layout="currentLayout"
        :is-transitioning="isTransitioning"
        @switch="switchLayout"
      />
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

    <div ref="graphContainer" class="graph-canvas"></div>

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
