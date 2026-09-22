import { Box, Text, render, useWindowSize } from 'ink'
import terminalLink from 'terminal-link'

const sections = [
  { title: 'CONNECTION', options: [
    ['-b, --baseurl URL', 'Base URL or complete endpoint. Env: BASE_URL.'],
    ['-m, --model MODEL', 'Model to request. Env: MODEL.'],
    ['-k, --apikey KEY', 'API key. Env: API_KEY. Flags override environment variables.'],
    ['-a, --api TYPE', 'responses (default), chatcompletion, or message.'],
    ['-e, --effort LEVEL', 'Omitted by default. none/minimal/low/medium/high/xhigh/max, or any provider value.'],
    ['-ns, --no-stream', 'Use JSON instead of SSE. SSE is enabled by default.'],
    ['--timeout SECONDS', 'First SSE byte deadline. Default: 120. No deadline after SSE starts; JSON must finish within this time.'],
  ] },
  { title: 'DETECTION', options: [
    ['-p, --parallel NUMBER', 'Concurrent samples within each round: 1–3. Default: 3.'],
    ['-n, --repeat NUMBER', 'Sequential detection rounds. Default: 1.'],
    ['-s, --strict', 'Disable automatic truncation. Require all three complete, valid responses.'],
    ['--challenges FILE', 'Reuse three saved challenges for every round.'],
    ['--bank FILE', 'Use a custom reference bank.'],
  ] },
  { title: 'OUTPUT', options: [
    ['--input FILE', 'Analyze saved outputs offline. No API requests.'],
    ['--output FILE', 'Save all rounds, samples, and results as JSON. Credentials are excluded.'],
    ['--json', 'Write JSON to stdout instead of the TUI.'],
    ['--no-update-check', 'Disable background update checks. Env: FPD_NO_UPDATE_CHECK=1.'],
    ['-h, --help', 'Show this help.'],
  ] },
] as const

const examples = [
  ['Detect a model with explicit credentials', 'bunx lmfpd@latest -b https://api.example.com/v1 \\\n  -k sk-xxx -m gpt-6-astra'],
  ['Repeat five rounds with three concurrent samples per round', 'bunx lmfpd@latest -b https://api.example.com/v1 \\\n  -k sk-xxx -m gpt-6-astra -p 3 -n 5'],
  ['Use API_KEY, MODEL, and BASE_URL from your environment', 'bunx lmfpd@latest -a chatcompletion -e high'],
  ['Require complete responses and disable streaming', 'bunx lmfpd@latest -s -ns --timeout 180 --output result.json'],
  ['Analyze a saved report without calling a model', 'bunx lmfpd@latest --input result.json --json'],
] as const

function Help() {
  const { columns } = useWindowSize()
  const width = Math.max(32, Math.min(columns || 80, 100))
  const narrow = width < 65
  return <Box flexDirection="column" width={width} paddingX={1}>
    <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
      <Text><Text bold color="cyan">FPD</Text> / MODEL FINGERPOINT DETECTOR (<Text color="cyan">{terminalLink('lm.ikale.io', 'https://lm.ikale.io', { fallback: false })}</Text>)</Text>
      <Text dimColor>Three samples per round. Live progress. Ranked candidates.</Text>
    </Box>
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="cyan">USAGE</Text>
      <Text>bunx lmfpd@latest -b URL -k KEY -m MODEL [options]</Text>
      <Text dimColor>Defaults: Responses · SSE · relaxed · parallel 3 · one round</Text>
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
      <Text>Each round waits for all three samples to settle before the next round starts. No automatic retries. Detection never enrolls samples.</Text>
      <Text dimColor>Use q or Ctrl+C to cancel. --base-url and --api-key are also accepted.</Text>
    </Box>
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="cyan">EXAMPLES</Text>
      {examples.map(([label, command]) => <Box key={label} flexDirection="column" marginTop={1}>
        <Text dimColor>{label}</Text>
        <Text color="green">{command}</Text>
      </Box>)}
    </Box>
    <Box marginTop={1}><Text dimColor>API examples without -b, -k, and -m require BASE_URL, API_KEY, and MODEL.</Text></Box>
  </Box>
}

export async function printHelp() {
  const view = render(<Help />, { interactive: false, patchConsole: false })
  await view.waitUntilRenderFlush()
  view.unmount()
}
