export function createPiperHttpTtsAdapter(config = {}) {
  return {
    name: 'piper-http',
    kind: 'tts',
    async synthesize(text) {
      const endpoint = config.piperHttpEndpoint || 'http://127.0.0.1:8092';
      const body = {
        text,
        ...(config.piperVoice ? { voice: config.piperVoice } : {}),
        ...(Number.isFinite(config.piperSpeakerId) ? { speaker_id: config.piperSpeakerId } : {}),
        ...(Number.isFinite(config.piperLengthScale) ? { length_scale: config.piperLengthScale } : {}),
      };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'audio/wav',
        },
        body: JSON.stringify(body),
      });

      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = Buffer.from(arrayBuffer);
      if (!response.ok) {
        const raw = audioBuffer.toString('utf8');
        throw new Error(`Piper HTTP TTS ${response.status}: ${raw.slice(0, 300)}`);
      }

      const headerType = response.headers.get('content-type') || '';
      const looksLikeWav = audioBuffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
        audioBuffer.subarray(8, 12).toString('ascii') === 'WAVE';
      const contentType = looksLikeWav ? 'audio/wav' : (headerType || 'application/octet-stream');

      return {
        provider: 'piper-http',
        model: config.piperVoice || 'default',
        text,
        contentType,
        audioBuffer,
        bytes: arrayBuffer.byteLength,
        raw: { endpoint },
      };
    },
  };
}
