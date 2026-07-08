#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const piperPython = process.env.PIPER_PYTHON || resolve(process.cwd(), '.venv', 'bin', 'python');
const host = process.env.PIPER_HTTP_HOST || '127.0.0.1';
const port = process.env.PIPER_HTTP_PORT || '8092';
const model = process.env.PIPER_MODEL || resolve(process.cwd(), 'models', 'en_US-lessac-medium.onnx');
const dataDir = process.env.PIPER_DATA_DIR || resolve(process.cwd(), 'models');

for (const path of [piperPython, model]) {
  if (!existsSync(path)) {
    console.error(`Missing Piper dependency: ${path}`);
    console.error('Run `npm run install:piper-lessac` first.');
    process.exit(1);
  }
}

console.log(`[Talk Box] Starting Piper HTTP on http://${host}:${port}`);
console.log(`[Talk Box] Model: ${model}`);

const child = spawn(piperPython, [
  '-m',
  'piper.http_server',
  '--host',
  host,
  '--port',
  String(port),
  '--model',
  model,
  '--data-dir',
  dataDir,
], {
  stdio: 'inherit',
  cwd: process.cwd(),
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exitCode = code ?? 0;
});

child.on('error', (err) => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
