#!/usr/bin/env node
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
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

async function startMockAgent() {
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || '{}');
    const text = body.text || body.message || body?.params?.message?.parts?.[0]?.text || '';
    const responseText = [
      '## Talkbox benchmark result',
      '',
      `Agent received: ${text}`,
      '',
      '**Important principle:** Talkbox manages conversation mechanics, but does not invent task answers.',
      '',
      '- Point one: clean turn handling.',
      '- Point two: latency instrumentation.',
      '- Point three: adapter swap control.',
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

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

function summarize(results) {
  const totals = results.map((item) => item.timings.totalMs);
  return {
    runs: results.length,
    totalMs: {
      min: Math.min(...totals),
      p50: percentile(totals, 50),
      p95: percentile(totals, 95),
      max: Math.max(...totals),
    },
    stages: Object.fromEntries([
      'stt_finishedMs',
      'agent_response_finishedMs',
      'voice_render_finishedMs',
      'tts_finishedMs',
    ].map((field) => {
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

async function main() {
  const config = getConfig();
  const runs = Number(arg('runs', '3'));
  const sttProvider = arg('stt', config.sttProvider);
  const ttsProvider = arg('tts', config.ttsProvider);
  const transcript = arg('text', 'What is the Talkbox architecture decision?');
  const audioPath = arg('audio', '');
  const useMockAgent = hasFlag('mock-agent');
  const outputPath = arg('output', resolve(PROJECT_ROOT, 'benchmarks', `benchmark-${Date.now()}.json`));

  let mock = null;
  if (useMockAgent) {
    mock = await startMockAgent();
    config.agentAdapter = 'http';
    config.agentEndpoint = mock.endpoint;
    config.agentName = 'MockAgent';
  }

  let audioBase64 = '';
  let audioContentType = '';
  let audioExtension = '';
  if (audioPath) {
    const audio = await readFile(audioPath);
    audioBase64 = audio.toString('base64');
    audioExtension = audioPath.split('.').pop();
    audioContentType = audioExtension === 'mp3'
      ? 'audio/mpeg'
      : audioExtension === 'wav'
        ? 'audio/wav'
        : 'application/octet-stream';
  }

  const results = [];
  try {
    for (let i = 0; i < runs; i += 1) {
      const result = await runVoiceTurn({
        transcript,
        audioBase64,
        audioContentType,
        audioExtension,
        sttProvider,
        ttsProvider,
        speak: true,
      }, config);
      results.push(result);
      console.log([
        `run=${i + 1}`,
        `stt=${result.sttProvider}`,
        `tts=${result.ttsProvider}`,
        `totalMs=${result.timings.totalMs}`,
        `sttDoneMs=${result.timings.stt_finishedMs}`,
        `agentDoneMs=${result.timings.agent_response_finishedMs}`,
        `ttsDoneMs=${result.timings.tts_finishedMs ?? 'n/a'}`,
      ].join(' '));
    }

    const report = {
      createdAt: new Date().toISOString(),
      sttProvider,
      ttsProvider,
      agentEndpoint: config.agentEndpoint,
      agentAdapter: config.agentAdapter,
      mockAgent: useMockAgent,
      summary: summarize(results),
      results,
      assessmentInputs: {
        latency: 'Use p50/p95 totalMs plus stage timing marks.',
        naturalFluidness: 'Manual score during live PWA run: interruption, dead air, transcript cleanliness, spoken summary quality.',
        control: 'Adapter preserves one clean transcript per backend turn and keeps the backend agent as source of truth.',
      },
    };

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(report, null, 2));
    console.log(`wrote ${outputPath}`);
  } finally {
    mock?.server.close();
  }
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
