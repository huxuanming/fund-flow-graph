export type NumberLike = number | string | null | undefined

function trimTrailingZeros(value: string): string {
  return value.replace(/\.?0+$/, '')
}

const SUBSCRIPT_DIGITS = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉']

function toSubscript(value: number): string {
  return String(value)
    .split('')
    .map(char => (/\d/.test(char) ? SUBSCRIPT_DIGITS[Number(char)] : char))
    .join('')
}

function formatTinyDecimal(value: number, maxDigits = 12): string {
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  const fixed = abs.toFixed(maxDigits)
  const [, decimal = ''] = fixed.split('.')
  const zeroCount = decimal.match(/^0*/)?.[0].length ?? 0
  const significant = decimal.slice(zeroCount).replace(/0+$/, '') || '0'
  return `${sign}0.0${toSubscript(zeroCount)}${significant}`
}

function toFiniteNumber(input: NumberLike): number | null {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? input : null
  }

  if (typeof input === 'string') {
    const normalized = input.trim().replace(/,/g, '')
    if (!normalized) return null
    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

export interface FormatAmountOptions {
  unitPrecision?: number
  smallPrecision?: number
  defaultPrecision?: number
  tinyThreshold?: number
}

export function formatAmount(
  input: NumberLike,
  options: FormatAmountOptions = {},
): string {
  const value = toFiniteNumber(input)
  if (value === null) return ''
  if (value === 0) return '0'

  const {
    unitPrecision = 2,
    smallPrecision = 8,
    defaultPrecision = 2,
    tinyThreshold = 1e-3,
  } = options

  const abs = Math.abs(value)

  if (abs >= 1e6) {
    return `${trimTrailingZeros((value / 1e6).toFixed(unitPrecision))}M`
  }

  if (abs >= 1e3) {
    return `${trimTrailingZeros((value / 1e3).toFixed(unitPrecision))}K`
  }

  if (abs > 0 && abs < tinyThreshold) {
    return formatTinyDecimal(value)
  }

  if (abs < 1) {
    return trimTrailingZeros(value.toFixed(smallPrecision))
  }

  return trimTrailingZeros(value.toFixed(defaultPrecision))
}
