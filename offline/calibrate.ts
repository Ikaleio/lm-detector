import { join, relative } from 'node:path'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { rankSharedNumbers, type SharedDetector } from '../shared/shared-detector'
import { sha256 } from '../cli/storage'
import { save } from './export'
import { fitRanker, type TrainingRow } from './train'
import { baseCondition, ENVIRONMENTS, environmentName, type ReferenceGroup } from './reference'
import { fitTemperature, mean, softmax } from './math'

const topIndex = (values: number[]) => values.indexOf(Math.max(...values))

function binaryMetrics(probabilities: number[][], truth: number[]) {
  const correct = probabilities.map((row, i) => Number(topIndex(row) === truth[i]))
  const confidence = probabilities.map(row => Math.max(...row))
  const accuracy = mean(correct), positives = correct.reduce((sum, value) => sum + value, 0)
  const ordered = confidence.map((value, i) => ({ value, correct: correct[i] })).sort((a, b) => a.value - b.value)
  let wins = 0, negatives = 0
  for (let i = 0; i < ordered.length;) {
    let end = i + 1
    while (end < ordered.length && ordered[end].value === ordered[i].value) end++
    let positive = 0
    for (let j = i; j < end; j++) positive += ordered[j].correct
    const negative = end - i - positive
    wins += positive * (negatives + .5 * negative)
    negatives += negative
    i = end
  }
  let ece = 0
  for (let bin = 0; bin < 10; bin++) {
    const indices = confidence.flatMap((value, i) => Math.min(9, Math.floor(value * 10)) === bin ? [i] : [])
    if (indices.length) ece += indices.length / truth.length
      * Math.abs(mean(indices.map(i => confidence[i])) - mean(indices.map(i => correct[i])))
  }
  return { groups: truth.length, top1_correct: positives, accuracy,
    binary_nll: -mean(confidence.map((value, i) => Math.log(Math.max(correct[i] ? value : 1 - value, 1e-15)))),
    binary_brier: mean(confidence.map((value, i) => (value - correct[i]) ** 2)),
    auc: positives && negatives ? wins / (positives * negatives) : null, ece,
    constant_binary_nll: -mean(correct.map(value => Math.log(Math.max(value ? accuracy : 1 - accuracy, 1e-15)))),
    constant_binary_brier: accuracy * (1 - accuracy),
    multiclass_nll: -mean(probabilities.map((row, i) => Math.log(Math.max(row[truth[i]], 1e-15)))) }
}

export async function calibrate(dataDir: string, out: string, rows: TrainingRow[],
  panel: ReferenceGroup[], artifact: SharedDetector, progress: (message: string) => void) {
  await mkdir(out)
  const ids = artifact.model_ids, byId = new Map(rows.map(row => [row.row_id, row]))
  const truth = panel.map(group => ids.indexOf(group.model))
  const numbers = panel.map(group => group.row_ids.map(id => byId.get(id)!.numbers))
  await save(join(out, 'plan.json'), { created_at: new Date().toISOString(),
    scope: 'Fit one positive temperature on the frozen ranker; ranking unchanged',
    method: 'Refit outside each environment, then minimize multiclass NLL on held-out three-answer groups',
    nested_check: 'Exclude each outer environment from every inner ranker and temperature fit',
    acceptance: { nested_binary_nll_below_constant: true, nested_auc_above: .75 },
    models: ids, environments: ENVIRONMENTS, tau_bounds: [.001, 1000],
    reference_sha256: artifact.source_reference_sha256, reference_panel: panel,
    external_training_forbidden: true, new_api_calls: 0 })
  const folds: { excluded_environments: number[]; training_rows: number; held_groups: number;
    artifact: string; sha256: string }[] = []
  const pairScores = new Map<string, Map<number, number[]>>()
  const scores: number[][] = Array(panel.length)

  async function scoreFold(excluded: number[]) {
    const conditions = new Set(excluded.map(environmentName))
    const training = rows.filter(row => !conditions.has(baseCondition(row.condition_id)))
    const held = panel.flatMap((group, i) => excluded.includes(group.environment) ? [i] : [])
    const heldIds = new Set(held.flatMap(i => panel[i].row_ids))
    if (training.some(row => heldIds.has(row.row_id)) || new Set(training.map(row => row.source)).size !== ids.length) {
      throw new Error('Held-out rows leaked into training or a model lost all training rows.')
    }
    const ranker = fitRanker(training, ids)
    const predictions = held.map(i => rankSharedNumbers(numbers[i], { ...artifact, ranker }))
    if (predictions.some(row => row.length !== ids.length || !row.every(Number.isFinite))) {
      throw new Error('Fold predictions are incomplete or nonfinite.')
    }
    const name = excluded.map(value => String(value).padStart(2, '0')).join('-')
    const file = `fold-${name}.json`
    await save(join(out, file), { excluded_environments: excluded,
      training_row_ids: training.map(row => row.row_id).sort(), held_row_ids: [...heldIds].sort(),
      query_ids: held.map(i => panel[i].id), ranking: predictions })
    folds.push({ excluded_environments: excluded, training_rows: training.length,
      held_groups: held.length, artifact: file, sha256: sha256(await readFile(join(out, file))) })
    progress(`FOLD ${name}: ${training.length} training rows (${folds.length}/78)`)
    return new Map(held.map((index, i) => [index, predictions[i]]))
  }

  for (const environment of ENVIRONMENTS) {
    for (const [i, prediction] of await scoreFold([environment])) scores[i] = prediction
    for (let inner = environment + 1; inner <= 12; inner++) {
      pairScores.set(`${environment}-${inner}`, await scoreFold([environment, inner]))
    }
  }
  const tau = fitTemperature(scores, truth), nestedTau: Record<string, number> = {}
  const nested: number[][] = Array(panel.length)
  for (const environment of ENVIRONMENTS) {
    const inner = panel.flatMap((group, i) => group.environment !== environment ? [i] : [])
    const innerScores = inner.map(i => {
      const other = panel[i].environment
      return pairScores.get(`${Math.min(environment, other)}-${Math.max(environment, other)}`)!.get(i)!
    })
    nestedTau[environment] = fitTemperature(innerScores, inner.map(i => truth[i]))
    panel.forEach((group, i) => {
      if (group.environment === environment) nested[i] = softmax(scores[i], nestedTau[environment])
    })
  }
  const pooled = scores.map(row => softmax(row, tau))
  const metrics = { tau, nested_tau: nestedTau, raw: binaryMetrics(scores.map(row => softmax(row)), truth),
    pooled: binaryMetrics(pooled, truth), nested: binaryMetrics(nested, truth),
    confusions: nested.flatMap((row, i) => topIndex(row) !== truth[i]
      ? [{ truth: ids[truth[i]], prediction: ids[topIndex(row)] }] : [])
      .sort((a, b) => a.truth < b.truth ? -1 : a.truth > b.truth ? 1 : a.prediction < b.prediction ? -1 : a.prediction > b.prediction ? 1 : 0) }
  await save(join(out, 'metrics.json'), metrics)
  await writeFile(join(out, 'oof.jsonl'), panel.map((group, i) => JSON.stringify({ id: group.id,
    environment: group.environment, truth: group.model, prediction: ids[topIndex(nested[i])],
    nested_top_probability: Math.max(...nested[i]), nested_truth_probability: nested[i][truth[i]],
    deployed_probabilities: pooled[i], ranking: scores[i] })).join('\n') + '\n')
  const gate = metrics.nested
  const passed = gate.binary_nll < gate.constant_binary_nll && gate.auc !== null && gate.auc > .75
  const head = { schema: 'shared-confidence-v2' as const, method: 'ranking-temperature' as const, tau,
    binding: { base_sha256: artifact.base_sha256, reference_sha256: artifact.source_reference_sha256, model_ids: ids },
    calibration_run: relative(dataDir, out), fit_groups: panel.length, fit_environments: ENVIRONMENTS.length,
    scope: 'Closed-set reference calibration. No unknown-model probability, acceptance threshold or identity certificate.' }
  await save(join(out, 'calibration.json'), head)
  const calibrationSha = sha256(await readFile(join(out, 'calibration.json')))
  const completion = { status: passed ? 'complete' : 'rejected', gate_passed: passed, models: ids.length,
    training_rows: rows.length, fit_groups: panel.length, folds, new_api_calls: 0,
    validation: 'nested-leave-environment-out', ranker_fits: folds.length, calibration_sha256: calibrationSha }
  await save(join(out, 'completion.json'), completion)
  if (passed) await save(join(out, 'calibration-frozen.json'), { sha256: calibrationSha, at: new Date().toISOString() })
  progress(`METRICS ${JSON.stringify({ tau, nested: gate, raw: metrics.raw })}`)
  return { passed, head, completion, calibrationSha }
}
