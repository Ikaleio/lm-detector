import { fitRobustBank, type ReferenceRow } from '../shared/builder'
import { countNumbers, hellingerFeature, orderedBlockFeature } from '../shared/fingerprint-core.js'
import { POSITIONAL_WEIGHTS, positionalFeatures } from '../shared/positional'
import type { SharedDetector } from '../shared/shared-detector'
import { fitDiscriminant, fitTransform } from './math'

export type TrainingRow = ReferenceRow & { head: number[][]; positional: number[][] }

/** Features do not depend on a fold; fit normalization only after excluding its rows. */
export function prepareTrainingRows(rows: ReferenceRow[]): TrainingRow[] {
  return rows.map(row => {
    if (row.numbers.length < 80) throw new Error(`Reference sample ${row.row_id} has fewer than 80 valid numbers.`)
    const head = row.numbers.slice(0, 128)
    return { ...row, head: [hellingerFeature(countNumbers(head)), orderedBlockFeature(head)],
      positional: positionalFeatures(row.numbers) }
  })
}

export function fitRanker(rows: TrainingRow[], ids: string[]): SharedDetector['ranker'] {
  const labels = rows.map(row => ids.indexOf(row.source))
  if (labels.some(label => label < 0)) throw new Error('Training rows contain a model outside the bank.')
  const head = fitTransform(rows.map(row => row.head), [.75, .25])
  const full = fitTransform(rows.map(row => [row.h, row.o]), [.75, .25])
  const lda = fitDiscriminant(head.values, labels, ids.length, .05, true)
  const positional = fitTransform(rows.map(row => row.positional), POSITIONAL_WEIGHTS)
  const positionHead = fitDiscriminant(positional.values, labels, ids.length, .5, false)
  return {
    head_params: head.params, full_params: full.params, lda_weights: lda.weights, lda_bias: lda.bias,
    references: ids.map((_, k) => full.values.filter((_, i) => labels[i] === k)),
    bank: fitRobustBank(rows, ids), blend: { frequency: .5, positional: .5 },
    positional: { params: positional.params, ...positionHead },
  }
}
