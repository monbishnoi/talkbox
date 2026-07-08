#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : '1';
    args[key] = value;
  }
  return args;
}

function run(command, args, stdin) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'inherit', 'inherit'] });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} exited with ${code}`));
    });
    child.stdin.end(stdin);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const text = args.text || '';
  const output = args.output;
  if (!text.trim()) throw new Error('--text is required');
  if (!output) throw new Error('--output is required');

  const piperBin = args.piper || process.env.PIPER_BIN || resolve(process.cwd(), '.venv', 'bin', 'piper');
  const model = args.model || process.env.PIPER_MODEL || resolve(process.cwd(), 'models', 'en_US-lessac-medium.onnx');
  const config = args.config || process.env.PIPER_CONFIG || `${model}.json`;

  for (const path of [piperBin, model, config]) {
    if (!existsSync(path)) throw new Error(`Missing Piper dependency: ${path}`);
  }

  await run(piperBin, ['--model', model, '--config', config, '--output-file', output], `${text}\n`);
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
