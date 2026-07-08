import { createCommandTtsAdapter } from './command.js';
import { createDeepgramTtsAdapter } from './deepgram.js';
import { createPiperHttpTtsAdapter } from './piper-http.js';
import { createSherpaTtsAdapter } from './sherpa.js';
import { createSilentTtsAdapter } from './silent.js';

export function createTtsAdapter(name = 'silent', config = {}) {
  switch (name) {
    case 'silent':
    case 'browser':
      return createSilentTtsAdapter(config);
    case 'deepgram':
      return createDeepgramTtsAdapter(config);
    case 'piper-http':
    case 'piper-server':
      return createPiperHttpTtsAdapter(config);
    case 'sherpa':
    case 'kitten':
      return createSherpaTtsAdapter(config);
    case 'command':
    case 'piper':
    case 'say':
      return createCommandTtsAdapter(config);
    default:
      throw new Error(`Unknown TTS provider: ${name}`);
  }
}

export function describeTtsProviders(config = {}) {
  return [
    { name: 'silent', available: true, note: 'No audio synthesis; useful for latency baselines.' },
    { name: 'browser', available: true, note: 'Browser speaks the returned spoken text.' },
    { name: 'deepgram', available: !!config.deepgramApiKey, note: 'Requires DEEPGRAM_API_KEY.' },
    {
      name: 'piper-http',
      available: !!config.piperHttpEndpoint,
      note: 'Persistent local Piper HTTP server; fastest measured local TTS path so far.',
    },
    {
      name: 'sherpa',
      available: !!config.sherpaTtsConfigJson && config.sherpaTtsEnableUnsafe,
      note: 'Experimental Sherpa/KittenTTS adapter. Disabled by default because the Node binding can abort this process.',
    },
    {
      name: 'say',
      available: !!config.commandTtsCommand && config.commandTtsCommand.includes('say'),
      note: 'macOS say command adapter.',
    },
    {
      name: 'piper',
      available: !!config.commandTtsCommand,
      note: 'Command adapter. Configure PIPER_TTS_COMMAND or COMMAND_TTS_COMMAND.',
    },
  ];
}
