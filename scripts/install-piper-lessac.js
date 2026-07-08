#!/usr/bin/env node
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const VENV_DIR = resolve(PROJECT_ROOT, '.venv');
const PYTHON = resolve(VENV_DIR, 'bin', 'python');
const MODELS_DIR = resolve(PROJECT_ROOT, 'models');
const VOICE = 'en_US-lessac-medium';

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

async function main() {
  if (!existsSync(PYTHON)) {
    await run('python3', ['-m', 'venv', VENV_DIR], { cwd: PROJECT_ROOT });
  }

  await mkdir(MODELS_DIR, { recursive: true });
  await run(PYTHON, ['-m', 'pip', 'install', '--upgrade', 'pip'], { cwd: PROJECT_ROOT });
  await run(PYTHON, ['-m', 'pip', 'install', 'piper-tts', 'flask', 'certifi'], { cwd: PROJECT_ROOT });

  const certifi = spawn(PYTHON, ['-m', 'certifi'], { cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
  let certPath = '';
  certifi.stdout.on('data', (chunk) => {
    certPath += chunk;
  });
  await new Promise((resolvePromise, reject) => {
    certifi.on('exit', (code) => (code === 0 ? resolvePromise() : reject(new Error(`certifi exited with ${code}`))));
    certifi.on('error', reject);
  });

  await run(PYTHON, ['-m', 'piper.download_voices', '--download-dir', MODELS_DIR, VOICE], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, SSL_CERT_FILE: certPath.trim() },
  });

  console.log(`Installed Piper voice: ${resolve(MODELS_DIR, `${VOICE}.onnx`)}`);
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
