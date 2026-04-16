import { Rect as G6Rect, register } from '@antv/g6'
import { Image as GImage, Circle as GCircle, Text as GText, Rect as GRect, Path as GPath } from '@antv/g'
import type { Group } from '@antv/g'
import type { RectStyleProps } from '@antv/g6'

const NODE_W = 200
const ICON_SIZE = 16
const BTN_R = 9
const RISK_R = 5
const BTN_OFFSET = 10
const BTN_PAIR_DY = 11
const TOGGLE_GLYPH_HALF = 3.8
const TOGGLE_GLYPH_STROKE = 1.8

const ICON_SRC: Record<number, string> = {
  0: '/graph/user.svg',
  1: '/graph/exchange.svg',
  2: '/graph/binance.svg',
  3: '/graph/okx.svg',
  4: '/graph/imToken.svg',
}

const THEME = {
  center: { fill: '#0d2248', stroke: '#22d3ee', label: '#67e8f9' },
  left:   { fill: '#0d2a1a', stroke: '#22c55e', label: '#86efac' },
  right:  { fill: '#1e3a5f', stroke: '#3b82f6', label: '#93c5fd' },
}

function shortAddr(address: string): string {
  if (!address || address.length <= 12) return address
  return address.slice(0, 6) + '…' + address.slice(-4)
}

function getToggleGlyphPath(x: number, y: number, mode: 'plus' | 'minus') {
  const d: any[] = [
    ['M', x - TOGGLE_GLYPH_HALF, y],
    ['L', x + TOGGLE_GLYPH_HALF, y],
  ]
  if (mode === 'plus') {
    d.push(
      ['M', x, y - TOGGLE_GLYPH_HALF],
      ['L', x, y + TOGGLE_GLYPH_HALF],
    )
  }
  return d
}

export class FlowNode extends G6Rect {
  // 从 G6 数据模型读取原始业务数据
  private get nd(): any {
    return (this.context as any)?.model?.getElementDataById(this.id)?.data ?? {}
  }
  private get ns(): any {
    return (this.context as any)?.model?.getElementDataById(this.id)?.style ?? {}
  }

  private get nodeH(): number {
    return this.nd.direction === 'center' ? 64 : 50
  }

  private getTheme() {
    return THEME[this.nd.direction as keyof typeof THEME] ?? THEME.right
  }

  render(attributes: Required<RectStyleProps>, container: Group) {
    const {
      direction,
      labelType,
      address,
      riskScore,
      level,
    } = this.nd
    const showToggleControls = (attributes as any).showToggleControls ?? this.ns.showToggleControls
    const t = this.getTheme()
    const h = this.nodeH
    const w = NODE_W

    // 1. 背景矩形（key shape，节点的碰撞/选中区域）
    this.upsert('key', GRect, {
      width: w, height: h,
      x: -w / 2, y: -h / 2,
      radius: 8,
      fill: t.fill,
      stroke: t.stroke,
      lineWidth: direction === 'center' ? 3 : 2,
      shadowBlur: direction === 'center' ? 20 : 10,
      shadowColor: t.stroke,
    } as any, container)

    // 2. 左侧实体图标（基于 labelType）
    this.upsert('type-icon', GImage, {
      src: ICON_SRC[labelType ?? 0] ?? ICON_SRC[0],
      width: ICON_SIZE,
      height: ICON_SIZE,
      x: -w / 2 + 12,
      y: -ICON_SIZE / 2,
    } as any, container)

    // 3. 地址文本居中显示（轻微右偏以避开左侧图标）
    this.upsert('addr-text', GText, {
      text: shortAddr(address ?? ''),
      fill: t.label,
      fontSize: 11,
      fontWeight: 'bold',
      textAlign: 'center',
      textBaseline: 'middle',
      x: 4,
      y: 0,
    } as any, container)

    // 4. 右侧风险圆点（绿色=安全，红色=有风险）
    const riskColor = (riskScore ?? 0) > 0 ? '#ef4444' : '#22c55e'
    this.upsert('risk-dot', GCircle, {
      r: RISK_R,
      cx: w / 2 - 18,
      cy: 0,
      fill: riskColor,
      shadowBlur: 4,
      shadowColor: riskColor,
    } as any, container)

    // 5. 操作按钮：左右两侧都显示 +/-，+ 为该侧方向新增，- 为隐藏
    const isHovering = showToggleControls === true
    const showRight = isHovering && level < 5
    const showLeft  = isHovering && level < 5

    // 右侧 +：新增右向子节点
    this.upsert('toggle-btn-right-plus-bg', GCircle,
      showRight ? {
        r: BTN_R,
        cx: w / 2 + BTN_OFFSET,
        cy: -BTN_PAIR_DY,
        fill: '#0f2040',
        stroke: t.stroke,
        lineWidth: 1.5,
        cursor: 'pointer',
      } as any : false,
      container,
    )
    this.upsert('toggle-btn-right-plus-icon', GPath,
      showRight ? {
        d: getToggleGlyphPath(w / 2 + BTN_OFFSET, -BTN_PAIR_DY, 'plus'),
        stroke: t.stroke,
        lineWidth: TOGGLE_GLYPH_STROKE,
        lineCap: 'round',
        lineJoin: 'round',
        pointerEvents: 'none',
      } as any : false,
      container,
    )
    // 右侧 -：隐藏节点
    this.upsert('toggle-btn-right-minus-bg', GCircle,
      showRight ? {
        r: BTN_R,
        cx: w / 2 + BTN_OFFSET,
        cy: BTN_PAIR_DY,
        fill: '#0f2040',
        stroke: t.stroke,
        lineWidth: 1.5,
        cursor: 'pointer',
      } as any : false,
      container,
    )
    this.upsert('toggle-btn-right-minus-icon', GPath,
      showRight ? {
        d: getToggleGlyphPath(w / 2 + BTN_OFFSET, BTN_PAIR_DY, 'minus'),
        stroke: t.stroke,
        lineWidth: TOGGLE_GLYPH_STROKE,
        lineCap: 'round',
        lineJoin: 'round',
        pointerEvents: 'none',
      } as any : false,
      container,
    )

    // 左侧 +：新增左向子节点
    this.upsert('toggle-btn-left-plus-bg', GCircle,
      showLeft ? {
        r: BTN_R,
        cx: -w / 2 - BTN_OFFSET,
        cy: -BTN_PAIR_DY,
        fill: '#0f2040',
        stroke: t.stroke,
        lineWidth: 1.5,
        cursor: 'pointer',
      } as any : false,
      container,
    )
    this.upsert('toggle-btn-left-plus-icon', GPath,
      showLeft ? {
        d: getToggleGlyphPath(-w / 2 - BTN_OFFSET, -BTN_PAIR_DY, 'plus'),
        stroke: t.stroke,
        lineWidth: TOGGLE_GLYPH_STROKE,
        lineCap: 'round',
        lineJoin: 'round',
        pointerEvents: 'none',
      } as any : false,
      container,
    )
    // 左侧 -：隐藏节点
    this.upsert('toggle-btn-left-minus-bg', GCircle,
      showLeft ? {
        r: BTN_R,
        cx: -w / 2 - BTN_OFFSET,
        cy: BTN_PAIR_DY,
        fill: '#0f2040',
        stroke: t.stroke,
        lineWidth: 1.5,
        cursor: 'pointer',
      } as any : false,
      container,
    )
    this.upsert('toggle-btn-left-minus-icon', GPath,
      showLeft ? {
        d: getToggleGlyphPath(-w / 2 - BTN_OFFSET, BTN_PAIR_DY, 'minus'),
        stroke: t.stroke,
        lineWidth: TOGGLE_GLYPH_STROKE,
        lineCap: 'round',
        lineJoin: 'round',
        pointerEvents: 'none',
      } as any : false,
      container,
    )
  }
}

register('node', 'flow-node', FlowNode)
