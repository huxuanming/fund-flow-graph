<script setup lang="ts">
import type { LayoutType } from '../composables/useFundFlowGraph'

const props = defineProps<{
  currentLayout: LayoutType
  isTransitioning: boolean
}>()

const emit = defineEmits<{
  switch: [layout: LayoutType]
}>()

const layouts: Array<{ key: LayoutType; label: string; icon: string; desc: string }> = [
  { key: 'dagre',    label: '流形布局', icon: '⇢', desc: '左入右出对称树形' },
  { key: 'circular', label: '圆形布局', icon: '◎', desc: '账户环形关系'    },
]

function handleSwitch(key: LayoutType) {
  if (!props.isTransitioning) {
    emit('switch', key)
  }
}
</script>

<template>
  <div class="layout-toggle">
    <span class="toggle-label">布局视图</span>
    <div class="toggle-buttons">
      <button
        v-for="item in layouts"
        :key="item.key"
        class="toggle-btn"
        :class="{
          'toggle-btn--active': currentLayout === item.key,
          'toggle-btn--disabled': isTransitioning,
        }"
        :disabled="isTransitioning"
        @click="handleSwitch(item.key)"
      >
        <span class="btn-icon">{{ item.icon }}</span>
        <span class="btn-text">
          <strong>{{ item.label }}</strong>
          <small>{{ item.desc }}</small>
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.layout-toggle {
  display: flex;
  align-items: center;
  gap: 12px;
}

.toggle-label {
  font-size: 12px;
  color: #64748b;
  white-space: nowrap;
}

.toggle-buttons {
  display: flex;
  gap: 8px;
}

.toggle-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border: 1px solid #0f2040;
  border-radius: 8px;
  background: #0a1628;
  color: #475569;
  cursor: pointer;
  transition: all 0.2s ease;
  font-family: inherit;
}

.toggle-btn:hover:not(.toggle-btn--disabled) {
  border-color: #22d3ee44;
  color: #cbd5e1;
}

.toggle-btn--active {
  border-color: #22d3ee;
  background: #0d2248;
  color: #22d3ee;
  box-shadow: 0 0 10px #22d3ee33;
}

.toggle-btn--disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-icon {
  font-size: 18px;
  line-height: 1;
}

.btn-text {
  display: flex;
  flex-direction: column;
  text-align: left;
  line-height: 1.3;
}

.btn-text strong {
  font-size: 13px;
}

.btn-text small {
  font-size: 10px;
  opacity: 0.7;
}
</style>
