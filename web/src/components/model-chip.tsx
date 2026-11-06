import type { ReactNode } from 'react'
import { Link } from 'react-router'

/** A bordered link to a model's library page; children are its name and a muted trailing value. */
export function ModelChip({ id, title, children }: { id: string; title?: string; children: ReactNode }) {
  return (
    <Link to={`/library/${encodeURIComponent(id)}`} title={title} className="flex h-8 min-w-0 items-center gap-2 rounded-lg border border-border bg-card px-3 text-body hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
      {children}
    </Link>
  )
}
