export const NORMAL_CONFIDENCE_THRESHOLD = 0.75

export const confidenceOf = (r: { verification_confidence?: number | null; probability?: number | null }) =>
  r.verification_confidence ?? r.probability ?? null
