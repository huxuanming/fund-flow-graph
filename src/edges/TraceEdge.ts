import { Polyline, register, subStyleProps } from '@antv/g6'
import type { Point, PolylineStyleProps } from '@antv/g6'
import type { IAnimation, Path } from '@antv/g'
import type { Group } from '@antv/g'

// ── 类型定义 ──────────────────────────────────────────────

type LayoutDirection = 'LR' | 'RL' | 'TB' | 'BT'

interface NodeBBox {
  min: Point
  max: Point
  center: Point
  width: number
  height: number
  intersects: (other: NodeBBox) => boolean
}

interface OrthPathConfig {
  type: 'orth'
  padding?: number
  radius?: number
  rankdir?: LayoutDirection
  directionSide?: 'left' | 'right' | 'top' | 'bottom' | ((data: any) => string | undefined)
  firstOffsetRatio?: number | ((data: any) => number)
  secondOffsetRatio?: number | ((data: any) => number)
}

type ParsedLabelEdgeStyleProps = Required<PolylineStyleProps> & {
  startLabelText?: string
  startLabelOffsetX?: number
  startLabelOffsetY?: number
  endLabelText?: string
  endLabelOffsetX?: number
  endLabelOffsetY?: number
  orthPath?: OrthPathConfig
  [key: string]: any
}

// ── TraceEdge ─────────────────────────────────────────────

export class TraceEdge extends Polyline {
  private _flowAnim: IAnimation | null = null
  private _glowAnim: IAnimation | null = null

  // ── 几何工具 ──────────────────────────────────────────

  private isCollinear(p1: Point, p2: Point, p3: Point): boolean {
    const v1x = p2[0] - p1[0]
    const v1y = p2[1] - p1[1]
    const v2x = p3[0] - p2[0]
    const v2y = p3[1] - p2[1]
    const cross = v1x * v2y - v1y * v2x
    return Math.abs(cross) < 1e-10
  }

  private manhattanDistance(a: Point, b: Point): number {
    return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])
  }

  private getBorderRadiusPoints(
    prevPoint: Point,
    midPoint: Point,
    nextPoint: Point,
    radius: number,
  ): [Point, Point] {
    const d0 = this.manhattanDistance(prevPoint, midPoint)
    const d1 = this.manhattanDistance(nextPoint, midPoint)
    if (d0 === 0 || d1 === 0) return [midPoint, midPoint]
    const r = Math.min(radius, Math.min(d0, d1) / 2)

    const ps: Point = [
      midPoint[0] - (r / d0) * (midPoint[0] - prevPoint[0]),
      midPoint[1] - (r / d0) * (midPoint[1] - prevPoint[1]),
    ]
    const pt: Point = [
      midPoint[0] - (r / d1) * (midPoint[0] - nextPoint[0]),
      midPoint[1] - (r / d1) * (midPoint[1] - nextPoint[1]),
    ]
    return [ps, pt]
  }

  // ── 数据 & 配置工具 ───────────────────────────────────

  private getThisEdgeData(attributes: any): any {
    if ((this as any).context?.graph && (this as any).id) {
      try {
        return (this as any).context.graph.getEdgeData((this as any).id)
      } catch {
        // ignore
      }
    }
    return (this as any).attributes?.data || attributes?.data || attributes || {}
  }

  private evaluateConfig<T>(
    config: T | ((data: any) => T),
    edgeData: any,
    defaultValue: T,
  ): T {
    if (typeof config === 'function') {
      try {
        const value = (config as (data: any) => T)(edgeData)
        return value !== undefined && value !== null ? value : defaultValue
      } catch {
        return defaultValue
      }
    }
    return config !== undefined && config !== null ? config : defaultValue
  }

  private normalizeRatio(value: any, def = 0.5): number {
    return typeof value === 'number' && value >= 0 && value <= 1 ? value : def
  }

  private getLayoutDirection(
    config: OrthPathConfig,
    layout?: Record<string, any>,
  ): LayoutDirection {
    return (layout?.rankdir || config.rankdir || 'TB') as LayoutDirection
  }

  // ── 节点包围盒 ────────────────────────────────────────

  private createNodeBBox(node: any, padding: number): NodeBBox {
    const pos = node.getPosition?.() as [number, number, number] | undefined
    const size = node.getSize?.() as [number, number] | undefined

    if (pos && size && size[0] && size[1]) {
      const cx = pos[0]
      const cy = pos[1]
      const hw = size[0] / 2
      const hh = size[1] / 2
      const pad = padding
      return {
        min: [cx - hw - pad, cy - hh - pad],
        max: [cx + hw + pad, cy + hh + pad],
        center: [cx, cy],
        width: size[0] + pad * 2,
        height: size[1] + pad * 2,
        intersects: (other) =>
          !(cx + hw + pad < other.min[0] ||
            cx - hw - pad > other.max[0] ||
            cy + hh + pad < other.min[1] ||
            cy - hh - pad > other.max[1]),
      }
    }

    // fallback: getBounds
    const bbox = node.getBounds()
    const pad = padding
    const min: Point = [bbox.min[0] - pad, bbox.min[1] - pad]
    const max: Point = [bbox.max[0] + pad, bbox.max[1] + pad]
    return {
      min,
      max,
      center: [bbox.center[0], bbox.center[1]],
      width: bbox.max[0] - bbox.min[0] + pad * 2,
      height: bbox.max[1] - bbox.min[1] + pad * 2,
      intersects: (other) =>
        !(max[0] < other.min[0] ||
          min[0] > other.max[0] ||
          max[1] < other.min[1] ||
          min[1] > other.max[1]),
    }
  }

  // ── 控制点计算（正交折线） ────────────────────────────

  private calculateControlPoints(
    sourcePoint: Point,
    targetPoint: Point,
    sourceBBox: NodeBBox,
    targetBBox: NodeBBox,
    direction: LayoutDirection,
    directionSide: 'left' | 'right' | 'top' | 'bottom' | undefined,
    firstOffsetRatio: number,
    secondOffsetRatio: number,
  ): Point[] {
    const sx = sourcePoint[0] ?? 0
    const sy = sourcePoint[1] ?? 0
    const tx = targetPoint[0] ?? 0
    const ty = targetPoint[1] ?? 0
    const isHorizontal = direction === 'LR' || direction === 'RL'
    const isVertical = direction === 'TB' || direction === 'BT'

    if (sourceBBox.intersects(targetBBox)) {
      if (isHorizontal) {
        const midX = (sx + tx) / 2
        return [[midX, sy], [midX, ty]]
      } else {
        const midY = (sy + ty) / 2
        return [[sx, midY], [tx, midY]]
      }
    }

    // source 在 target 右侧时，采用“绕到 target 左侧再进入”的路径，
    // 保证最后一段是从左向右指向 target。
    if (sx > tx) {
      const sourceMinX = sourceBBox.min[0] ?? sx
      const targetMinX = targetBBox.min[0] ?? tx
      const detourGap = Math.max(24, Math.min(sourceBBox.width, targetBBox.width) * 0.2)
      const approachX = targetMinX - detourGap
      const bypassX = Math.min(approachX - detourGap, sourceMinX - detourGap)

      return [[bypassX, sy], [bypassX, ty], [approachX, ty]]
    }

    if (isHorizontal) {
      const sourceMaxX = sourceBBox.max[0] ?? 0
      const targetMinX = targetBBox.min[0] ?? 0
      const totalWidth = targetMinX - sourceMaxX
      let midX: number
      if (totalWidth <= 0 || !isFinite(totalWidth)) {
        midX = (sx + tx) / 2
      } else if (directionSide === 'left') {
        midX = sourceMaxX + totalWidth * (1 - firstOffsetRatio)
      } else if (directionSide === 'right') {
        midX = sourceMaxX + totalWidth * secondOffsetRatio
      } else {
        midX = (sourceMaxX + targetMinX) / 2
      }
      return [[midX, sy], [midX, ty]]
    }

    if (isVertical) {
      const sourceMaxY = sourceBBox.max[1] ?? 0
      const targetMinY = targetBBox.min[1] ?? 0
      const totalHeight = targetMinY - sourceMaxY
      let midY: number
      if (totalHeight <= 0 || !isFinite(totalHeight)) {
        midY = (sy + ty) / 2
      } else if (directionSide === 'top') {
        midY = sourceMaxY + totalHeight * (1 - firstOffsetRatio)
      } else if (directionSide === 'bottom') {
        midY = sourceMaxY + totalHeight * secondOffsetRatio
      } else {
        midY = (sourceMaxY + targetMinY) / 2
      }
      return [[sx, midY], [tx, midY]]
    }

    return [[(sx + tx) / 2, sy], [(sx + tx) / 2, ty]]
  }

  // ── SVG 路径构建（支持圆角） ──────────────────────────

  private buildPathArray(
    points: Point[],
    radius: number,
    sourcePoint: Point,
    targetPoint: Point,
  ): any[] {
    const firstPoint = points[0]
    if (!firstPoint || firstPoint[0] === undefined || firstPoint[1] === undefined) return []

    const pathArray: any[] = [['M', firstPoint[0], firstPoint[1]]]
    const controlPoints = points.slice(1, -1)

    controlPoints.forEach((midPoint, i) => {
      const prevPoint = controlPoints[i - 1] || sourcePoint
      const nextPoint = controlPoints[i + 1] || targetPoint

      if (!this.isCollinear(prevPoint, midPoint, nextPoint) && radius > 0) {
        const [ps, pt] = this.getBorderRadiusPoints(prevPoint, midPoint, nextPoint, radius)
        pathArray.push(
          ['L', ps[0], ps[1]],
          ['Q', midPoint[0], midPoint[1], pt[0], pt[1]],
          ['L', pt[0], pt[1]],
        )
      } else {
        pathArray.push(['L', midPoint[0], midPoint[1]])
      }
    })

    const lastPoint = points[points.length - 1]
    if (lastPoint && lastPoint[0] !== undefined && lastPoint[1] !== undefined) {
      pathArray.push(['L', lastPoint[0], lastPoint[1]])
    }

    return pathArray
  }

  private retreatPoint(from: Point, to: Point, distance: number): Point {
    if (!(distance > 0)) return to
    const dx = to[0] - from[0]
    const dy = to[1] - from[1]
    const len = Math.hypot(dx, dy)
    if (!Number.isFinite(len) || len <= 1e-6) return to
    const ratio = Math.max(0, Math.min(1, (len - distance) / len))
    return [from[0] + dx * ratio, from[1] + dy * ratio]
  }

  // ── 路径计算（正交模式或默认折线） ───────────────────

  protected getKeyPath(attributes: any): any {
    const orthPathConfig = attributes.orthPath as OrthPathConfig | undefined

    if (!orthPathConfig || orthPathConfig.type !== 'orth') {
      return super.getKeyPath(attributes)
    }

    const [rawSourcePoint, rawTargetPoint] = this.getEndpoints(attributes, false)
    const padding = orthPathConfig.padding ?? 10
    const radius = orthPathConfig.radius ?? 0
    const { sourceNode, targetNode } = this

    const layout = (this as any).context?.graph?.getLayout?.() as Record<string, any> | undefined
    const direction = this.getLayoutDirection(orthPathConfig, layout)

    const sourceBBox = this.createNodeBBox(sourceNode, padding)
    const targetBBox = this.createNodeBBox(targetNode, padding)

    const edgeData = this.getThisEdgeData(attributes)
    const directionSideValue = this.evaluateConfig(
      orthPathConfig.directionSide,
      edgeData,
      undefined,
    )
    const directionSide =
      directionSideValue === 'left' ||
      directionSideValue === 'right' ||
      directionSideValue === 'top' ||
      directionSideValue === 'bottom'
        ? directionSideValue
        : undefined

    const firstOffsetRatio = this.normalizeRatio(
      this.evaluateConfig(orthPathConfig.firstOffsetRatio, edgeData, 0.5),
    )
    const secondOffsetRatio = this.normalizeRatio(
      this.evaluateConfig(orthPathConfig.secondOffsetRatio, edgeData, 0.5),
    )

    const controlPoints = this.calculateControlPoints(
      rawSourcePoint,
      rawTargetPoint,
      sourceBBox,
      targetBBox,
      direction,
      directionSide,
      firstOffsetRatio,
      secondOffsetRatio,
    )

    const [sourcePoint, targetPoint] = this.getEndpoints(attributes, true, controlPoints)
    const points: Point[] = [sourcePoint, ...controlPoints, targetPoint]

    const startGap = Math.max(0, Number(attributes.startArrowOffset ?? 0))
    const endGap = Math.max(0, Number(attributes.endArrowOffset ?? 0))

    if (startGap > 0 && points.length > 1) {
      points[0] = this.retreatPoint(points[1], points[0], startGap)
    }
    if (endGap > 0 && points.length > 1) {
      const n = points.length
      points[n - 1] = this.retreatPoint(points[n - 2], points[n - 1], endGap)
    }

    const pathArray = this.buildPathArray(points, radius, sourcePoint, targetPoint)

    if (pathArray.length === 0) return super.getKeyPath(attributes)
    return pathArray
  }

  // ── 端点标签（startLabel / endLabel） ────────────────

  drawLabel(
    attributes: ParsedLabelEdgeStyleProps,
    container: Group,
    type: 'start' | 'end',
  ) {
    const key = type === 'start' ? 'startLabel' : 'endLabel'
    const keyShape = this.shapeMap['key'] as Path | undefined
    const middlePoint = type === 'start' ? keyShape?.getPoint?.(0.2) : keyShape?.getPoint(0.8)
    const [sourcePoint, targetPoint] = this.getEndpoints(attributes)
    const mx = Array.isArray(middlePoint) ? middlePoint[0] : middlePoint?.x
    const my = Array.isArray(middlePoint) ? middlePoint[1] : middlePoint?.y
    const x = typeof mx === 'number' ? mx : (sourcePoint[0] + targetPoint[0]) / 2
    const y = typeof my === 'number' ? my : (sourcePoint[1] + targetPoint[1]) / 2

    const style = subStyleProps(attributes, key) as any
    const offsetY = style.offsetY ?? 0
    const offsetX = style.offsetX ?? 0
    const text = style.text

    this.upsert(
      `label-${type}`,
      'text' as any,
      text ? {
        x,
        y,
        dx: offsetX,
        fontSize: 14,
        fill: '#8AB5D4',
        textBaseline: 'middle',
        textAlign: 'center',
        ...style,
      } : false,
      container,
    )
  }

  // ── 流动 + 呼吸动画 ───────────────────────────────────

  private startFlowAnimation() {
    const keyShape = this.shapeMap['key'] as Path
    if (!keyShape) return

    keyShape.style.lineDash = [7, 5]

    if (!this._flowAnim) {
      const anim = keyShape.animate(
        [{ lineDashOffset: 0 }, { lineDashOffset: -12 }],
        { duration: 700, iterations: Infinity, easing: 'linear' },
      ) as IAnimation | null
      if (anim) this._flowAnim = anim
    }

    if (!this._glowAnim) {
      const anim = keyShape.animate(
        [
          { strokeOpacity: 0.55 },
          { strokeOpacity: 1 },
          { strokeOpacity: 0.55 },
        ],
        { duration: 2400, iterations: Infinity, easing: 'ease-in-out' },
      ) as IAnimation | null
      if (anim) this._glowAnim = anim
    }
  }

  private stopAnimation(anim: IAnimation | null) {
    if (!anim) return
    try {
      anim.finish?.()
    } catch {
      // ignore
    }
    try {
      anim.cancel?.()
    } catch {
      // ignore
    }
  }

  private cleanupAnimations() {
    this.stopAnimation(this._flowAnim)
    this.stopAnimation(this._glowAnim)
    this._flowAnim = null
    this._glowAnim = null
  }

  onCreate() {
    this.startFlowAnimation()
  }

  onDestroy() {
    this.cleanupAnimations()
  }

  // ── 主渲染入口 ────────────────────────────────────────
  render(attributes: ParsedLabelEdgeStyleProps, container: Group) {
    super.render(attributes, container)
    this.drawLabel(attributes, container, 'start')
    this.drawLabel(attributes, container, 'end')
  }
}

register('edge', 'trace-edge', TraceEdge)
