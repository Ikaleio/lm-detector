import type { Analysis } from '@fingerpoint/shared/types'
import type { I18n } from '@/i18n'
import { confidenceOf } from '@/lib/result-confidence'

export const isUncertain = (result: Analysis) =>
  confidenceOf(result.results[0] ?? {}) === null

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/** design.md 3.6：1200px 宽、2x、当前主题色；不含 Key、接口地址、模型输入、回复正文。 */
export async function exportResultImage(result: Analysis, i18n: I18n): Promise<void> {
  if (!result.results.length) throw new Error('No scored candidates')
  await document.fonts.ready
  const scale = 2, width = 1200, pad = 64, rowH = 56
  const rows = result.results.slice(0, 5)
  const height = pad + 40 + 32 + 160 + 24 + rows.length * rowH + 24 + 32 + pad
  const canvas = document.createElement('canvas')
  canvas.width = width * scale
  canvas.height = height * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')
  ctx.scale(scale, scale)

  const c = {
    bg: cssVar('--background'), card: cssVar('--card'), fg: cssVar('--foreground'),
    muted: cssVar('--muted'), mutedFg: cssVar('--muted-foreground'), border: cssVar('--border'), primary: cssVar('--primary'),
  }
  const fontFamily = cssVar('--font-sans')
  const font = (size: number, weight = 400) => `${weight} ${size}px ${fontFamily}`
  const uncertain = isUncertain(result)

  ctx.fillStyle = c.bg
  ctx.fillRect(0, 0, width, height)

  let y = pad
  ctx.fillStyle = c.mutedFg
  ctx.font = font(14, 500)
  ctx.textBaseline = 'top'
  ctx.fillText(i18n.t('app.name'), pad, y)
  const dateText = i18n.date(new Date())
  ctx.textAlign = 'right'
  ctx.fillText(dateText, width - pad, y)
  ctx.textAlign = 'left'
  y += 40

  // 顶名块
  const topH = 160
  roundRect(ctx, pad, y, width - pad * 2, topH, 12, c.card, c.border)
  const top = result.results[0]
  ctx.fillStyle = c.mutedFg
  ctx.font = font(13)
  ctx.fillText(i18n.t(uncertain ? 'detect.topUncertain' : 'detect.topLabel'), pad + 24, y + 24)
  ctx.fillStyle = uncertain ? c.mutedFg : c.fg
  ctx.font = font(36, 600)
  ctx.fillText(top?.display_name ?? result.prediction_name, pad + 24, y + 52, width - pad * 2 - 48 - 220)
  const conf = top ? confidenceOf(top) : null
  if (conf !== null) {
    ctx.textAlign = 'right'
    ctx.font = font(44, 600)
    ctx.fillText(i18n.percent(conf), width - pad - 24, y + 48)
    ctx.textAlign = 'left'
  }
  ctx.fillStyle = c.mutedFg
  ctx.font = font(14)
  if (top?.family_name) ctx.fillText(top.family_name, pad + 24, y + 108)
  y += topH + 24

  // 前 5 项
  roundRect(ctx, pad, y, width - pad * 2, rows.length * rowH, 12, c.card, c.border)
  const nameX = pad + 24 + 32, barX = width - pad - 24 - 80 - 24 - 320, barW = 320, pctX = width - pad - 24
  rows.forEach((r, i) => {
    const ry = y + i * rowH
    if (i > 0) { ctx.fillStyle = c.border; ctx.fillRect(pad + 1, ry, width - pad * 2 - 2, 1) }
    ctx.textBaseline = 'middle'
    ctx.fillStyle = c.mutedFg
    ctx.font = font(14)
    ctx.fillText(String(i + 1), pad + 24, ry + rowH / 2)
    ctx.fillStyle = c.fg
    ctx.font = font(15, 500)
    ctx.fillText(r.display_name, nameX, ry + rowH / 2, barX - nameX - 24)
    const v = confidenceOf(r)
    ctx.fillStyle = c.muted
    roundRect(ctx, barX, ry + rowH / 2 - 3, barW, 6, 3, c.muted)
    if (v !== null) {
      const fillWidth = barW * Math.min(1, Math.max(0, v))
      if (fillWidth > 0) roundRect(ctx, barX, ry + rowH / 2 - 3, fillWidth, 6, Math.min(3, fillWidth / 2), c.primary)
      ctx.textAlign = 'right'
      ctx.fillStyle = c.fg
      ctx.font = font(14, 500)
      ctx.fillText(i18n.percent(v), pctX, ry + rowH / 2)
      ctx.textAlign = 'left'
    }
    if (v === null) {
      ctx.textAlign = 'right'
      ctx.fillStyle = c.mutedFg
      ctx.fillText('—', pctX, ry + rowH / 2)
      ctx.textAlign = 'left'
    }
    ctx.textBaseline = 'top'
  })
  y += rows.length * rowH + 24

  ctx.fillStyle = c.mutedFg
  ctx.font = font(13)
  ctx.fillText(i18n.t('detect.imageScope', { n: rows.length, samples: result.used_outputs }), pad, y)
  ctx.font = font(12)
  ctx.fillText(i18n.t('detect.disclaimer'), pad, y + 28, width - pad * 2)

  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('canvas export failed')
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `fingerpoint-${new Date().toISOString().slice(0, 10)}.png`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string, stroke?: string) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  ctx.fillStyle = fill
  ctx.fill()
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke() }
}
