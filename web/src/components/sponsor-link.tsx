import { useEffect, useRef } from 'react'

/** Sponsor copy stays as the sponsor wrote it, in every interface language. */
const SPONSOR = {
  text: 'ISIF.NET 🇭🇰🇯🇵🇸🇬🇰🇷🇺🇸大陆优化服务器 年付36欧起',
  href: 'https://cloud.isif.net/login?affiliation_code=lmfpd',
}

type SponsorSlot = 'promo' | 'result'

function trackSponsor(event: 'sponsor-view' | 'sponsor-click', slot: SponsorSlot) {
  if (window.umami) window.umami.track(event, { slot })
  else if (import.meta.env.PROD && document.readyState !== 'complete') {
    // The deferred tracker can finish loading after the app starts rendering.
    window.addEventListener('load', () => window.umami?.track(event, { slot }), { once: true })
  }
}

/**
 * A plain-text ad in the sponsor color, sized like the text around it, linking to the sponsor's site.
 * Each mount sends `sponsor-view` once at least half of the ad is on screen, and each click, middle clicks
 * included, sends `sponsor-click`. Both carry `slot`, so the click-through rate per slot is their ratio.
 */
export function SponsorLink({ slot }: { slot: SponsorSlot }) {
  const link = useRef<HTMLAnchorElement>(null)
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.intersectionRatio >= 0.5)) return
      trackSponsor('sponsor-view', slot)
      observer.disconnect()
    }, { threshold: 0.5 })
    observer.observe(link.current!)
    return () => observer.disconnect()
  }, [slot])
  const trackClick = () => trackSponsor('sponsor-click', slot)
  return (
    <a
      ref={link}
      href={SPONSOR.href}
      target="_blank"
      rel="sponsored noopener noreferrer"
      className="fp-highlight-link"
      onClick={trackClick}
      onAuxClick={event => { if (event.button === 1) trackClick() }}
    >
      {SPONSOR.text}
    </a>
  )
}
