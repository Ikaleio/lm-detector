import { Box, Text, render, useWindowSize } from 'ink'
import terminalLink from 'terminal-link'
import { TOKENIZER_MODEL } from '@fingerpoint/shared/tokenizer-posterior'
import { PROBE_OUTPUT_TOKENS, PROBE_TIMEOUT_MS } from '@fingerpoint/shared/tokenizer-probe'

const sections = [
  { title: 'CONNECTION', options: [
    ['-b, --baseurl URL', 'Base URL or complete endpoint. Env: BASE_URL.'],
    ['-m, --model MODEL', 'Model to request. Env: MODEL.'],
    ['-k, --apikey KEY', 'API key. Env: API_KEY. Flags override environment variables.'],
    ['-a, --api TYPE', 'responses (default), chatcompletion, or message; any prefix or cc.'],
    ['-e, --effort LEVEL', 'Omitted by default. none/minimal/low/medium/high/xhigh/max, or any provider value. Tokenizer probes omit it for Messages.'],
    ['-t, --service-tier TIER', 'flex, default, fast, or ultrafast. Default sends nothing. Aliases: slow (flex), f (fast), uf (ultrafast). Messages sends speed; other APIs send service_tier.'],
    ['-ns, --no-stream', 'Use JSON instead of SSE. SSE is enabled by default.'],
  ] },
  { title: 'DETECTION (fpd / fpd detect)', options: [
    ['--count NUMBER', 'Samples per round: 1–3. Default: 3. One or two samples rank without confidence.'],
    ['-p, --parallel NUMBER', 'Concurrent samples within each round: 1–3. Default: 3, capped at --count.'],
    ['-n, --repeat NUMBER', 'Sequential detection rounds. Default: 1.'],
    ['-s, --strict', 'Disable automatic truncation. Require --count 3 and all three complete, valid responses.'],
    ['--challenges FILE', 'Reuse saved challenges for every round. Array length must match --count.'],
    ['--bank FILE', 'Use a custom reference bank.'],
    ['--timeout SECONDS', 'Sample deadline: 120 by default. First byte for SSE, with no deadline after SSE starts; the entire response for JSON. An added tokenizer probe keeps its own 90-second deadline.'],
    ['--image', 'Image mode: send each prompt as a PNG with a generic instruction, so relays cannot route by prompt keywords. Off by default. Needs image input; the reference bank was sampled with text prompts.'],
    ['--tokenizer', 'Also run the tokenizer probe beside the first round. Off by default. The ranking is unchanged. Uses --max-probes and --tokenizer-bank below.'],
    ['--no-update-check', 'Disable background update checks. Env: FPD_NO_UPDATE_CHECK=1. Applies to detection.'],
  ] },
  { title: 'TOKENIZER (fpd tokenizer)', options: [
    ['-p, --parallel NUMBER', 'Concurrent probe requests: 1–4. Default: 4. Sets the actual probe concurrency.'],
    ['--timeout SECONDS', `Deadline for each complete probe request, including SSE. Default: ${PROBE_TIMEOUT_MS / 1000}.`],
    ['--max-probes NUMBER', `Probe text limit: ${TOKENIZER_MODEL.minimumProbes}–60. Default: ${TOKENIZER_MODEL.maximumProbes}. Stops at the limit even below ${TOKENIZER_MODEL.stopAt * 100}% confidence. Two baseline requests are extra. Also works with detect --tokenizer. Cannot be combined with --input.`],
    ['--tokenizer-bank FILE', 'Use a custom tokenizer bank for standalone probing, detect --tokenizer, or offline replay.'],
  ] },
  { title: 'OUTPUT', options: [
    ['--input FILE', 'Analyze saved outputs with detect, or saved tokenizer counts with tokenizer. Tokenizer also accepts detection reports and web exports. No API requests.'],
    ['--output FILE', 'Save detection rounds, samples, and results, or a standalone tokenizer report as JSON. Credentials are excluded.'],
    ['--json', 'Write JSON to stdout instead of the TUI.'],
    ['-h, --help', 'Show this shared detection and tokenizer help.'],
  ] },
] as const

const examples = [
  ['Detect a model with explicit credentials', 'npx lmfpd@latest -b https://api.example.com/v1 \\\n  -k sk-xxx -m gpt-6-astra'],
  ['Repeat five rounds with three concurrent samples per round', 'npx lmfpd@latest -b https://api.example.com/v1 \\\n  -k sk-xxx -m gpt-6-astra -p 3 -n 5'],
  ['Use API_KEY, MODEL, and BASE_URL from your environment', 'npx lmfpd@latest -a chatcompletion -e high'],
  ['Rank with a single API request using environment credentials', 'npx lmfpd@latest --count 1'],
  ['Require complete responses and disable streaming', 'npx lmfpd@latest -s -ns --timeout 180 --output result.json'],
  ['Analyze a saved report without calling a model', 'npx lmfpd@latest --input result.json --json'],
  ['Send the prompts as images instead of text', 'npx lmfpd@latest -a message --image'],
  ['Add the tokenizer probe (about 12 more requests)', 'npx lmfpd@latest -a cc --tokenizer'],
  ['Probe the tokenizer directly and save its counts', 'fpd tokenizer -b https://api.example.com/v1 -k sk-xxx -m gpt-5 -a cc --output tokenizer.json'],
  ['Probe using API_KEY, MODEL, and BASE_URL', 'fpd tokenizer -a cc'],
  ['Recompute saved tokenizer counts without API requests', 'fpd tokenizer --input tokenizer.json --json'],
  ['Check a saved probe against another model name', 'fpd tokenizer --input detection.json -m gpt-5'],
] as const

export function StarNote() {
  return <Text dimColor><Text color="yellow">★</Text> Like FPD? Star it on GitHub: {terminalLink('github.com/Ikaleio/lm-detector', 'https://github.com/Ikaleio/lm-detector', { fallback: false })}</Text>
}

function Help() {
  const { columns } = useWindowSize()
  const width = Math.max(32, Math.min(columns || 80, 100))
  const narrow = width < 65
  return <Box flexDirection="column" width={width} paddingX={1}>
    <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
      <Text><Text bold color="cyan">FPD</Text> / MODEL FINGERPOINT DETECTOR (<Text color="cyan">{terminalLink('lm.ikale.io', 'https://lm.ikale.io', { fallback: false })}</Text>)</Text>
      <Text dimColor>Model fingerprint detection and standalone tokenizer probing.</Text>
    </Box>
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="cyan">USAGE</Text>
      <Text>npx lmfpd@latest -b URL -k KEY -m MODEL [options]</Text>
      <Text>fpd tokenizer -b URL -k KEY -m MODEL [options]</Text>
      <Text>fpd tokenizer --input FILE [--json]</Text>
      <Text dimColor>With npm: npx lmfpd@latest [command] [options]</Text>
      <Text dimColor>With Bun: bunx --bun lmfpd@latest [command] [options]</Text>
      <Text dimColor>Both commands share the connection and output options below.</Text>
      <Text dimColor>Detection defaults: Responses · SSE · relaxed · count 3 · parallel 3 · one round</Text>
      <Text dimColor>Tokenizer defaults: Responses · SSE · parallel 4 · {TOKENIZER_MODEL.maximumProbes} probes + 2 baselines · {PROBE_TIMEOUT_MS / 1000}s per request</Text>
      <Text>fpd sample [options] · collect a portable reference batch</Text>
      <Text>fpd enroll RUN [options] · validate and enroll a batch</Text>
      <Text>fpd retrain --data-dir DIR · fit ranker and confidence offline</Text>
      <Text dimColor>sample, enroll, and retrain have their own --help. tokenizer --help shows this page.</Text>
    </Box>
    {sections.map(section => <Box key={section.title} flexDirection="column" marginTop={1}>
      <Text bold color="cyan">{section.title}</Text>
      {section.options.map(([flag, description]) => <Box key={flag} flexDirection={narrow ? 'column' : 'row'} marginBottom={narrow ? 1 : 0}>
        <Box width={narrow ? undefined : 25} flexShrink={0}><Text bold>{flag}</Text></Box>
        <Box flexGrow={1} flexBasis={narrow ? undefined : 0} paddingLeft={narrow ? 2 : 0}><Text>{description}</Text></Box>
      </Box>)}
    </Box>)}
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="cyan">HOW ROUNDS WORK</Text>
      <Text>Relaxed mode caps each sample at its requested number count. One or two valid samples can produce a ranking without confidence scores.</Text>
      <Text>Each round waits for all requested samples to settle before the next round starts. No automatic retries. Detection never enrolls samples.</Text>
      <Text>With --tokenizer, FPD also sends short requests beside the first round. It reads the input token count from each usage report, identifies the upstream tokenizer, and checks it against --model. APIs that bill per request bill these requests.</Text>
      <Text>The tokenizer result is reference only. The ranking never uses it and never waits for it. Many models share one tokenizer, so a match does not identify the model.</Text>
      <Text>If the rounds finish first, FPD waits for the probe before it exits. q or Ctrl+C then stops the probe and keeps the round results.</Text>
      <Text dimColor>Use q or Ctrl+C to cancel. --base-url and --api-key are also accepted.</Text>
    </Box>
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="cyan">HOW TOKENIZER PROBING WORKS</Text>
      <Text>fpd tokenizer probes input token counts directly, without number samples or a --tokenizer flag. It shows the tokenizer class, model-name check, candidate probabilities, and request counts.</Text>
      <Text>Usually about 12 short requests, at most --max-probes + 2 ({TOKENIZER_MODEL.maximumProbes + 2} by default). Two baselines check hidden-input stability. Per-request billing applies. Messages limits output to {PROBE_OUTPUT_TOKENS} tokens; the other protocols set no output limit.</Text>
      <Text>Standalone probing accepts --parallel 1–4. For detect --tokenizer, the probe runs four requests at a time when detection --parallel is above 1, otherwise one.</Text>
      <Text>Many models share a tokenizer. A match identifies the counting method. --input recomputes saved counts, and -m or MODEL overrides the saved model name.</Text>
      <Text>q or Ctrl+C stops the probe and keeps received counts in --output. Detection-only flags --count, --repeat, --strict, --challenges, --bank, --tokenizer, and --no-update-check do not apply to fpd tokenizer.</Text>
      <Text dimColor>Tokenizer exit codes: 0 with a verdict and no request failure; 1 for invalid input, a failed request, or no verdict; 130 on cancellation; 143 on SIGTERM. A model-name mismatch is a result, not an error.</Text>
    </Box>
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="cyan">EXAMPLES</Text>
      {examples.map(([label, command]) => <Box key={label} flexDirection="column" marginTop={1}>
        <Text dimColor>{label}</Text>
        <Text color="green">{command}</Text>
      </Box>)}
    </Box>
    <Box marginTop={1}><Text dimColor>API examples without -b, -k, and -m require BASE_URL, API_KEY, and MODEL.</Text></Box>
    <Box marginTop={1}><StarNote /></Box>
  </Box>
}

export async function printHelp() {
  const view = render(<Help />, { interactive: false, patchConsole: false })
  await view.waitUntilRenderFlush()
  view.unmount()
}
