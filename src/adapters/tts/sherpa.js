import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let cachedTts = null;
let cachedConfig = '';

function parseConfig(config = {}) {
  if (!config.sherpaTtsConfigJson) {
    throw new Error('Sherpa TTS requires SHERPA_TTS_CONFIG_JSON or the default Kitten model installed');
  }

  try {
    return JSON.parse(config.sherpaTtsConfigJson);
  } catch (err) {
    throw new Error(`Invalid SHERPA_TTS_CONFIG_JSON: ${err.message}`);
  }
}

async function getTts(config) {
  if (cachedTts && cachedConfig === config.sherpaTtsConfigJson) return cachedTts;
  cachedTts?.free?.();
  const sherpa = await import('sherpa-onnx');
  const parsed = parseConfig(config);
  cachedTts = sherpa.createOfflineTts(parsed);
  cachedConfig = config.sherpaTtsConfigJson;
  return cachedTts;
}

export function createSherpaTtsAdapter(config = {}) {
  return {
    name: 'sherpa',
    kind: 'tts',
    async synthesize(text) {
      if (!config.sherpaTtsEnableUnsafe) {
        throw new Error('Sherpa KittenTTS is disabled by default because the current Node binding can abort the process. Set SHERPA_TTS_ENABLE_UNSAFE=1 only for isolated experiments.');
      }
      const tts = await getTts(config);
      const dir = await mkdtemp(join(tmpdir(), 'talk-box-sherpa-tts-'));
      const outputPath = join(dir, 'speech.wav');

      try {
        const audio = tts.generateWithConfig(text, {
          sid: Number(config.sherpaTtsSpeakerId || 0),
          speed: Number(config.sherpaTtsSpeed || 1.0),
        });
        tts.save(outputPath, audio);
        const audioBuffer = await readFile(outputPath);
        return {
          provider: 'sherpa',
          model: 'kitten-nano-en-v0_1-fp16',
          text,
          contentType: 'audio/wav',
          audioBuffer,
          bytes: audioBuffer.length,
          raw: {
            sampleRate: audio.sampleRate,
            samples: audio.samples.length,
          },
        };
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
