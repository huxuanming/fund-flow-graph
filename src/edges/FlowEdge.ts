import { Line, register } from '@antv/g6'
import { Path } from '@antv/g'
import type { BaseEdgeStyleProps } from '@antv/g6'
import type { Group } from '@antv/g'

class FlowEdge extends Line {
  protected drawKeyShape(
    attributes: Required<BaseEdgeStyleProps>,
    container: Group,
  ): Path | undefined {
    const baseStyle = this.getKeyStyle(attributes) as any

    // 1. 暗色轨道线（作为 key shape，箭头附着在此）
    const key = this.upsert('key', Path, {
      ...baseStyle,
      stroke: '#0f2440',
      lineWidth: 1,
      lineDash: [],
    } as any, container) as Path | undefined

    // 2. 流动高亮虚线叠加层
    const flow = this.upsert('flow', Path, {
      d: baseStyle.d,
      stroke: '#22d3ee',
      lineWidth: 1.5,
      lineDash: [10, 8],
      lineDashOffset: 0,
      opacity: 0.75,
      fill: 'none',
      pointerEvents: 'none',
    } as any, container) as Path | undefined

    if (flow) {
      // 路径更新后重置动画，避免闪跳
      const prev = (flow as any).__flowAnim as Animation | undefined
      if (prev) prev.cancel()

      ;(flow as any).__flowAnim = flow.animate(
        [{ lineDashOffset: 18 }, { lineDashOffset: 0 }],
        { duration: 900, iterations: Infinity, easing: 'linear' },
      )
    }

    return key
  }
}

register('edge', 'flow-edge', FlowEdge)
