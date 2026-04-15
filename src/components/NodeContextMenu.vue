<script setup lang="ts">
defineProps<{ x: number; y: number; isCenter: boolean }>()
defineEmits<{
  (e: 'hide'): void
  (e: 'highlight'): void
  (e: 'close'): void
}>()
</script>

<template>
  <teleport to="body">
    <div class="ctx-mask" @click="$emit('close')" @contextmenu.prevent />
    <ul class="ctx-menu" :style="{ left: x + 'px', top: y + 'px' }">
      <li
        class="ctx-item"
        :class="{ disabled: isCenter }"
        @click="!isCenter && $emit('hide')"
      >
        <span class="ctx-icon">⊖</span>隐藏节点
      </li>
      <li class="ctx-item" @click="$emit('highlight')">
        <span class="ctx-icon">◈</span>突出与源点关联
      </li>
    </ul>
  </teleport>
</template>

<style scoped>
.ctx-mask {
  position: fixed;
  inset: 0;
  z-index: 999;
}

.ctx-menu {
  position: fixed;
  z-index: 1000;
  min-width: 152px;
  background: rgba(5, 12, 28, 0.97);
  border: 1px solid rgba(0, 212, 255, 0.18);
  border-radius: 8px;
  padding: 4px 0;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.7), 0 0 12px rgba(0, 212, 255, 0.06);
  list-style: none;
  margin: 0;
  backdrop-filter: blur(8px);
}

.ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 16px;
  font-size: 13px;
  color: #c4dcee;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
  user-select: none;
}

.ctx-item:hover {
  background: rgba(0, 212, 255, 0.08);
  color: #22d3ee;
}

.ctx-item.disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.ctx-item.disabled:hover {
  background: transparent;
  color: #c4dcee;
}

.ctx-icon {
  font-size: 14px;
  line-height: 1;
  opacity: 0.7;
}
</style>
