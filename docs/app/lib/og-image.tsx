export type OgPage = {
  title: string
  description: string | null
  section: string | null
  byline: string
  host: string
}

export const ogSize = { width: 1200, height: 630 }

const fract = (value: number) => value - Math.floor(value)

const STILL_TIME = 3.7
const SEED = 7

function hash(x: number, y: number) {
  const a = fract((x + SEED) * 0.1031)
  const b = fract((y + SEED) * 0.1031)
  const c = a
  const dot = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33)
  return fract((a + dot + (b + dot)) * (c + dot))
}

type Cell = { x: number; y: number; alpha: number }

function fingerprintCells(size: number) {
  const t = Math.floor(STILL_TIME * 12) / 12
  const scan = size + 3 - (t * 7) % (size + 6)
  const cells: Cell[] = []
  for (let row = 0; row < size; row++) {
    const py = size - 1 - row + 0.5
    for (let x = 0; x < size; x++) {
      const px = x + 0.5
      const u = (px - size / 2) / (size / 2)
      const v = (py - size / 2) / (size / 2)
      const coreX = u * 1.2
      const coreY = (v + 0.2) * 0.9
      const d = Math.hypot(coreX, coreY) * 3.2 + Math.sin(coreX * 3 + t * 0.8) * 0.08
      const ring = Math.floor(d)
      const ridge = fract(d) >= 0.55 ? 1 : 0
      const turn = Math.atan2(coreY, coreX) / (Math.PI * 2) * (1 + ring) + hash(ring, 1) + t * 0.05 * ((ring % 2) - 0.5)
      const gap = fract(turn) >= 0.16 ? 1 : 0
      const shape = Math.hypot(u * 0.95, v * 0.82) <= 1 ? 1 : 0
      const glow = Math.max(0, 1 - Math.abs(py - scan) / 2.5)
      const alpha = Math.min(1, shape * (ridge * gap * (0.5 + 0.5 * glow) + glow * 0.2))
      if (alpha > 0.01) cells.push({ x, y: row, alpha })
    }
  }
  return cells
}

function rainCells(columns: number, rows: number) {
  const t = Math.floor(STILL_TIME * 20) / 20
  const frame = Math.floor(t * 9)
  const cells: Cell[] = []
  for (let x = 0; x < columns; x++) {
    const h = hash(x, 7)
    const length = 3 + Math.floor(hash(x, 11) * 8)
    const span = rows + length * 2
    const travel = t * (5 + h * 9) + h * 50
    const active = hash(x, Math.floor(travel / span)) >= 0.45 ? 1 : 0
    for (let row = 0; row < rows; row++) {
      const d = (travel % span) - length - row
      const trail = d >= 0 && d <= length ? 1 - d / (length + 1) : 0
      const glyph = hash(x + frame * 3, rows - 1 - row + frame) >= 0.3 ? 1 : 0
      const lead = d >= 0 && d < 1 ? 1 : 0
      const alpha = active * Math.max(trail * trail * glyph * 0.8, lead)
      if (alpha > 0.01) cells.push({ x, y: row, alpha })
    }
  }
  return cells
}

function PixelCells({ cells, columns, rows, cell, tw }: { cells: Cell[]; columns: number; rows: number; cell: number; tw: string }) {
  return (
    <div aria-hidden="true" tw={`relative shrink-0 ${tw}`} style={{ width: columns * cell, height: rows * cell }}>
      {cells.map(({ x, y, alpha }) => (
        <div key={`${x}-${y}`} tw="absolute" style={{ left: x * cell, top: y * cell, width: cell, height: cell, opacity: alpha, backgroundColor: 'currentColor' }} />
      ))}
    </div>
  )
}

export function PixelFingerprint({ size, cell, tw = '' }: { size: number; cell: number; tw?: string }) {
  return <PixelCells cells={fingerprintCells(size)} columns={size} rows={size} cell={cell} tw={tw} />
}

export function Brand({ byline, scale }: { byline: string; scale: number }) {
  return (
    <div tw="flex items-center" style={{ gap: 8 * scale }}>
      <PixelFingerprint size={16} cell={2 * scale} tw="text-fd-muted-foreground" />
      <div tw="flex flex-col">
        <span tw="whitespace-nowrap" style={{ fontFamily: 'var(--font-brand-title)', fontSize: 14 * scale, lineHeight: 1.25, fontWeight: 500 }}>Fingerprint Detector</span>
        <span tw="text-fd-foreground/70" style={{ fontFamily: 'var(--font-brand-byline)', fontSize: 12 * scale, lineHeight: `${16 * scale}px` }}>{byline}</span>
      </div>
    </div>
  )
}

export function OgImage(page: OgPage) {
  return (
    <div tw="flex flex-col w-full h-full bg-fd-background text-fd-foreground" className="dark">
      <div tw="flex items-center justify-between px-16 pt-14">
        <Brand byline={page.byline} scale={1.5} />
        <p tw="m-0 text-[22px] text-fd-muted-foreground">{page.host}</p>
      </div>
      <div tw="flex flex-col flex-1 justify-center px-16">
        {page.section && <p tw="m-0 mb-4 text-[24px] leading-[1.4] text-fd-muted-foreground line-clamp-1 text-ellipsis">{page.section}</p>}
        <p tw="m-0 text-[68px] leading-[1.12] font-semibold text-balance line-clamp-2 text-ellipsis">{page.title}</p>
        {page.description && <p tw="m-0 mt-6 text-[30px] leading-[1.5] text-fd-muted-foreground text-pretty line-clamp-2 text-ellipsis">{page.description}</p>}
      </div>
      <div tw="relative h-[128px] overflow-hidden border-t-2 border-fd-border">
        <div tw="flex" style={{ maskImage: 'linear-gradient(90deg, transparent 25%, #000 70%)' }}>
          <PixelCells cells={rainCells(150, 16)} columns={150} rows={16} cell={8} tw="text-fd-muted-foreground/30" />
        </div>
      </div>
    </div>
  )
}
