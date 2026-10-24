import { countNumbers, hellingerFeature, orderedBlockFeature } from './fingerprint-core.js'

/** Shared by training and inference; block order is part of the detector format. */
export const POSITIONAL_WEIGHTS = [.6, .15, .125, .125]
const CENTRES = Array.from({length: 24}, (_, i) => 1 + i * 354 / 23)
const LAGS = [1, 2, 3, 5, 8, 13, 21, 34]

export type PositionalHead = {params: {mean: number[]; scale: number[]}[]; weights: number[][]; bias: number[]}

const mean = (values: number[]) => values.reduce((sum, x) => sum + x, 0) / values.length
const fraction = (length: number, test: (i: number) => boolean) => {
  let hits = 0
  for (let i = 0; i < length; i++) if (test(i)) hits++
  return hits / length
}

function positionKernel(x: number[]): number[] {
  const n = x.length, out = Array(34 * 3).fill(0)
  x.forEach((value, position) => {
    const t = (position + .5) * 2 / n - 1, basis = [t, .5 * (3 * t * t - 1), .5 * (5 * t ** 3 - 3 * t)]
    const features = [...CENTRES.map(centre => Math.exp(-.5 * ((value - centre) / 20) ** 2)),
      ...Array.from({length: 10}, (_, digit) => digit === value % 10 ? 1 : 0)]
    features.forEach((weight, k) => basis.forEach((b, j) => { out[k * 3 + j] += weight * b / n }))
  })
  return out
}

function centredTransitions(symbols: number[], bins: number): number[] {
  const joint = Array(bins * bins).fill(.5), total = symbols.length - 1 + .5 * bins * bins
  for (let i = 1; i < symbols.length; i++) joint[symbols[i - 1] * bins + symbols[i]] += 1
  for (let i = 0; i < joint.length; i++) joint[i] /= total
  const rows = Array.from({length: bins}, (_, a) => joint.slice(a * bins, a * bins + bins).reduce((s, v) => s + v, 0))
  const columns = Array.from({length: bins}, (_, b) => rows.reduce((s, _, a) => s + joint[a * bins + b], 0))
  return joint.map((value, i) => value - rows[Math.floor(i / bins)] * columns[i % bins])
}

function sequenceFeatures(x: number[]): number[] {
  const n = x.length, m = mean(x), sd = Math.max(Math.sqrt(mean(x.map(v => (v - m) ** 2))), 1)
  const s = x.map(v => (v - m) / sd), out: number[] = []
  for (const lag of LAGS) {
    const count = n - lag, d = Array.from({length: count}, (_, i) => x[i + lag] - x[i])
    out.push(mean(d.map((_, i) => s[i + lag] * s[i])), mean(d.map(Math.abs)) / 355, fraction(count, i => d[i] > 0),
      fraction(count, i => d[i] === 0), fraction(count, i => Math.abs(d[i]) <= 5), fraction(count, i => Math.abs(d[i]) <= 20))
  }
  out.push(...centredTransitions(x.map(v => Math.min(7, Math.floor((v - 1) * 8 / 355))), 8))
  out.push(...centredTransitions(x.map(v => v % 10), 10))
  const difference = Array.from({length: n - 1}, (_, i) => x[i + 1] - x[i])
  const zStep = Array.from({length: n - 1}, (_, i) => Math.abs(s[i + 1] - s[i]))
  out.push(fraction(n - 2, i => Math.sign(difference[i + 1]) === Math.sign(difference[i])),
    fraction(n - 2, i => difference[i + 1] === difference[i]),
    fraction(n - 1, i => x[i] % 10 === x[i + 1] % 10),
    fraction(n - 1, i => zStep[i] > 1), fraction(n - 1, i => zStep[i] > 2))
  const buckets = x.map(v => Math.min(15, Math.floor((v - 1) * 16 / 355)))
  for (const width of [4, 8, 16]) {
    let sum = 0
    for (let i = 0; i + width <= n; i++) sum += new Set(buckets.slice(i, i + width)).size / width
    out.push(sum / (n - width + 1))
  }
  return out
}

export function positionalFeatures(numbers: number[]): number[][] {
  return [hellingerFeature(countNumbers(numbers)), orderedBlockFeature(numbers), positionKernel(numbers), sequenceFeatures(numbers)]
}

/** Per-answer decision values over identities. */
export function positionalDecision(numbers: number[], head: PositionalHead): number[] {
  const parts = positionalFeatures(numbers)
  const x = parts.flatMap((block, j) => {
    const p = head.params[j], scaled = block.map((v: number, i: number) => (v - p.mean[i]) / p.scale[i])
    const length = Math.max(Math.sqrt(scaled.reduce((sum: number, v: number) => sum + v * v, 0)), 1e-12)
    return scaled.map((v: number) => v / length * Math.sqrt(POSITIONAL_WEIGHTS[j]))
  })
  return head.weights.map((row, k) => row.reduce((sum, w, i) => sum + w * x[i], head.bias[k]))
}
