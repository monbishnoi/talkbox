#!/usr/bin/env node
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig } from '../src/config.js';
import { runVoiceTurn } from '../src/runtime/voice-session.js';

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

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

function summarize(results) {
  const totals = results.map((item) => item.timings.totalMs);
  const stageNames = ['stt_finishedMs', 'agent_response_finishedMs', 'voice_render_finishedMs', 'tts_finishedMs'];
  return {
    runs: results.length,
    totalMs: {
      min: Math.min(...totals),
      p50: percentile(totals, 50),
      p95: percentile(totals, 95),
      max: Math.max(...totals),
    },
    stages: Object.fromEntries(stageNames.map((field) => {
      const values = results.map((item) => item.timings[field]).filter(Number.isFinite);
      return [field, values.length ? {
        min: Math.min(...values),
        p50: percentile(values, 50),
        p95: percentile(values, 95),
        max: Math.max(...values),
      } : null];
    })),
  };
}

async function startMockAgent() {
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || '{}');
    const text = body.text || body.message || body?.params?.message?.parts?.[0]?.text || '';
    const responseText = [
      '## Talkbox matrix response',
      '',
      `Agent received: ${text}`,
      '',
      '**Decision:** The backend agent remains the brain. Talkbox manages only conversation mechanics.',
      '',
      '- Control: one clean turn per backend message.',
      '- Latency: every stage is measured.',
      '- Voice: spoken rendering is separate from task truth.',
    ].join('\n');

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      text: responseText,
    }));
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    server,
    endpoint: `http://127.0.0.1:${server.address().port}`,
  };
}

async function loadAudio(audioPath) {
  if (!audioPath) return {};
  const audioBuffer = await readFile(audioPath);
  const audioExtension = audioPath.split('.').pop();
  return {
    audioBase64: audioBuffer.toString('base64'),
    audioExtension,
    audioContentType: audioExtension === 'mp3'
      ? 'audio/mpeg'
      : audioExtension === 'wav'
        ? 'audio/wav'
        : 'application/octet-stream',
  };
}

function defaultStacks() {
  return [
    {
      id: 'runtime-baseline',
      sttProvider: 'transcript',
      ttsProvider: 'silent',
      naturalness: 'No audio. Measures Talkbox and backend-agent control overhead only.',
      control: 'Strongest control baseline: one deterministic transcript, no voice-provider behavior.',
      requires: [],
    },
    {
      id: 'local-piper-tts',
      sttProvider: 'transcript',
      ttsProvider: 'piper-http',
      naturalness: 'Local spoken output. Naturalness needs human listening, but latency is measurable.',
      control: 'Strong: Talkbox owns the text sent to TTS; Piper only speaks bytes.',
      requires: ['piperHttpEndpoint'],
    },
    {
      id: 'local-sherpa-stt',
      sttProvider: 'sherpa',
      ttsProvider: 'silent',
      naturalness: 'No audio output. Measures local transcript latency and transcript quality.',
      control: 'Strong: local STT returns one completed transcript per turn.',
      requires: ['audio', 'sherpaSttConfigJson'],
    },
    {
      id: 'local-sherpa-piper',
      sttProvider: 'sherpa',
      ttsProvider: 'piper-http',
      naturalness: 'Fully local STT+TTS. Needs human listening for fluidness score.',
      control: 'Strong: Talkbox keeps the whole voice loop local and deterministic.',
      requires: ['audio', 'sherpaSttConfigJson', 'piperHttpEndpoint'],
    },
    {
      id: 'deepgram-stt-only',
      sttProvider: 'deepgram',
      ttsProvider: 'silent',
      naturalness: 'No audio output. Measures Deepgram transcript latency and quality.',
      control: 'Strong in REST mode: Talkbox sends one complete audio turn and receives one transcript.',
      requires: ['audio', 'deepgramApiKey'],
    },
    {
      id: 'deepgram-piper',
      sttProvider: 'deepgram',
      ttsProvider: 'piper-http',
      naturalness: 'Cloud STT with local TTS. This is the thin-runtime path that keeps the backend agent as the brain while minimizing local STT quality risk.',
      control: 'Strong: Deepgram only transcribes the completed turn; Talkbox sends one clean message to the backend and Piper only speaks the rendered response.',
      requires: ['audio', 'deepgramApiKey', 'piperHttpEndpoint'],
    },
    {
      id: 'deepgram-tts-only',
      sttProvider: 'transcript',
      ttsProvider: 'deepgram',
      naturalness: 'Cloud TTS. Needs human listening for voice quality and pacing.',
      control: 'Strong: Talkbox controls the spoken text; Deepgram speaks it.',
      requires: ['deepgramApiKey'],
    },
    {
      id: 'deepgram-full',
      sttProvider: 'deepgram',
      ttsProvider: 'deepgram',
      naturalness: 'Cloud STT+TTS. Best candidate for lower-latency provider comparison once keyed.',
      control: 'Strong in REST turn mode; streaming mode would need a separate control review.',
      requires: ['audio', 'deepgramApiKey'],
    },
  ];
}

function missingRequirements(stack, config, audioPath) {
  const missing = [];
  for (const req of stack.requires) {
    if (req === 'audio' && !audioPath) missing.push('audio file required');
    if (req === 'deepgramApiKey' && !config.deepgramApiKey) missing.push('DEEPGRAM_API_KEY not configured');
    if (req === 'sherpaSttConfigJson' && !config.sherpaSttConfigJson) missing.push('Sherpa STT model not installed/configured');
    if (req === 'piperHttpEndpoint' && !config.piperHttpEndpoint) missing.push('PIPER_HTTP_ENDPOINT not configured');
  }
  return missing;
}

function markdownReport(report) {
  const lines = [
    '# Talkbox Provider Matrix',
    '',
    `Generated: ${report.createdAt}`,
    `Mock agent: ${report.mockAgent ? 'yes' : 'no'}`,
    `Runs per stack: ${report.runsPerStack}`,
    '',
    '## Results',
    '',
    '| Stack | STT | TTS | Status | Total p50 | Total p95 | STT p50 | Agent p50 | TTS p50 | Audio | Notes |',
    '|---|---|---|---|---:|---:|---:|---:|---:|---|---|',
  ];

  for (const item of report.stacks) {
    const summary = item.summary;
    const status = item.status === 'ran' ? 'ran' : `skipped: ${item.reason}`;
    const audioLinks = item.audioArtifacts?.length
      ? item.audioArtifacts.map((artifact) => `[run ${artifact.run}](${artifact.path})`).join('<br>')
      : '';
    lines.push([
      item.id,
      item.sttProvider,
      item.ttsProvider,
      status,
      summary?.totalMs?.p50 ?? '',
      summary?.totalMs?.p95 ?? '',
      summary?.stages?.stt_finishedMs?.p50 ?? '',
      summary?.stages?.agent_response_finishedMs?.p50 ?? '',
      summary?.stages?.tts_finishedMs?.p50 ?? '',
      audioLinks,
      item.error ? item.error.replaceAll('|', '/') : item.naturalness,
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }

  lines.push(
    '',
    '## Control And Naturalness Notes',
    '',
  );

  for (const item of report.stacks) {
    lines.push(
      `### ${item.id}`,
      '',
      `- Control: ${item.control}`,
      `- Naturalness: ${item.naturalness}`,
      '',
    );
  }

  lines.push(
    '## Interpretation',
    '',
    '- `runtime-baseline` isolates Talkbox bookkeeping.',
    '- `local-piper-tts` isolates local TTS after backend-agent text exists.',
    '- `local-sherpa-piper` is the current fully local path.',
    '- `deepgram-piper` is a thin cloud/local hybrid: Deepgram hears, Piper speaks, the backend agent thinks.',
    '- `deepgram-full` is the cloud comparison path and requires `DEEPGRAM_API_KEY` plus an audio file.',
    '- Natural fluidness still requires a human listening pass; this runner records latency/control evidence.',
    '- When `--save-audio-dir` is used, listen to the generated audio files and score pacing, pronunciation, dead air, and whether spoken rendering preserves backend meaning.',
    '',
  );

  return `${lines.join('\n')}\n`;
}

async function main() {
  const config = getConfig();
  const runs = Number(arg('runs', '3'));
  const text = arg('text', 'What is the Talkbox provider recommendation?');
  const audioPath = arg('audio', '');
  const mockAgent = hasFlag('mock-agent') || !hasFlag('real-agent');
  const selected = arg('stacks', '').split(',').map((item) => item.trim()).filter(Boolean);
  const outputPath = arg('output', resolve(PROJECT_ROOT, 'benchmarks', `provider-matrix-${Date.now()}.json`));
  const markdownPath = arg('markdown', resolve(PROJECT_ROOT, 'benchmarks', 'latest-provider-matrix.md'));
  const saveAudioDir = arg('save-audio-dir', '');
  const audio = await loadAudio(audioPath);

  let mock = null;
  if (mockAgent) {
    mock = await startMockAgent();
    config.agentAdapter = 'http';
    config.agentEndpoint = mock.endpoint;
    config.agentName = 'MockAgent';
  }

  const stacks = defaultStacks().filter((stack) => !selected.length || selected.includes(stack.id));
  const report = {
    createdAt: new Date().toISOString(),
    mockAgent,
    runsPerStack: runs,
    audioPath: audioPath || null,
    agentEndpoint: config.agentEndpoint,
    agentAdapter: config.agentAdapter,
    deepgramConfigured: !!config.deepgramApiKey,
    piperHttpEndpoint: config.piperHttpEndpoint || null,
    sherpaConfigured: !!config.sherpaSttConfigJson,
    audioArtifactDir: saveAudioDir || null,
    stacks: [],
  };

  try {
    for (const stack of stacks) {
      const missing = missingRequirements(stack, config, audioPath);
      if (missing.length) {
        report.stacks.push({ ...stack, status: 'skipped', reason: missing.join('; ') });
        console.log(`skip stack=${stack.id} reason="${missing.join('; ')}"`);
        continue;
      }

      const results = [];
      const audioArtifacts = [];
      try {
        for (let i = 0; i < runs; i += 1) {
          const result = await runVoiceTurn({
            ...audio,
            transcript: text,
            sttProvider: stack.sttProvider,
            ttsProvider: stack.ttsProvider,
            speak: true,
            includeAudioBase64: !!saveAudioDir,
          }, config);
          results.push(result);
          if (saveAudioDir && result.audio?.base64) {
            const contentType = result.audio.contentType || 'application/octet-stream';
            const extension = contentType.includes('mpeg')
              ? 'mp3'
              : contentType.includes('wav')
                ? 'wav'
                : contentType.includes('aiff')
                  ? 'aiff'
                  : 'bin';
            await mkdir(saveAudioDir, { recursive: true });
            const filename = `${stack.id}-run-${i + 1}.${extension}`;
            const artifactPath = resolve(saveAudioDir, filename);
            await writeFile(artifactPath, Buffer.from(result.audio.base64, 'base64'));
            audioArtifacts.push({
              run: i + 1,
              path: artifactPath,
              contentType,
              bytes: result.audio.bytes,
            });
          }
          console.log([
            `stack=${stack.id}`,
            `run=${i + 1}`,
            `totalMs=${result.timings.totalMs}`,
            `sttMs=${result.timings.stt_finishedMs}`,
            `agentMs=${result.timings.agent_response_finishedMs}`,
            `ttsMs=${result.timings.tts_finishedMs ?? 'n/a'}`,
          ].join(' '));
        }
        report.stacks.push({
          ...stack,
          status: 'ran',
          summary: summarize(results),
          transcripts: [...new Set(results.map((result) => result.transcript))],
          sampleSpoken: results[0]?.spoken || '',
          audioArtifacts,
          results,
        });
      } catch (err) {
        report.stacks.push({ ...stack, status: 'error', error: err.message });
        console.log(`error stack=${stack.id} message="${err.message}"`);
      }
    }

    await mkdir(dirname(outputPath), { recursive: true });
    await mkdir(dirname(markdownPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(report, null, 2));
    await writeFile(markdownPath, markdownReport(report));

    console.log(`wrote ${outputPath}`);
    console.log(`wrote ${markdownPath}`);

    if (selected.length) {
      const unknown = selected.filter((id) => !defaultStacks().some((stack) => stack.id === id));
      if (unknown.length) {
        console.warn(`Unknown stack id(s): ${unknown.join(', ')}`);
      }
    }

    if (audioPath && !existsSync(audioPath)) {
      console.warn(`Audio path did not exist when checked after run: ${audioPath}`);
    }
  } finally {
    mock?.server.close();
  }
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
