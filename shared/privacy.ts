// Public metadata and exports must not contain private gateway hostnames.
export function redactPrivateMetadata(value: unknown): any {
  if (typeof value === 'string') return value.replace(/\bmono\.[a-z0-9.-]+\b/gi, 'private.invalid')
  if (Array.isArray(value)) return value.map(redactPrivateMetadata)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactPrivateMetadata(item)]))
  return value
}
