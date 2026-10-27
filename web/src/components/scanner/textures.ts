import * as THREE from 'three'
import { brandColor, brandImageUrl, type BrandId } from './model'

const FONT = '"Geist Variable", "Microsoft YaHei", "PingFang SC", sans-serif'
const PLAQUE_WIDTH = 1024
const PLAQUE_HEIGHT = 480
const images = new Map<string, HTMLImageElement>()
const pending = new Map<string, Promise<HTMLImageElement>>()
type MorphPoint = { x: number; y: number; r: number; g: number; b: number }
export interface PlaqueMorphTexture {
  texture: THREE.CanvasTexture
  ready: Promise<void>
  render: (progress: number) => void
  dispose: () => void
}
export function loadBrand(id: BrandId): Promise<HTMLImageElement | undefined> {
  const url = brandImageUrl(id)
  if (!url) return Promise.resolve(undefined)
  if (images.has(url)) return Promise.resolve(images.get(url))
  if (!pending.has(url)) pending.set(url, new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => { images.set(url, img); resolve(img) }
    img.onerror = () => reject(new Error(`Local logo could not load: ${url}`))
    img.src = url
  }))
  return pending.get(url)!
}
function canvas(width: number, height: number) {
  const c = document.createElement('canvas'); c.width = width; c.height = height
  return { c, ctx: c.getContext('2d')! }
}
function texture(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8
  return t
}
function drawPlaqueLogo(ctx: CanvasRenderingContext2D, img?: HTMLImageElement) {
  if (img) ctx.drawImage(img, 50, 130, 132, 132)
  else neutralMark(ctx, 50, 130, 132)
}
function drawPlaqueName(ctx: CanvasRenderingContext2D, name: string) {
  ctx.fillStyle = '#26292d'
  let font = 90
  while (font > 26) { ctx.font = `600 ${font}px ${FONT}`; if (ctx.measureText(name).width <= 716) break; font -= 2 }
  const words = [...name]
  let line = ''
  const lines: string[] = []
  for (const ch of words) {
    if (ctx.measureText(line + ch).width > 715 && line) { lines.push(line); line = '' }
    line += ch
  }
  lines.push(line)
  const logoCenterY = 196
  const lineHeight = font * .88
  const firstLineY = logoCenterY - (lines.length - 1) * lineHeight / 2
  ctx.textBaseline = 'middle'
  lines.forEach((value, index) => ctx.fillText(value, 220, firstLineY + index * lineHeight))
}
function morphPoints(ctx: CanvasRenderingContext2D, bounds: { x: number; y: number; width: number; height: number }, count: number) {
  const image = ctx.getImageData(bounds.x, bounds.y, bounds.width, bounds.height)
  const points: MorphPoint[] = []
  for (let y = 0; y < bounds.height; y += 2) {
    for (let x = 0; x < bounds.width; x += 2) {
      const offset = (y * bounds.width + x) * 4
      if (image.data[offset + 3] > 40) points.push({ x: bounds.x + x, y: bounds.y + y, r: image.data[offset], g: image.data[offset + 1], b: image.data[offset + 2] })
    }
  }
  points.sort((a, b) => {
    const columnA = Math.floor((a.x - bounds.x) / 8)
    const columnB = Math.floor((b.x - bounds.x) / 8)
    return columnA === columnB ? (columnA % 2 ? b.y - a.y : a.y - b.y) : columnA - columnB
  })
  if (!points.length) return Array.from({ length: count }, () => ({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, r: 124, g: 133, b: 124 }))
  return Array.from({ length: count }, (_, index) => points[Math.min(points.length - 1, Math.floor(index * points.length / count))])
}
function colorChannels(hex: string) {
  const value = Number.parseInt(hex.replace('#', ''), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255] as const
}
function createMorphTexture(from: CanvasRenderingContext2D, to: CanvasRenderingContext2D, bounds: { x: number; y: number; width: number; height: number }, count: number, fromColor: string, toColor: string, samplePointColors = false): PlaqueMorphTexture {
  const { c, ctx } = canvas(PLAQUE_WIDTH, PLAQUE_HEIGHT)
  const output = texture(c)
  const fromPoints = morphPoints(from, bounds, count)
  const toPoints = morphPoints(to, bounds, count)
  const source = colorChannels(fromColor)
  const target = colorChannels(toColor)
  const render = (progress: number) => {
    const t = THREE.MathUtils.clamp(progress, 0, 1)
    ctx.clearRect(0, 0, PLAQUE_WIDTH, PLAQUE_HEIGHT)
    if (!samplePointColors) ctx.fillStyle = `rgb(${Math.round(THREE.MathUtils.lerp(source[0], target[0], t))}, ${Math.round(THREE.MathUtils.lerp(source[1], target[1], t))}, ${Math.round(THREE.MathUtils.lerp(source[2], target[2], t))})`
    const size = bounds.width < 200 ? 4.2 : 3.1
    for (let index = 0; index < count; index++) {
      const a = fromPoints[index]
      const b = toPoints[index]
      const x = THREE.MathUtils.lerp(a.x, b.x, t)
      const y = THREE.MathUtils.lerp(a.y, b.y, t)
      if (samplePointColors) ctx.fillStyle = `rgb(${Math.round(THREE.MathUtils.lerp(a.r, b.r, t))}, ${Math.round(THREE.MathUtils.lerp(a.g, b.g, t))}, ${Math.round(THREE.MathUtils.lerp(a.b, b.b, t))})`
      ctx.fillRect(x - size / 2, y - size / 2, size, size)
    }
    output.needsUpdate = true
  }
  render(0)
  return { texture: output, ready: Promise.resolve(), render, dispose: () => output.dispose() }
}
export function neutralMark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.save(); ctx.strokeStyle = '#80868d'; ctx.lineWidth = size / 22
  for (let i = 0; i < 4; i++) { const r = size * (.12 + i * .08); ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, r, -.5, 4.4); ctx.stroke() }
  ctx.restore()
}
export function kraftTexture() {
  const { c, ctx } = canvas(512, 512)
  ctx.fillStyle = '#C9B59C'; ctx.fillRect(0, 0, 512, 512)
  let seed = 771
  for (let i = 0; i < 17000; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const x = seed % 512; const y = (seed >>> 12) % 512
    ctx.fillStyle = i % 2 ? 'rgba(255,236,203,.10)' : 'rgba(71,47,21,.07)'
    ctx.fillRect(x, y, 1 + i % 2, 1)
  }
  const t = texture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 2)
  return t
}
export function plaqueBaseTexture() {
  const { c, ctx } = canvas(1024, 480)
  ctx.fillStyle = '#F9F8F6'; ctx.fillRect(0, 0, 1024, 480)
  ctx.strokeStyle = '#d5d8dc'; ctx.lineWidth = 3; ctx.strokeRect(18, 18, 988, 444)
  ctx.fillStyle = '#6d737a'; ctx.font = `500 27px ${FONT}`; ctx.fillText('MODEL UNDER OBSERVATION', 50, 70)
  ctx.fillStyle = '#6d737a'; ctx.font = `26px ${FONT}`; ctx.fillText('DECLARED LABEL', 220, 310)
  ctx.fillStyle = '#2b2e32'
  for (let x = 52; x < 550; x += 9) ctx.fillRect(x, 367, (x % 17) > 8 ? 3 : 6, 55)
  ctx.font = `24px ${FONT}`; ctx.fillText('LM · DECLARED LABEL', 655, 407)
  return texture(c)
}
export function plaqueLogoTexture(id: BrandId, ready?: () => void) {
  const { c, ctx } = canvas(PLAQUE_WIDTH, PLAQUE_HEIGHT)
  const t = texture(c)
  const draw = (img?: HTMLImageElement) => {
    ctx.clearRect(0, 0, PLAQUE_WIDTH, PLAQUE_HEIGHT)
    drawPlaqueLogo(ctx, img)
    t.needsUpdate = true; ready?.()
  }
  draw()
  void loadBrand(id).then(draw).catch(() => draw())
  return t
}
export function plaqueNameTexture(name: string) {
  const { c, ctx } = canvas(PLAQUE_WIDTH, PLAQUE_HEIGHT)
  drawPlaqueName(ctx, name)
  return texture(c)
}
export function plaqueLogoMorphTexture(fromId: BrandId, toId: BrandId, ready?: () => void): PlaqueMorphTexture {
  const source = canvas(PLAQUE_WIDTH, PLAQUE_HEIGHT)
  const target = canvas(PLAQUE_WIDTH, PLAQUE_HEIGHT)
  const placeholder = canvas(PLAQUE_WIDTH, PLAQUE_HEIGHT)
  const output = texture(placeholder.c)
  let active: PlaqueMorphTexture | null = null
  let disposed = false
  const readyPromise = Promise.all([loadBrand(fromId), loadBrand(toId)]).then(([fromImage, toImage]) => {
    drawPlaqueLogo(source.ctx, fromImage)
    drawPlaqueLogo(target.ctx, toImage)
    active = createMorphTexture(source.ctx, target.ctx, { x: 42, y: 122, width: 148, height: 148 }, 1700, brandColor(fromId), brandColor(toId), true)
    if (disposed) {
      active.dispose()
      active = null
      return
    }
    placeholder.ctx.clearRect(0, 0, PLAQUE_WIDTH, PLAQUE_HEIGHT)
    placeholder.ctx.drawImage(active.texture.image, 0, 0)
    output.needsUpdate = true
    ready?.()
  })
  return {
    texture: output,
    ready: readyPromise,
    render(progress) {
      if (!active) return
      active.render(progress)
      placeholder.ctx.clearRect(0, 0, PLAQUE_WIDTH, PLAQUE_HEIGHT)
      placeholder.ctx.drawImage(active.texture.image, 0, 0)
      output.needsUpdate = true
    },
    dispose() {
      disposed = true
      active?.dispose()
      active = null
      output.dispose()
    },
  }
}
export function plaqueNameMorphTexture(fromName: string, toName: string): PlaqueMorphTexture {
  const source = canvas(PLAQUE_WIDTH, PLAQUE_HEIGHT)
  const target = canvas(PLAQUE_WIDTH, PLAQUE_HEIGHT)
  drawPlaqueName(source.ctx, fromName)
  drawPlaqueName(target.ctx, toName)
  return createMorphTexture(source.ctx, target.ctx, { x: 210, y: 105, width: 735, height: 185 }, 4200, '#26292d', '#26292d')
}
/** `title` is the localized heading above the logo; `detail` the line under the name, such as the confidence. */
export function ticketTexture(name: string, id: BrandId, title: string, detail: string) {
  const { c, ctx } = canvas(1024, 1024)
  const t = texture(c)
  const draw = (img?: HTMLImageElement) => {
    ctx.fillStyle = '#F9F8F6'; ctx.fillRect(0, 0, 1024, 1024)
    ctx.fillStyle = '#3c4046'; ctx.textAlign = 'center'; ctx.font = `600 68px ${FONT}`
    ctx.fillText(title, 512, 258, 890)
    if (img) ctx.drawImage(img, 394, 328, 236, 236)
    else neutralMark(ctx, 394, 328, 236)
    ctx.fillStyle = '#15171a'; ctx.font = `700 96px ${FONT}`
    ctx.fillText(name, 512, 688, 890)
    if (detail) { ctx.fillStyle = '#3c4046'; ctx.font = `500 56px ${FONT}`; ctx.fillText(detail, 512, 772, 890) }
    ctx.strokeStyle = '#d3d6da'; ctx.setLineDash([8, 12]); ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(105, 832); ctx.lineTo(919, 832); ctx.stroke()
    ctx.font = `27px ${FONT}`; ctx.fillStyle = '#7b8188'; ctx.fillText('RANKING / NOT IDENTITY PROOF', 512, 910)
    t.needsUpdate = true
  }
  draw(); void loadBrand(id).then(draw).catch(() => draw())
  return t
}
export function machineLabel() {
  const { c, ctx } = canvas(1024, 160)
  ctx.fillStyle = '#2e3237'; ctx.fillRect(0, 0, 1024, 160)
  ctx.fillStyle = '#e6e9ec'; ctx.font = `500 49px ${FONT}`; ctx.fillText('FINGERPOINT', 20, 78)
  ctx.fillStyle = '#9aa3ad'; ctx.font = `25px ${FONT}`; ctx.fillText('BEHAVIOR SCANNER   /   LM–01', 24, 130)
  return texture(c)
}
export function topStamp() {
  const { c, ctx } = canvas(512, 240)
  ctx.fillStyle = '#796242'; ctx.font = `bold 38px ${FONT}`; ctx.fillText('↑  ↑', 25, 53)
  ctx.font = `28px ${FONT}`; ctx.fillText('HANDLE WITH CURIOSITY', 25, 112)
  ctx.font = `24px ${FONT}`; ctx.fillText('3 SAMPLES / LOCAL ONLY', 25, 157)
  return texture(c)
}

