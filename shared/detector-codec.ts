import type { SharedDetector } from './shared-detector'

/**
 * Reads `data/shared_detector.bin`, the one detector file shared by the CLI, the website and the evaluation scripts.
 * `encodeDetector` writes it. Layout: u32 header length (little-endian), UTF-8 JSON header,
 * zero padding to 4 bytes, then float32 values. In the header every array of numbers is `{"$f32":offset,"n":length}`;
 * scalars keep full precision. The float bytes are grouped by position (all first bytes, then all second bytes, ...),
 * which zstd compresses much better than interleaved floats; each float is little-endian.
 */
export function encodeDetector(artifact: SharedDetector): Uint8Array {
  const values: number[] = []
  const header = new TextEncoder().encode(JSON.stringify(artifact, (_, value) => {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Detector parameters must be finite.')
    if (Array.isArray(value) && value.length && value.every(item => typeof item === 'number')) {
      const offset = values.length
      for (const item of value) {
        if (!Number.isFinite(Math.fround(item))) throw new Error('Detector parameters do not fit in float32.')
        values.push(item)
      }
      return { $f32: offset, n: value.length }
    }
    return value
  }))
  const start = Math.ceil((4 + header.length) / 4) * 4
  const output = new Uint8Array(start + values.length * 4), view = new DataView(output.buffer)
  view.setUint32(0, header.length, true)
  output.set(header, 4)
  const float = new DataView(new ArrayBuffer(4))
  values.forEach((value, i) => {
    float.setFloat32(0, value, true)
    for (let byte = 0; byte < 4; byte++) output[start + byte * values.length + i] = float.getUint8(byte)
  })
  return output
}

export function decodeDetector(data: Uint8Array): SharedDetector {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const headerLength = view.getUint32(0, true), start = Math.ceil((4 + headerLength) / 4) * 4
  const count = (data.length - start) / 4
  const raw = new Uint8Array(count * 4)
  for (let i = 0; i < count; i++) for (let b = 0; b < 4; b++) raw[i * 4 + b] = data[start + b * count + i]
  const little = new DataView(raw.buffer), floats = new Float32Array(count)
  for (let i = 0; i < count; i++) floats[i] = little.getFloat32(i * 4, true)
  return JSON.parse(new TextDecoder().decode(data.subarray(4, 4 + headerLength)), (_, value) =>
    value && typeof value === 'object' && '$f32' in value ? Array.from(floats.subarray(value.$f32, value.$f32 + value.n)) : value)
}
