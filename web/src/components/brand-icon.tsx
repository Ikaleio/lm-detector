import { brandLogos } from '@/lib/brand-logos'
import { cn } from '@/lib/utils'

/** A brand logo from `lib/brand-logos.ts` as a 16px inline icon; currentColor parts follow the text colour. */
export function BrandIcon({ family, className }: { family: keyof typeof brandLogos; className?: string }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" data-icon="inline-start" className={cn('size-4 shrink-0', className)} dangerouslySetInnerHTML={{ __html: brandLogos[family] }} />
}

/** A model family's logo, or an empty slot of the same size when the family has none, so names stay aligned. */
export function FamilyIcon({ family, className }: { family: string; className?: string }) {
  return family in brandLogos
    ? <BrandIcon family={family} className={className} />
    : <span aria-hidden="true" data-family-icon="none" className={cn('size-4 shrink-0', className)} />
}
