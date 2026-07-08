import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function commandParts(command) {
  return String(command || '').match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, '')) || [];
}

export function createCommandTtsAdapter(config = {}) {
  return {
    name: 'command',
    kind: 'tts',
    async synthesize(text) {
      if (!config.commandTtsCommand) {
        throw new Error('Command TTS requires COMMAND_TTS_COMMAND, PIPER_TTS_COMMAND, or SAY_TTS_COMMAND');
      }

      const dir = await mkdtemp(join(tmpdir(), 'talk-box-tts-'));
      const outputPath = join(dir, config.commandTtsOutputName || 'speech.aiff');

      try {
        const parts = commandParts(config.commandTtsCommand)
          .map((part) => part
            .replaceAll('{text}', text)
            .replaceAll('{output}', outputPath));
        const [bin, ...args] = parts;
        if (!bin) throw new Error('Command TTS command parsed empty');

        const result = await execFileAsync(bin, args, {
          timeout: config.commandTimeoutMs || 120_000,
          maxBuffer: 10 * 1024 * 1024,
        });
        const audioBuffer = await readFile(outputPath);

        return {
          provider: 'command',
          text,
          contentType: config.commandTtsContentType || 'audio/aiff',
          audioBuffer,
          bytes: audioBuffer.length,
          raw: { stderr: result.stderr.trim() },
        };
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
