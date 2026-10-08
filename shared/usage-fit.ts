import { referenceSamples, type ReferenceBatch } from './reference'
import { estimateTokens, outputUsage } from './throughput'

/**
 * Output-token usage of number replies, fitted per reference model. Each tokenizer counts a reply's digits and the
 * text around them at its own rates, so the fit predicts how many output tokens a model reports for a given reply.
 * Usage separates tokenizer groups, not single models: many models share a tokenizer.
 */
export interface UsageFitModel {
  model: string
  /** Tokens per digit character. */
  digits: number
  /** Tokens per estimated token of everything that is not a digit. */
  other: number
  /** RMS of the log residuals of the model's own samples, at least SPREAD_FLOOR. */
  spread: number
  samples: number
}
export interface UsageFitBank { schema: 'usage-fit/1'; models: UsageFitModel[] }
/** A reply and the visible output tokens that the API reported for exactly that text. */
export interface UsageObservation { text: string; visible: number }
export interface UsageComparison {
  model: string
  /** Observed over predicted tokens, minus one, as the geometric mean over the observations. */
  deviation: number
  /** RMS of the log residuals in units of the model's spread. */
  score: number
  consistent: boolean
}

/** Replies shorter than this many estimated tokens carry too little signal. */
const MIN_ESTIMATE = 50
const MIN_SAMPLES = 8
/** Floor of a model's spread, so a model whose samples happen to agree closely still tolerates small drift. */
const SPREAD_FLOOR = 0.01
/** A model is consistent when the observations lie within this many spreads of its fit. */
export const CONSISTENT_SCORE = 2

/** Digit characters, and the estimated tokens of the parts between digit runs (split as in `estimateTokens`). */
export function usageFeatures(text: string) {
  let digits = 0, other = 0
  for (const [part] of text.matchAll(/ ?\p{L}+|\p{N}+|\s+|[^\s\p{L}\p{N}]+/gu)) {
    if (/\p{N}/u.test(part)) digits += part.length
    else other += /\p{L}/u.test(part) ? Math.ceil(part.length / 4) : 1
  }
  return { digits, other }
}

/** The observation of one reply, or undefined when usage is missing, unreadable or the reply is too short. */
export function usageObservation(text: string | undefined, usage: unknown): UsageObservation | undefined {
  const reported = outputUsage(usage)
  if (!text || !reported || estimateTokens(text) < MIN_ESTIMATE) return undefined
  const visible = reported.output - (reported.reasoning ?? 0)
  return visible > 0 ? { text, visible } : undefined
}

function fitModel(model: string, observations: UsageObservation[]): UsageFitModel {
  // Least squares through the origin on the two features, from the 2×2 normal equations.
  let dd = 0, do_ = 0, oo = 0, dt = 0, ot = 0
  const rows = observations.map(({ text, visible }) => ({ ...usageFeatures(text), visible }))
  for (const { digits, other, visible } of rows) { dd += digits * digits; do_ += digits * other; oo += other * other; dt += digits * visible; ot += other * visible }
  const det = dd * oo - do_ * do_
  if (!(det > 1e-9 * dd * oo)) throw new Error(`Usage fit for ${model} has collinear features.`)
  const digits = (dt * oo - ot * do_) / det, other = (ot * dd - dt * do_) / det
  const logs = rows.map(row => Math.log(row.visible / (digits * row.digits + other * row.other)))
  const spread = Math.max(SPREAD_FLOOR, Math.sqrt(logs.reduce((sum, x) => sum + x * x, 0) / logs.length))
  return { model, digits, other, spread, samples: rows.length }
}

/** Fits every reference model with at least MIN_SAMPLES replies that carry usage. */
export function fitUsage(batches: Iterable<ReferenceBatch>): UsageFitBank {
  const observations = new Map<string, UsageObservation[]>()
  for (const { batch, sample } of referenceSamples(batches)) {
    const observation = usageObservation(sample.text, sample.usage)
    if (!observation) continue
    const list = observations.get(batch.model.id) ?? []
    list.push(observation)
    observations.set(batch.model.id, list)
  }
  const models = [...observations].filter(([, list]) => list.length >= MIN_SAMPLES).map(([model, list]) => fitModel(model, list))
  return { schema: 'usage-fit/1', models }
}

export function assertUsageFitBank(value: unknown): asserts value is UsageFitBank {
  const bank = value as UsageFitBank
  if (bank?.schema !== 'usage-fit/1' || !Array.isArray(bank.models) || bank.models.some(m => typeof m.model !== 'string' || ![m.digits, m.other, m.spread].every(Number.isFinite))) {
    throw new Error('Usage fit data is invalid.')
  }
}

/** Every fitted model, ordered from the best match to the worst. */
export function compareUsage(bank: UsageFitBank, observations: UsageObservation[]): UsageComparison[] {
  if (!observations.length) return []
  const rows = observations.map(({ text, visible }) => ({ ...usageFeatures(text), visible }))
  return bank.models.map(fit => {
    const logs = rows.map(row => Math.log(row.visible / (fit.digits * row.digits + fit.other * row.other)))
    const mean = logs.reduce((sum, x) => sum + x, 0) / logs.length
    const score = Math.sqrt(logs.reduce((sum, x) => sum + (x / fit.spread) ** 2, 0) / logs.length)
    return { model: fit.model, deviation: Math.exp(mean) - 1, score, consistent: score <= CONSISTENT_SCORE }
  }).sort((a, b) => a.score - b.score)
}
