import { decompress } from 'fzstd'

/** `bytes` is the compressed size of all parts together. */
type Manifest = Record<string, { parts: string[]; bytes: number }>
export type DownloadProgress = (loaded: number, total: number) => void

let manifestLoading: Promise<Manifest> | undefined

async function readResponse(url: string): Promise<Response> {
  const response = await fetch(url)
  if (!response.ok) throw new Error('静态参考数据加载失败，请刷新页面后重试。')
  return response
}

function concat(pieces: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(pieces.reduce((sum, piece) => sum + piece.length, 0))
  let offset = 0
  for (const piece of pieces) {
    out.set(piece, offset)
    offset += piece.length
  }
  return out
}

/** Reads a part as it streams in, so that the caller can count the bytes received. */
async function readPart(url: string, onBytes: (count: number) => void): Promise<Uint8Array> {
  const reader = (await readResponse(url)).body!.getReader()
  const pieces: Uint8Array[] = []
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    pieces.push(read.value)
    onBytes(read.value.length)
  }
  return concat(pieces)
}

/** Downloads and decompresses one published file; `onProgress` receives compressed bytes. */
export async function readStaticBytes(name: string, onProgress?: DownloadProgress): Promise<Uint8Array> {
  const base = `${import.meta.env.BASE_URL}data/`
  const manifest = await (manifestLoading ??= readResponse(`${base}manifest.json`)
    .then(response => response.json() as Promise<Manifest>)
    .catch(error => { manifestLoading = undefined; throw error }))
  const entry = manifest[name]
  if (!entry?.parts.length) throw new Error('静态参考数据清单不完整，请刷新页面后重试。')

  let loaded = 0
  onProgress?.(0, entry.bytes)
  const parts = await Promise.all(entry.parts.map(part => readPart(`${base}chunks/${part}`, count => {
    loaded += count
    onProgress?.(loaded, entry.bytes)
  })))
  return decompress(concat(parts))
}

export async function readStaticData(name: string): Promise<string> {
  return new TextDecoder().decode(await readStaticBytes(name))
}
