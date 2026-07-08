function parseSherpaConfig(config = {}) {
  if (!config.sherpaSttConfigJson) {
    throw new Error('Sherpa STT requires SHERPA_STT_CONFIG_JSON with offline recognizer model paths');
  }

  try {
    const parsed = JSON.parse(config.sherpaSttConfigJson);
    parsed.modelConfig = parsed.modelConfig || {};
    if (parsed.modelConfig.debug === undefined) parsed.modelConfig.debug = false;
    return parsed;
  } catch (err) {
    throw new Error(`Invalid SHERPA_STT_CONFIG_JSON: ${err.message}`);
  }
}

export function createSherpaSttAdapter(config = {}) {
  return {
    name: 'sherpa',
    kind: 'stt',
    async transcribe(input = {}) {
      if (!input.audioBuffer?.length) {
        throw new Error('Sherpa STT requires WAV audioBuffer');
      }

      const sherpaConfig = parseSherpaConfig(config);
      const sherpa = await import('sherpa-onnx');
      const wave = sherpa.readWaveFromBinaryData(new Uint8Array(input.audioBuffer));
      if (!wave) {
        throw new Error('Sherpa STT could not read audio. Use WAV input for the Node adapter.');
      }

      const mode = sherpaConfig.type || sherpaConfig.mode || 'online';
      const recognizer = mode === 'offline'
        ? sherpa.createOfflineRecognizer(sherpaConfig)
        : sherpa.createOnlineRecognizer(sherpaConfig);
      const stream = recognizer.createStream();
      try {
        stream.acceptWaveform(wave.sampleRate, wave.samples);
        const tailPaddingSeconds = Number(config.sherpaTailPaddingSeconds ?? 0.8);
        if (mode !== 'offline' && Number.isFinite(tailPaddingSeconds) && tailPaddingSeconds > 0) {
          stream.acceptWaveform(wave.sampleRate, new Float32Array(Math.round(wave.sampleRate * tailPaddingSeconds)));
        }
        stream.inputFinished?.();

        if (mode === 'offline') {
          recognizer.decode(stream);
        } else {
          while (recognizer.isReady(stream)) {
            recognizer.decode(stream);
          }
        }

        const result = recognizer.getResult(stream);
        const text = String(result?.text || '').trim();
        if (!text) throw new Error('Sherpa STT returned no transcript');
        return {
          provider: 'sherpa',
          mode,
          text,
          confidence: null,
          raw: result,
        };
      } finally {
        stream.free?.();
        recognizer.free?.();
      }
    },
  };
}
