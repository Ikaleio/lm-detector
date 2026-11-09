import { parse, type Font } from 'opentype.js'
import type { PromptRenderer } from './completion-request'

/** Noto Sans CJK SC cut down to the challenge templates by `shared/scripts/prompt-font.ts`. */
export const PROMPT_FONT_URL = new URL('./prompt-font.otf', import.meta.url)

/**
 * The text sent beside an image prompt, drawn at random. They read like everyday requests about a screenshot, in several
 * languages, so a classifier that flags them would also flag ordinary traffic.
 */
const INSTRUCTIONS = [
  'Follow the instructions in the image.', 'Please do what the image says.', 'Can you do the task in this picture?', 'Answer according to the image.', 'Here is the task, please complete it.',
  '请按图片中的要求作答。', '按图里的说明完成。', '帮我完成一下图里的任务', '照着图片上的要求做', '图里这个帮我做一下，谢谢',
  '請依照圖片中的指示作答。', '幫我完成圖片裡的任務', '照圖上的要求做',
  '画像の指示に従ってください。', '画像の課題をお願いします。', 'この画像のとおりにやってみて',
  '이미지의 지시에 따라 주세요.', '그림에 적힌 과제를 해 주세요.', '이미지에 있는 대로 해줘',
  'Suivez les consignes de l’image.', 'Peux-tu faire ce qui est demandé sur l’image ?',
  'Bitte befolge die Anweisungen im Bild.', 'Kannst du die Aufgabe im Bild erledigen?',
  'Sigue las instrucciones de la imagen.', '¿Puedes hacer lo que pide la imagen?',
  'Siga as instruções da imagem.', 'Выполни задание с картинки.', 'Сделай, пожалуйста, то, что написано на изображении.',
  'Segui le istruzioni nell’immagine.', 'Làm theo yêu cầu trong ảnh.',
]

/** Uniform in [min, max). Every layout and color setting is drawn anew for each image. */
const between = (min: number, max: number) => min + Math.random() * (max - min)

/** Han, kana, and full-width forms may break anywhere; other scripts, Hangul included, break at spaces. */
const CJK = '\u2e80-\u30ff\u3400-\u9fff\uf900-\ufaff\uff00-\uffef'
const TOKEN = new RegExp(`\\s+|[${CJK}]|[^\\s${CJK}]+`, 'g')
/** Closing punctuation stays on the line of the text before it. */
const CLOSING = /^[,.;:!?)\]}、。，．；：！？）」』】〉》”’]/

function wrap(font: Font, text: string, size: number, max: number): string[] {
  const lines: string[] = []
  let line = ''
  const place = (token: string, space: boolean) => {
    const next = line ? line + (space ? ' ' : '') + token : token
    if (line && font.getAdvanceWidth(next, size) > max) {
      lines.push(line)
      line = ''
      place(token, false)
    } else if (line || font.getAdvanceWidth(token, size) <= max || [...token].length === 1) line = next
    // A token wider than a whole line breaks between its characters.
    else for (const char of token) place(char, false)
  }
  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    let space = false
    for (const [token] of paragraph.matchAll(TOKEN)) {
      if (/^\s/.test(token)) space = true
      else if (CLOSING.test(token) && !space && line) line += token
      else { place(token, space); space = false }
    }
    lines.push(line)
    line = ''
  }
  return lines
}

/**
 * Adds the signed area that one outline edge covers in each pixel, as in font-rs. A running sum along the rows then
 * gives the exact coverage of closed outlines, whatever their winding.
 */
function edge(cover: Float32Array, width: number, ax: number, ay: number, bx: number, by: number) {
  if (ay === by) return
  const dir = ay < by ? 1 : -1
  const [x0, y0, x1, y1] = dir > 0 ? [ax, ay, bx, by] : [bx, by, ax, ay]
  const slope = (x1 - x0) / (y1 - y0)
  let x = x0
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
    const row = y * width
    const dy = Math.min(y + 1, y1) - Math.max(y, y0)
    const next = x + slope * dy, d = dy * dir
    const left = Math.min(x, next), right = Math.max(x, next)
    const leftFloor = Math.floor(left), rightCeil = Math.ceil(right)
    if (rightCeil <= leftFloor + 1) {
      // Within one pixel column, the edge splits the area at its mean x.
      const mid = (x + next) / 2 - leftFloor
      cover[row + leftFloor] += d * (1 - mid)
      cover[row + leftFloor + 1] += d * mid
    } else {
      const s = 1 / (right - left), leftFraction = left - leftFloor
      const first = s * (1 - leftFraction) ** 2 / 2, last = s * (right - rightCeil + 1) ** 2 / 2
      cover[row + leftFloor] += d * first
      if (rightCeil === leftFloor + 2) cover[row + leftFloor + 1] += d * (1 - first - last)
      else {
        const second = s * (1.5 - leftFraction)
        cover[row + leftFloor + 1] += d * (second - first)
        for (let column = leftFloor + 2; column < rightCeil - 1; column++) cover[row + column] += d * s
        cover[row + rightCeil - 1] += d * (1 - second - (rightCeil - leftFloor - 3) * s - last)
      }
      cover[row + rightCeil] += d * last
    }
    x = next
  }
}

/** Fills `cover` with the outline of one line of text, curves flattened to straight edges. */
function drawLine(cover: Float32Array, width: number, font: Font, text: string, x0: number, baseline: number, size: number) {
  let x = 0, y = 0, startX = 0, startY = 0
  const lineTo = (toX: number, toY: number) => {
    edge(cover, width, x, y, toX, toY)
    x = toX
    y = toY
  }
  for (const command of font.getPath(text, x0, baseline, size).commands) {
    if (command.type === 'M') {
      lineTo(startX, startY)
      x = startX = command.x
      y = startY = command.y
    } else if (command.type === 'L') lineTo(command.x, command.y)
    else if (command.type === 'Z') lineTo(startX, startY)
    else {
      // Quadratic curves become cubic ones with the same shape.
      const [x1, y1, x2, y2] = command.type === 'C' ? [command.x1, command.y1, command.x2, command.y2]
        : [x + 2 / 3 * (command.x1 - x), y + 2 / 3 * (command.y1 - y), command.x + 2 / 3 * (command.x1 - command.x), command.y + 2 / 3 * (command.y1 - command.y)]
      // Enough segments to keep the flattening error near a twentieth of a pixel.
      const bend = Math.max(Math.hypot(x - 2 * x1 + x2, y - 2 * y1 + y2), Math.hypot(x1 - 2 * x2 + command.x, y1 - 2 * y2 + command.y))
      const segments = Math.max(1, Math.ceil(Math.sqrt(bend * 8)))
      const fromX = x, fromY = y
      for (let step = 1; step <= segments; step++) {
        const t = step / segments, u = 1 - t
        lineTo(u ** 3 * fromX + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t ** 3 * command.x,
          u ** 3 * fromY + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3 * command.y)
      }
    }
  }
  lineTo(startX, startY)
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value
})

/** Length, type, data, and the CRC-32 of type and data. */
function pngChunk(type: string, data: Uint8Array) {
  const chunk = new Uint8Array(data.length + 12), view = new DataView(chunk.buffer)
  view.setUint32(0, data.length)
  chunk.set([...type].map(char => char.charCodeAt(0)), 4)
  chunk.set(data, 8)
  let crc = ~0
  for (const byte of chunk.subarray(4, data.length + 8)) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  view.setUint32(data.length + 8, ~crc)
  return chunk
}

/**
 * Draws prompts as dark text on a light page, rasterized here so that the CLI and the website need no image library.
 * Size, margins, line spacing, and both shades change with every image, so no two images share bytes or dimensions.
 * Sixteen coverage levels keep the text smooth and the grayscale PNG well inside the 128 KiB limit of the site proxy.
 */
export function promptRenderer(fontBytes: ArrayBuffer): PromptRenderer {
  const font = parse(fontBytes)
  return async prompt => {
    const missing = [...new Set(prompt)].filter(char => /\S/.test(char) && !font.charToGlyphIndex(char))
    if (missing.length) {
      throw new Error(`Image mode cannot draw ${missing.slice(0, 8).join(' ')}. Its font covers the characters of the built-in challenges only.`)
    }
    const size = between(22, 28), lineHeight = size * between(1.35, 1.65)
    const width = Math.round(between(720, 1080)), marginX = between(20, 48), marginY = between(20, 48)
    const ink = between(0, 64), paper = between(232, 256)
    // The CJK font draws ’ a full em wide, which splits French words such as d’entiers.
    const lines = wrap(font, prompt.trim().replaceAll('’', "'"), size, width - 2 * marginX)
    const height = Math.round(2 * marginY + lines.length * lineHeight)
    const ascent = font.ascender / font.unitsPerEm * size, descent = -font.descender / font.unitsPerEm * size
    // The edge beyond the last pixel of a row lands on the next row, where the running sum expects it.
    const cover = new Float32Array(width * height + 2)
    lines.forEach((line, index) => drawLine(cover, width, font, line, marginX,
      marginY + index * lineHeight + (lineHeight - ascent - descent) / 2 + ascent, size))
    // Each scanline starts with filter type 0, then one gray byte per pixel.
    const rows = new Uint8Array((width + 1) * height)
    let sum = 0
    for (let pixel = 0; pixel < width * height; pixel++) {
      sum += cover[pixel]
      rows[pixel + Math.floor(pixel / width) + 1] = paper + (ink - paper) * Math.round(Math.min(1, Math.abs(sum)) * 15) / 15
    }
    const header = new Uint8Array(13), view = new DataView(header.buffer)
    view.setUint32(0, width)
    view.setUint32(4, height)
    header[8] = 8
    const compressed = await new Response(new Blob([rows]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer()
    let binary = ''
    for (const part of [
      Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), pngChunk('IHDR', header),
      pngChunk('IDAT', new Uint8Array(compressed)), pngChunk('IEND', new Uint8Array()),
    ]) for (let offset = 0; offset < part.length; offset += 0x8000) binary += String.fromCharCode(...part.subarray(offset, offset + 0x8000))
    return { png: btoa(binary), text: INSTRUCTIONS[Math.floor(Math.random() * INSTRUCTIONS.length)] }
  }
}
