#!/usr/bin/env node
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig } from '../src/config.js';
import { describeSttProviders } from '../src/adapters/stt/index.js';
import { describeTtsProviders } from '../src/adapters/tts/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

function arg(name, fallback = '') {
  const prefix = `--${name}=`;
  const found = process.argv.find((item) => item.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function defaultAudioPath() {
  return resolve(
    PROJECT_ROOT,
    'models',
    'sherpa-onnx-streaming-zipformer-en-20M-2023-02-17',
    'test_wavs',
    '0.wav',
  );
}

function stacks() {
  return [
    {
      id: 'runtime-baseline',
      command: 'npm run experiment:matrix -- --mock-agent --stacks=runtime-baseline',
      requires: [],
    },
    {
      id: 'local-piper-tts',
      command: 'PIPER_HTTP_ENDPOINT=http://127.0.0.1:8092 npm run experiment:matrix -- --mock-agent --stacks=local-piper-tts',
      requires: ['piperHttp'],
    },
    {
      id: 'local-sherpa-stt',
      command: 'npm run experiment:matrix -- --mock-agent --stacks=local-sherpa-stt --audio=<audio.wav>',
      requires: ['audio', 'sherpaStt'],
    },
    {
      id: 'local-sherpa-piper',
      command: 'PIPER_HTTP_ENDPOINT=http://127.0.0.1:8092 npm run experiment:matrix -- --mock-agent --stacks=local-sherpa-piper --audio=<audio.wav>',
      requires: ['audio', 'sherpaStt', 'piperHttp'],
    },
    {
      id: 'deepgram-stt-only',
      command: 'DEEPGRAM_API_KEY=... npm run experiment:matrix -- --mock-agent --stacks=deepgram-stt-only --audio=<audio.wav>',
      requires: ['audio', 'deepgram'],
    },
    {
      id: 'deepgram-piper',
      command: 'DEEPGRAM_API_KEY=... PIPER_HTTP_ENDPOINT=http://127.0.0.1:8092 npm run experiment:matrix -- --mock-agent --stacks=deepgram-piper --audio=<audio.wav>',
      requires: ['audio', 'deepgram', 'piperHttp'],
    },
    {
      id: 'deepgram-tts-only',
      command: 'DEEPGRAM_API_KEY=... npm run experiment:matrix -- --mock-agent --stacks=deepgram-tts-only',
      requires: ['deepgram'],
    },
    {
      id: 'deepgram-full',
      command: 'DEEPGRAM_API_KEY=... npm run experiment:matrix -- --mock-agent --stacks=deepgram-full --audio=<audio.wav>',
      requires: ['audio', 'deepgram'],
    },
  ];
}

async function probeJson(url, timeoutMs = 2000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const body = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      body: body.slice(0, 300),
    };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    clearTimeout(timeout);
  }
}

async function probePiper(endpoint, timeoutMs = 3000) {
  if (!endpoint) return { ok: false, error: 'PIPER_HTTP_ENDPOINT not configured' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'audio/wav' },
      body: JSON.stringify({ text: 'Talkbox provider check.' }),
      signal: controller.signal,
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    const looksLikeWav = buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WAVE';
    return {
      ok: response.ok && looksLikeWav,
      status: response.status,
      bytes: buffer.length,
      contentType: response.headers.get('content-type') || '',
      looksLikeWav,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    clearTimeout(timeout);
  }
}

function requirementStatus(req, facts) {
  switch (req) {
    case 'audio':
      return facts.audio.exists ? null : `Audio file missing: ${facts.audio.path}`;
    case 'deepgram':
      return facts.deepgram.configured ? null : 'DEEPGRAM_API_KEY not configured';
    case 'sherpaStt':
      return facts.sherpa.sttConfigured ? null : 'Sherpa STT model not installed/configured';
    case 'piperHttp':
      return facts.piper.ok ? null : `Piper HTTP unavailable: ${facts.piper.error || facts.piper.status || 'not ok'}`;
    default:
      return `Unknown requirement: ${req}`;
  }
}

function markdown(report) {
  const agentLabel = report.active.agentName || 'Agent';
  const lines = [
    '# Talkbox Provider Doctor',
    '',
    `Generated: ${report.createdAt}`,
    '',
    '## Dependencies',
    '',
    `- ${agentLabel}: ${report.agent.ok ? 'ok' : `not ready (${report.agent.error || report.agent.status || 'unknown'})`}`,
    `- Deepgram: ${report.deepgram.configured ? 'configured' : 'missing DEEPGRAM_API_KEY'}`,
    `- Sherpa STT: ${report.sherpa.sttConfigured ? 'configured' : 'not configured'}`,
    `- Piper HTTP: ${report.piper.ok ? 'ok' : `not ready (${report.piper.error || report.piper.status || 'unknown'})`}`,
    `- Audio sample: ${report.audio.exists ? report.audio.path : `missing (${report.audio.path})`}`,
    '',
    '## Provider Availability',
    '',
    '| Kind | Provider | Available | Note |',
    '|---|---|---:|---|',
  ];

  for (const provider of report.providers.stt) {
    lines.push(`| STT | ${provider.name} | ${provider.available ? 'yes' : 'no'} | ${provider.note} |`);
  }
  for (const provider of report.providers.tts) {
    lines.push(`| TTS | ${provider.name} | ${provider.available ? 'yes' : 'no'} | ${provider.note} |`);
  }

  lines.push(
    '',
    '## Stack Readiness',
    '',
    '| Stack | Ready | Missing | Command |',
    '|---|---:|---|---|',
  );

  for (const stack of report.stacks) {
    lines.push(`| ${stack.id} | ${stack.ready ? 'yes' : 'no'} | ${stack.missing.join('<br>')} | \`${stack.command}\` |`);
  }

  lines.push(
    '',
    '## Recommendation',
    '',
    report.recommendation,
    '',
  );

  return `${lines.join('\n')}\n`;
}

async function main() {
  const config = getConfig();
  const audioPath = resolve(arg('audio', defaultAudioPath()));
  const outputPath = arg('output', resolve(PROJECT_ROOT, 'benchmarks', 'provider-doctor.json'));
  const markdownPath = arg('markdown', resolve(PROJECT_ROOT, 'benchmarks', 'provider-doctor.md'));
  const shouldProbe = !hasFlag('no-probe');

  const agentHealthUrl = config.agentAdapter === 'cal'
    ? `${config.agentEndpoint}/health`
    : new URL('/health', config.agentEndpoint).toString();
  const agent = shouldProbe
    ? await probeJson(agentHealthUrl)
    : { ok: true, skipped: true };
  const piper = shouldProbe && config.piperHttpEndpoint
    ? await probePiper(config.piperHttpEndpoint)
    : { ok: false, error: config.piperHttpEndpoint ? 'probe skipped' : 'PIPER_HTTP_ENDPOINT not configured' };

  const facts = {
    createdAt: new Date().toISOString(),
    active: {
      sttProvider: config.sttProvider,
      ttsProvider: config.ttsProvider,
      agentAdapter: config.agentAdapter,
      agentName: config.agentName,
      agentEndpoint: config.agentEndpoint,
      piperHttpEndpoint: config.piperHttpEndpoint || null,
    },
    agent,
    deepgram: {
      configured: !!config.deepgramApiKey,
      sttModel: config.deepgramSttModel,
      ttsModel: config.deepgramTtsModel,
    },
    sherpa: {
      sttConfigured: !!config.sherpaSttConfigJson,
      ttsConfigured: !!config.sherpaTtsConfigJson,
      ttsUnsafeEnabled: config.sherpaTtsEnableUnsafe,
    },
    piper,
    audio: {
      path: audioPath,
      exists: existsSync(audioPath),
    },
    providers: {
      stt: describeSttProviders(config),
      tts: describeTtsProviders(config),
    },
  };

  facts.stacks = stacks().map((stack) => {
    const missing = stack.requires
      .map((req) => requirementStatus(req, facts))
      .filter(Boolean);
    return {
      ...stack,
      ready: missing.length === 0,
      missing,
    };
  });

  const readyIds = facts.stacks.filter((stack) => stack.ready).map((stack) => stack.id);
  if (facts.deepgram.configured) {
    facts.recommendation = 'Deepgram is configured. Run `deepgram-stt-only` and `deepgram-piper` first, then optionally run `deepgram-tts-only` and `deepgram-full` for TTS comparison.';
  } else if (readyIds.includes('local-sherpa-piper')) {
    facts.recommendation = 'Local Sherpa+Piper is runnable now. Use it for offline testing, but Deepgram remains the missing cloud comparison.';
  } else if (readyIds.includes('local-piper-tts')) {
    facts.recommendation = 'Piper TTS is runnable now. Start with TTS/naturalness review, then configure audio/Sherpa or Deepgram for STT comparison.';
  } else {
    facts.recommendation = 'Only the baseline is runnable. Start Piper with `npm run piper:start` and configure `PIPER_HTTP_ENDPOINT=http://127.0.0.1:8092`, or add `DEEPGRAM_API_KEY` for the cloud path.';
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await mkdir(dirname(markdownPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(facts, null, 2));
  await writeFile(markdownPath, markdown(facts));

  console.log(`wrote ${outputPath}`);
  console.log(`wrote ${markdownPath}`);
  for (const stack of facts.stacks) {
    console.log(`${stack.ready ? 'ready' : 'blocked'} stack=${stack.id}${stack.missing.length ? ` missing="${stack.missing.join('; ')}"` : ''}`);
  }
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
