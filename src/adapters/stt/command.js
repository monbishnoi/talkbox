import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function commandParts(command) {
  return String(command || '').match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, '')) || [];
}

export function createCommandSttAdapter(config = {}) {
  return {
    name: 'command',
    kind: 'stt',
    async transcribe(input = {}) {
      if (!config.commandSttCommand) {
        throw new Error('Command STT requires COMMAND_STT_COMMAND or SHERPA_STT_COMMAND');
      }
      if (!input.audioBuffer?.length) {
        throw new Error('Command STT requires audioBuffer');
      }

      const dir = await mkdtemp(join(tmpdir(), 'talk-box-stt-'));
      const audioPath = join(dir, `input.${input.extension || 'wav'}`);
      const outputPath = join(dir, 'transcript.txt');

      try {
        await writeFile(audioPath, input.audioBuffer);
        const parts = commandParts(config.commandSttCommand)
          .map((part) => part
            .replaceAll('{audio}', audioPath)
            .replaceAll('{output}', outputPath));
        const [bin, ...args] = parts;
        if (!bin) throw new Error('Command STT command parsed empty');

        const result = await execFileAsync(bin, args, {
          timeout: config.commandTimeoutMs || 120_000,
          maxBuffer: 10 * 1024 * 1024,
        });

        let text = result.stdout.trim();
        try {
          const output = await readFile(outputPath, 'utf8');
          if (output.trim()) text = output.trim();
        } catch {
          // stdout is the default path.
        }

        if (!text) throw new Error('Command STT returned no transcript');
        return {
          provider: 'command',
          text,
          confidence: null,
          raw: { stderr: result.stderr.trim() },
        };
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
