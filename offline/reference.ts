import type { ReferenceRow } from '../shared/builder'

export const ENVIRONMENTS = Array.from({ length: 12 }, (_, i) => i + 1)
export const environmentName = (environment: number) => `environment-${String(environment).padStart(2, '0')}`
export const baseCondition = (condition: string) => condition.split(':', 1)[0].split('-e', 1)[0].split('-p', 1)[0]
export type ReferenceGroup = { id: string; model: string; environment: number; row_ids: string[];
  recorded_conditions: string[]; reasoning_efforts: (string | null)[] }

export function referencePanel(rows: ReferenceRow[], ids: string[]): ReferenceGroup[] {
  const first = new Map<string, ReferenceRow>()
  for (const row of rows) {
    const key = JSON.stringify([row.source, row.challenge_id])
    if (!first.has(key)) first.set(key, row)
  }
  return ids.flatMap(model => ENVIRONMENTS.map(environment => {
    const condition = environmentName(environment)
    const members = Array.from({ length: 3 }, (_, i) => {
      const query = `query-${String(environment * 3 - 2 + i).padStart(2, '0')}`
      const row = first.get(JSON.stringify([model, query]))
      if (!row) throw new Error(`Missing reference challenge: ${model}, ${query}.`)
      if (!new RegExp(`^${condition}(?:-[pe][0-9a-f]{12})?(?::.*)?$`).test(row.condition_id)) {
        throw new Error(`Reference condition mismatch: ${model}, ${condition}.`)
      }
      return row
    })
    return { id: `${model}:${condition}`, model, environment, row_ids: members.map(row => row.row_id),
      recorded_conditions: members.map(row => row.condition_id), reasoning_efforts: members.map(row => row.reasoning_effort) }
  }))
}
