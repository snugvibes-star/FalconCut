/**
 * Generates the public, no-account tool manifest: /tools.json and /llms.txt.
 * Bundles the real TS registry with esbuild and runs it in Node, so the
 * published manifest can never drift from the tools the app actually ships.
 *   node scripts/gen-manifest.mjs
 */
import { build } from 'esbuild';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'public');

const entry = `
export { toolManifest, toolsPromptText, TOOLS } from './tools/registry.ts';
export { AGENT_SYSTEM_PROMPT } from './ai/protocol.ts';
`;

const bundled = await build({
  stdin: { contents: entry, resolveDir: root, loader: 'ts' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  write: false,
  logLevel: 'warning',
});

const tmp = path.join(tmpdir(), `falconcut-manifest-${Date.now()}.mjs`);
await writeFile(tmp, bundled.outputFiles[0].text, 'utf8');
const mod = await import(pathToFileURL(tmp).href);
await rm(tmp, { force: true });

const { toolManifest, toolsPromptText, TOOLS, AGENT_SYSTEM_PROMPT } = mod;
const tools = toolManifest();

const manifest = {
  name: 'falconcut',
  version: '1.0.0',
  description: 'A modern video editor built for human creators and AI agents. Create, edit, automate, and export videos with a powerful professional editing workflow.',
  privacy: 'Everything runs in the browser. Your videos never leave this device. No account, no upload.',
  access: {
    inPage: {
      where: 'window.falconcut',
      methods: ['listTools()', 'getProject()', 'getAnalysis()', 'getStoryboard()', 'getLint()', 'runTool(name, params)', 'applyTool(name, params)', 'applyActions(actions, label)', 'undo()', 'redo()', 'onChange(cb)'],
      note: 'Same-page agents only. Scoped to the project open in this tab; cannot reach other projects or files.',
    },
    relay: {
      where: 'Connect an agent → one-time session link + QR',
      note: 'A session token grants access to the current project only, expires when the tab closes, and is revocable with one click.',
    },
    mcp: { where: 'node server/falconcut-mcp.mjs', note: 'MCP stdio bridge that forwards to the relay.' },
  },
  protocol: {
    reply: 'Respond with ONLY a JSON object: {"thought": string, "say": string, "calls": [{"tool": string, "params": object, "why": string}]}',
    preview: 'runTool returns {actions, summary, stats?, warnings?} and changes nothing. applyTool commits as ONE undo step.',
    plan: 'Plan 3-8 tool calls. The human reviews the plan, then it runs step-by-step with a quality check after each run.',
    noKey: 'With no AI key, every tool still works from buttons, including one-click Auto edit (rules only).',
  },
  tools,
};

const llms = `# FalconCut

> A modern video editor built for human creators and AI agents. Create, edit, automate, and export videos with a powerful professional editing workflow. Every manual tool works without a key; connect one and the assistant can plan edits, cut dead air and write captions by calling the tools below. Privacy-first: media never leaves the device.

Everything runs in the browser. Your videos never leave this device. No account, no upload, no install.

## Connect an agent (no account)

- In-page API: \`window.falconcut\` — \`listTools()\`, \`getProject()\`, \`getAnalysis()\`, \`runTool(name, params)\` (preview), \`applyTool(name, params)\` (one undo step). Same-page agents only; scoped to the open project.
- Connect an agent: a one-time session link + QR code bridges an external agent over a local WebSocket relay. The token grants the current project only, expires on tab close, and is revocable with one click.
- MCP: \`node server/falconcut-mcp.mjs\` exposes the same tools over the Model Context Protocol.
- Machine-readable manifest: [/tools.json](/tools.json)

## How to reply

${AGENT_SYSTEM_PROMPT}

## Tools

Each tool is one function call with pro defaults. Preview first (\`runTool\`), then apply (\`applyTool\`) — a whole run is ONE undo step. Params marked \`?\` are optional.

${toolsPromptText()}

## Project format

The whole project is ONE JSON document (tracks, clips, media, analysis, style pack, rules, tacks). See the README for the schema. The same deterministic engine renders preview and export, so a frame at time t is identical in both.

## Honest limits

- Transcription needs a one-time Whisper model download (network) and runs in a web worker; it is optional.
- Face tracking uses the FaceDetector API where available, otherwise a skin-tone heuristic.
- Export uses WebCodecs where available, with a MediaRecorder fallback.
- Co-editing locks protect clip-scoped edits; time-range ripple cuts are not clip-scoped and are not blocked by a clip lock.
`;

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, 'tools.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
await writeFile(path.join(outDir, 'llms.txt'), llms, 'utf8');
console.log(`Wrote public/tools.json (${tools.length} tools) and public/llms.txt`);