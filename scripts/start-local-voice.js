#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { getConfig, loadEnv } from '../src/config.js';
import { createTalkBoxServer } from '../src/orchestrator.js';

loadEnv();

const piperHost = process.env.PIPER_HTTP_HOST || '127.0.0.1';
const piperPort = process.env.PIPER_HTTP_PORT || '8092';
const piperEndpoint = process.env.PIPER_HTTP_ENDPOINT || `http://${piperHost}:${piperPort}`;
const shouldOpen = !process.argv.includes('--no-open');

process.env.STT_PROVIDER = process.env.STT_PROVIDER || 'deepgram';
process.env.TTS_PROVIDER = process.env.TTS_PROVIDER || 'piper-http';
process.env.PIPER_HTTP_ENDPOINT = piperEndpoint;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function probePiper() {
  try {
    const response = await fetch(piperEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'audio/wav' },
      body: JSON.stringify({ text: 'Talk Box ready.' }),
      signal: AbortSignal.timeout(1200),
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    return response.ok &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WAVE';
  } catch {
    return false;
  }
}

async function waitForPiper() {
  for (let i = 0; i < 30; i += 1) {
    if (await probePiper()) return true;
    await sleep(300);
  }
  return false;
}

async function startPiperIfNeeded() {
  if (await probePiper()) {
    console.log(`[Talk Box] Piper already running at ${piperEndpoint}`);
    return null;
  }

  const python = process.env.PIPER_PYTHON || resolve(process.cwd(), '.venv', 'bin', 'python');
  const model = process.env.PIPER_MODEL || resolve(process.cwd(), 'models', 'en_US-lessac-medium.onnx');
  if (!existsSync(python) || !existsSync(model)) {
    throw new Error('Piper is not installed. Run `npm run install:piper-lessac` once, then retry `npm run voice:local`.');
  }

  console.log(`[Talk Box] Starting Piper at ${piperEndpoint}`);
  const child = spawn(process.execPath, ['scripts/start-piper-http.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PIPER_HTTP_HOST: piperHost,
      PIPER_HTTP_PORT: piperPort,
      PIPER_HTTP_ENDPOINT: piperEndpoint,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => process.stdout.write(`[Piper] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[Piper] ${chunk}`));

  if (!(await waitForPiper())) {
    child.kill('SIGTERM');
    throw new Error(`Piper did not become ready at ${piperEndpoint}`);
  }

  return child;
}

async function main() {
  const piper = await startPiperIfNeeded();
  const config = getConfig();

  if (!config.deepgramApiKey) {
    throw new Error('Missing DEEPGRAM_API_KEY in .env. Add it once, then run `npm run voice:local` again.');
  }

  const agentHealthUrl = config.agentAdapter === 'cal'
    ? `${config.agentEndpoint}/health`
    : new URL('/health', config.agentEndpoint).toString();
  try {
    const response = await fetch(agentHealthUrl, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) console.warn(`[Talk Box] Agent health returned HTTP ${response.status}`);
  } catch (err) {
    console.warn(`[Talk Box] Could not verify agent at ${agentHealthUrl}: ${err.message}`);
    console.warn('[Talk Box] Start/restart your backend agent if the browser request fails.');
  }

  const server = createTalkBoxServer(config);
  server.on('error', (err) => {
    console.error(`[Talk Box] failed to listen on ${config.host}:${config.port}: ${err.message}`);
    piper?.kill('SIGTERM');
    process.exitCode = 1;
  });

  server.listen(config.port, config.host, () => {
    const url = `http://${config.host}:${config.port}`;
    console.log('');
    console.log(`[Talk Box] Ready: ${url}`);
    console.log('[Talk Box] Click "Start Talking" and speak one complete thought. Talkbox will send it to your agent.');
    console.log('[Talk Box] Press Ctrl+C here to stop Talk Box and Piper.');
    if (shouldOpen && process.platform === 'darwin') {
      spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    }
  });

  function shutdown() {
    server.close();
    piper?.kill('SIGTERM');
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(`[Talk Box] ${err.message}`);
  process.exitCode = 1;
});
