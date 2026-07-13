import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const eq = trimmed.indexOf('=');
  if (eq === -1) return null;

  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return key ? [key, value] : null;
}

export function loadEnv(envPath = resolve(process.cwd(), '.env')) {
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;

    const [key, value] = parsed;
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function normalizeEndpoint(endpoint, fallback = 'http://localhost:8080/chat') {
  return String(endpoint || fallback).replace(/\/+$/, '');
}

function defaultSherpaConfigJson() {
  const modelDir = resolve(process.cwd(), 'models', 'sherpa-onnx-streaming-zipformer-en-20M-2023-02-17');
  const encoder = resolve(modelDir, 'encoder-epoch-99-avg-1.int8.onnx');
  const decoder = resolve(modelDir, 'decoder-epoch-99-avg-1.onnx');
  const joiner = resolve(modelDir, 'joiner-epoch-99-avg-1.int8.onnx');
  const tokens = resolve(modelDir, 'tokens.txt');

  if (![encoder, decoder, joiner, tokens].every((path) => existsSync(path))) return '';

  return JSON.stringify({
    featConfig: {
      sampleRate: 16000,
      featureDim: 80,
    },
    modelConfig: {
      transducer: { encoder, decoder, joiner },
      tokens,
      numThreads: 1,
      provider: 'cpu',
      debug: false,
    },
    enableEndpoint: true,
  });
}

function defaultSherpaTtsConfigJson() {
  const modelDir = resolve(process.cwd(), 'models', 'kitten-nano-en-v0_1-fp16');
  const model = resolve(modelDir, 'model.fp16.onnx');
  const voices = resolve(modelDir, 'voices.bin');
  const tokens = resolve(modelDir, 'tokens.txt');
  const dataDir = resolve(modelDir, 'espeak-ng-data');

  if (![model, voices, tokens, dataDir].every((path) => existsSync(path))) return '';

  return JSON.stringify({
    offlineTtsModelConfig: {
      offlineTtsKittenModelConfig: {
        model,
        voices,
        tokens,
        dataDir,
        lengthScale: 1.0,
      },
      numThreads: 2,
      debug: 0,
      provider: 'cpu',
    },
    maxNumSentences: 1,
  });
}

export function getConfig() {
  loadEnv();

  const inferredAgentAdapter = process.env.AGENT_ADAPTER ||
    (process.env.CAL_ENDPOINT || process.env.CAL_VOICE_PERSONA_PATH ? 'cal' : 'http');
  const agentEndpoint = normalizeEndpoint(
    process.env.AGENT_ENDPOINT || process.env.CAL_ENDPOINT,
    inferredAgentAdapter === 'cal' ? 'http://localhost:8080' : 'http://localhost:8080/chat',
  );
  const agentAdapter = inferredAgentAdapter;
  const agentName = process.env.AGENT_NAME || (agentAdapter === 'cal' ? 'Cal' : 'Agent');

  const commandTtsCommand = process.env.COMMAND_TTS_COMMAND ||
    process.env.PIPER_TTS_COMMAND ||
    process.env.SAY_TTS_COMMAND ||
    (process.env.USE_MACOS_SAY === '1' ? 'say -o {output} {text}' : '');

  return {
    host: process.env.HOST || '127.0.0.1',
    port: numberFromEnv('PORT', 8090),
    agentAdapter,
    agentName,
    agentEndpoint,
    agentContextId: process.env.AGENT_CONTEXT_ID || process.env.CONTEXT_ID || 'talkbox',
    agentHistoryUrl: process.env.AGENT_HISTORY_URL || '',
    agentTimeoutMs: numberFromEnv('AGENT_TIMEOUT_MS', 300_000),
    contextId: process.env.CONTEXT_ID || process.env.AGENT_CONTEXT_ID || 'talkbox',
    humeApiKey: process.env.HUME_API_KEY || '',
    humeSecretKey: process.env.HUME_SECRET_KEY || '',
    humeConfigId: process.env.HUME_CONFIG_ID || '',
    talkBoxApiKey: process.env.TALK_BOX_API_KEY || '',
    emotionThreshold: numberFromEnv('EMOTION_THRESHOLD', 0.5),
    sttProvider: process.env.STT_PROVIDER || 'transcript',
    ttsProvider: process.env.TTS_PROVIDER || 'silent',
    voiceMode: process.env.VOICE_MODE || 'detailed',
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    openaiRealtimeModel: process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime',
    openaiRealtimeVoice: process.env.OPENAI_REALTIME_VOICE || 'marin',
    progressNarrationEnabled: process.env.PROGRESS_NARRATION_ENABLED !== '0',
    progressNarrationStyle: process.env.PROGRESS_NARRATION_STYLE || 'calm-commentator',
    agentVoicePersonaPath: process.env.AGENT_VOICE_PERSONA_PATH || process.env.CAL_VOICE_PERSONA_PATH || '',
    agentVoicePersonaMaxChars: numberFromEnv(
      'AGENT_VOICE_PERSONA_MAX_CHARS',
      numberFromEnv('CAL_VOICE_PERSONA_MAX_CHARS', 4500),
    ),
    deepgramApiKey: process.env.DEEPGRAM_API_KEY || '',
    deepgramSttModel: process.env.DEEPGRAM_STT_MODEL || 'nova-3',
    deepgramTtsModel: process.env.DEEPGRAM_TTS_MODEL || 'aura-2-thalia-en',
    piperHttpEndpoint: process.env.PIPER_HTTP_ENDPOINT ? normalizeEndpoint(process.env.PIPER_HTTP_ENDPOINT) : '',
    piperVoice: process.env.PIPER_VOICE || '',
    piperSpeakerId: numberFromEnv('PIPER_SPEAKER_ID', NaN),
    piperLengthScale: numberFromEnv('PIPER_LENGTH_SCALE', NaN),
    commandSttCommand: process.env.COMMAND_STT_COMMAND || process.env.SHERPA_STT_COMMAND || '',
    sherpaSttConfigJson: process.env.SHERPA_STT_CONFIG_JSON || defaultSherpaConfigJson(),
    sherpaTailPaddingSeconds: numberFromEnv('SHERPA_TAIL_PADDING_SECONDS', 0.8),
    sherpaTtsConfigJson: process.env.SHERPA_TTS_CONFIG_JSON || defaultSherpaTtsConfigJson(),
    sherpaTtsEnableUnsafe: process.env.SHERPA_TTS_ENABLE_UNSAFE === '1',
    sherpaTtsSpeakerId: numberFromEnv('SHERPA_TTS_SPEAKER_ID', 0),
    sherpaTtsSpeed: numberFromEnv('SHERPA_TTS_SPEED', 1.0),
    commandTtsCommand,
    commandTtsContentType: process.env.COMMAND_TTS_CONTENT_TYPE || 'audio/aiff',
    commandTtsOutputName: process.env.COMMAND_TTS_OUTPUT_NAME || 'speech.aiff',
    commandTimeoutMs: numberFromEnv('COMMAND_TIMEOUT_MS', 120_000),
  };
}
