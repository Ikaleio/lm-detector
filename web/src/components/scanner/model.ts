import { brandLogos } from '@/lib/brand-logos'
import type { Bank } from '@fingerpoint/shared/types'

/** A family key of `lib/brand-logos.ts`, or `neutral` for a model the plaque cannot name. */
export type BrandId = keyof typeof brandLogos | 'neutral'
/** The scanner's own timeline: it scans while replies arrive and scoring runs, prints the ticket, then shows the report. */
export type Phase = 'editing' | 'scanning' | 'printing' | 'report'
export interface MotionState { scan: number; print: number; phase: Phase }
/** What the printed ticket shows: the top candidate's family and display name. */
export interface SceneResult { best: { id: BrandId; name: string }; title: string; detail: string }

/** Seconds the gantry sweeps before the ticket may print, and seconds the ticket takes to feed out. */
export const SCAN_SECONDS = 8
export const PRINT_SECONDS = 1.8

/** Plaque colours used while one logo morphs into the next. */
const colors: Record<string, string> = {
  claude: '#c76d4f', gemini: '#3186ff', deepseek: '#516dda', qwen: '#6756bd', muse: '#3f7de0', gpt: '#587c70',
  glm: '#1f55d5', mimo: '#f56600', hunyuan: '#0055e9', kimi: '#302c26', grok: '#302c26', step: '#2b5fd9',
}
export const brandColor = (id: BrandId) => colors[id] ?? '#8b8e87'

const patterns: [BrandId, RegExp][] = [
  ['claude', /claude|anthropic/],
  ['gemini', /gemini|google/],
  ['deepseek', /deepseek/],
  ['qwen', /qwen|通义|千问/],
  ['muse', /muse|meta|llama/],
  ['gpt', /gpt|openai|^o[134](?:\b|-)/],
  ['glm', /glm|z\.?ai|zhipu|智谱/],
  ['mimo', /mimo|xiaomi|小米/],
  ['hunyuan', /hunyuan|tencent|^hy\d|混元/],
  ['kimi', /kimi|moonshot/],
  ['grok', /grok|x-?ai/],
  ['step', /^step|stepfun/],
]

/** The family of a typed model name: an exact library id first, then a name prefix; `neutral` when neither matches. */
export function resolveBrand(name: string, bank?: Bank): BrandId {
  const n = name.trim().toLowerCase()
  if (!n) return 'neutral'
  const id = n.split('/').pop() ?? n
  const known = bank?.models.find(m => m.id.toLowerCase() === id || m.display_name.toLowerCase() === id)?.family
  if (known && known in brandLogos) return known
  return patterns.find(([brand, pattern]) => brand in brandLogos && pattern.test(id))?.[0] ?? 'neutral'
}

/** The logo as an image URL for canvas textures; currentColor parts print in ink on the paper label. */
export function brandImageUrl(id: BrandId): string | undefined {
  const svg = brandLogos[id]
  if (!svg) return undefined
  // Kimi's currentColor part is the white K on its dark tile; every other one is a black mark.
  const ink = id === 'kimi' ? '#ffffff' : '#302c26'
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="256" height="256">${svg.replaceAll('currentColor', ink)}</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
}
