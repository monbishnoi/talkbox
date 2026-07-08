import { createCommandSttAdapter } from './command.js';
import { createDeepgramSttAdapter } from './deepgram.js';
import { createSherpaSttAdapter } from './sherpa.js';
import { createTranscriptSttAdapter } from './transcript.js';

export function createSttAdapter(name = 'transcript', config = {}) {
  switch (name) {
    case 'transcript':
    case 'browser':
      return createTranscriptSttAdapter(config);
    case 'deepgram':
      return createDeepgramSttAdapter(config);
    case 'sherpa':
      if (config.sherpaSttConfigJson) return createSherpaSttAdapter(config);
      return createCommandSttAdapter(config);
    case 'command':
      return createCommandSttAdapter(config);
    default:
      throw new Error(`Unknown STT provider: ${name}`);
  }
}

export function describeSttProviders(config = {}) {
  return [
    { name: 'transcript', available: true, note: 'Uses final text supplied by browser/client.' },
    { name: 'browser', available: true, note: 'Alias for transcript when browser performs STT.' },
    { name: 'deepgram', available: !!config.deepgramApiKey, note: 'Requires DEEPGRAM_API_KEY.' },
    {
      name: 'sherpa',
      available: !!config.sherpaSttConfigJson || !!config.commandSttCommand,
      note: 'Node sherpa-onnx adapter with SHERPA_STT_CONFIG_JSON, or command fallback with SHERPA_STT_COMMAND.',
    },
  ];
}
