#!/usr/bin/env node
import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const MODELS_DIR = resolve(PROJECT_ROOT, 'models');
const MODEL_NAME = 'kitten-nano-en-v0_1-fp16';
const ARCHIVE = `${MODEL_NAME}.tar.bz2`;
const URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/${ARCHIVE}`;

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} exited with ${code}`));
    });
    child.on('error', reject);
  });
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function download(url, dest) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: HTTP ${response.status}`);
  }
  await pipeline(response.body, createWriteStream(dest));
}

async function main() {
  const modelDir = resolve(MODELS_DIR, MODEL_NAME);
  if (await exists(resolve(modelDir, 'tokens.txt'))) {
    console.log(modelDir);
    return;
  }

  await mkdir(MODELS_DIR, { recursive: true });
  const archivePath = resolve(MODELS_DIR, ARCHIVE);
  console.log(`Downloading ${URL}`);
  await download(URL, archivePath);
  console.log(`Extracting ${ARCHIVE}`);
  await run('tar', ['xjf', archivePath], { cwd: MODELS_DIR });
  await rm(archivePath, { force: true });
  console.log(modelDir);
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
