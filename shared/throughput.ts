/** Streaming speed of the visible reply. */
export interface Throughput {
  /** Request start to the first visible text. Includes queueing, network latency and any reasoning. */
  ttftMs: number
  /** Output tokens per second during decoding. Absent when the stream is too short or arrived in bursts. */
  tokensPerSecond?: number
  /** The token count is a text estimate because the provider reported no usable usage. */
  estimated?: boolean
}
export type ThroughputMeter = ReturnType<typeof throughputMeter>

// Below these limits a proxy most likely buffered the reply, and the rate would measure network speed.
const MIN_WINDOW_MS = 250
const MIN_EVENTS = 4
const MIN_TOKENS = 16
// Real tokenizers count number lists at 0.67x (Claude) to 1.57x (per-digit Qwen/Gemini) of the estimate.
// A ratio outside this range means the usage also counts hidden reasoning.
const USAGE_RATIO = [0.5, 2]
/** How long to keep reading after the number cap so that the usage report can still arrive. */
export const USAGE_GRACE_MS = 1500

/** Reads the next stream chunk, or resolves undefined when the deadline passes first. */
export async function readBefore<T>(reader: ReadableStreamDefaultReader<T>, deadline: number) {
  if (deadline === Infinity) return reader.read()
  let clear = () => {}
  const expired = new Promise<undefined>(resolve => {
    const timer = setTimeout(resolve, Math.max(0, deadline - performance.now()))
    clear = () => clearTimeout(timer)
  })
  try { return await Promise.race([reader.read(), expired]) } finally { clear() }
}

/**
 * Approximates BPE token counts without a tokenizer. It follows o200k/cl100k pre-tokenization:
 * digit runs split into groups of three, each punctuation or whitespace run is one token,
 * and words average about four characters per token. Number lists match o200k exactly.
 */
export function estimateTokens(text: string) {
  let tokens = 0
  for (const [part] of text.matchAll(/ ?\p{L}+|\p{N}+|\s+|[^\s\p{L}\p{N}]+/gu)) {
    tokens += /\p{N}/u.test(part) ? Math.ceil(part.length / 3) : /\p{L}/u.test(part) ? Math.ceil(part.length / 4) : 1
  }
  return tokens
}

/** Reads output and reasoning token counts from Chat Completions, Responses or Messages usage. */
export function outputUsage(value: unknown): { output: number; reasoning?: number } | undefined {
  const usage = value && typeof value === 'object' ? value as Record<string, any> : {}
  const output = usage.completion_tokens ?? usage.output_tokens
  if (typeof output !== 'number' || output <= 0) return undefined
  const details = usage.completion_tokens_details ?? usage.output_tokens_details
  const reasoning = details?.reasoning_tokens ?? details?.thinking_tokens
  return { output, reasoning: typeof reasoning === 'number' ? reasoning : undefined }
}

/**
 * Measures a streamed reply. Only growth of the raw visible text is timed, so empty keep-alive
 * chunks never count and reasoning time stays inside TTFT. The decode window runs from the first
 * to the last text event and excludes the first event's tokens, which were generated during TTFT.
 *
 * Token counts prefer provider usage, which uses the model's real tokenizer:
 * - usage with a reasoning breakdown gives the exact visible count;
 * - usage without a breakdown after streamed reasoning covers reasoning and text, so the window
 *   starts at the first reasoning event instead;
 * - usage without a breakdown and no visible reasoning is trusted only within USAGE_RATIO.
 * Usage below USAGE_RATIO is partial (the stream ended before the final report) and is ignored.
 * The estimate splits usage between the first event and the window, and replaces it when absent.
 */
export function throughputMeter(startedAt = performance.now()) {
  let text = '', events = 0, reasoningAt: number | undefined, firstAt = 0, firstLength = 0, lastAt = 0
  return {
    reasoning() { reasoningAt ??= performance.now() },
    /** Records the cumulative raw text, including text after a number cap. */
    update(value: string) {
      if (value.length <= text.length) return
      const now = performance.now()
      if (!events) { firstAt = now; firstLength = value.length }
      text = value; lastAt = now; events++
    },
    result(usage?: unknown): Throughput | undefined {
      if (!events) return undefined
      const ttftMs = firstAt - startedAt
      const total = estimateTokens(text), share = (total - estimateTokens(text.slice(0, firstLength))) / total
      const reported = outputUsage(usage), covers = (count: number) => count >= USAGE_RATIO[0] * total
      const plausible = (count: number) => covers(count) && count <= USAGE_RATIO[1] * total
      let tokens = total * share, windowMs = lastAt - firstAt, estimated = true
      if (reported?.reasoning !== undefined) {
        const visible = reported.output - reported.reasoning
        if (plausible(visible)) { tokens = visible * share; estimated = false }
      } else if (reported && reasoningAt !== undefined && reasoningAt < firstAt) {
        if (covers(reported.output)) { tokens = reported.output; windowMs = lastAt - reasoningAt; estimated = false }
      } else if (reported && plausible(reported.output)) {
        tokens = reported.output * share; estimated = false
      }
      if (events < MIN_EVENTS || windowMs < MIN_WINDOW_MS || tokens < MIN_TOKENS) return { ttftMs }
      return { ttftMs, tokensPerSecond: tokens * 1000 / windowMs, ...(estimated ? { estimated } : {}) }
    },
  }
}
