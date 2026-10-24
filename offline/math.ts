import { CholeskyDecomposition, Matrix } from 'ml-matrix'

export type Preprocessing = { mean: number[]; scale: number[] }[]
export const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
export const dot = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + value * b[i], 0)

export function fitTransform(blocks: number[][][], weights: number[]) {
  const params = blocks[0].map((block, part) => {
    const center = block.map((_, j) => mean(blocks.map(row => row[part][j])))
    const scale = center.map((value, j) => {
      const deviation = Math.sqrt(mean(blocks.map(row => (row[part][j] - value) ** 2)))
      return deviation < 1e-10 ? 1 : deviation
    })
    return { mean: center, scale }
  })
  const values = blocks.map(parts => parts.flatMap((block, part) => {
    const scaled = block.map((value, j) => (value - params[part].mean[j]) / params[part].scale[j])
    const length = Math.max(Math.sqrt(dot(scaled, scaled)), 1e-12)
    return scaled.map(value => value / length * Math.sqrt(weights[part]))
  }))
  return { params, values }
}

/** Solve the regularized covariance system without forming its inverse. */
export function fitDiscriminant(values: number[][], labels: number[], classes: number,
  shrinkage: number, equalClassCovariance: boolean) {
  const dimension = values[0].length
  const centers = Array.from({ length: classes }, () => new Float64Array(dimension))
  const counts = Array(classes).fill(0) as number[]
  values.forEach((row, i) => {
    counts[labels[i]]++
    for (let j = 0; j < dimension; j++) centers[labels[i]][j] += row[j]
  })
  centers.forEach((row, k) => {
    if (!counts[k]) throw new Error('Every reference model needs training rows.')
    for (let j = 0; j < dimension; j++) row[j] /= counts[k]
  })
  const covariance = Array.from({ length: dimension }, () => new Float64Array(dimension))
  const residual = new Float64Array(dimension)
  for (let row = 0; row < values.length; row++) {
    const label = labels[row], center = centers[label]
    const weight = equalClassCovariance ? 1 / (classes * counts[label]) : 1 / values.length
    for (let i = 0; i < dimension; i++) residual[i] = values[row][i] - center[i]
    for (let i = 0; i < dimension; i++) {
      const target = covariance[i], value = residual[i] * weight
      for (let j = 0; j <= i; j++) target[j] += value * residual[j]
    }
  }
  const trace = covariance.reduce((sum, row, i) => sum + row[i], 0) / dimension
  const target = equalClassCovariance ? trace : Math.max(trace, 1e-12)
  for (let i = 0; i < dimension; i++) {
    for (let j = 0; j <= i; j++) {
      const value = (1 - shrinkage) * covariance[i][j] + (i === j ? shrinkage * target : 0)
      covariance[i][j] = value
      covariance[j][i] = value
    }
  }
  const centerMatrix = new Matrix(centers.map(row => Array.from(row)))
  const system = new CholeskyDecomposition(new Matrix(covariance.map(row => Array.from(row))))
  const weights = system.solve(centerMatrix.transpose()).transpose().to2DArray()
  const bias = weights.map((row, k) => -.5 * dot(row, Array.from(centers[k]))
    + (equalClassCovariance ? -Math.log(classes) : 0))
  if (!weights.every(row => row.every(Number.isFinite)) || !bias.every(Number.isFinite)) {
    throw new Error('Discriminant fitting produced nonfinite parameters.')
  }
  return { weights, bias }
}

export function softmax(scores: number[], tau = 1): number[] {
  const scaled = scores.map(value => value * tau), maximum = Math.max(...scaled)
  const weights = scaled.map(value => Math.exp(value - maximum))
  const total = weights.reduce((sum, value) => sum + value, 0)
  return weights.map(value => value / total)
}

/** Multiclass NLL is convex in the positive inverse temperature. */
export function fitTemperature(scores: number[][], truth: number[]): number {
  let low = .001, high = 1000
  for (let step = 0; step < 64; step++) {
    const tau = (low + high) / 2
    const derivative = mean(scores.map((row, i) => dot(softmax(row, tau), row) - row[truth[i]]))
    if (!Number.isFinite(derivative)) throw new Error('Temperature fitting produced a nonfinite derivative.')
    if (derivative > 0) high = tau
    else low = tau
  }
  return (low + high) / 2
}
