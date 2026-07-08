export function createDeepgramTtsAdapter(config = {}) {
  return {
    name: 'deepgram',
    kind: 'tts',
    async synthesize(text) {
      if (!config.deepgramApiKey) {
        throw new Error('Deepgram TTS requires DEEPGRAM_API_KEY');
      }
      const model = config.deepgramTtsModel || 'aura-2-thalia-en';
      const response = await fetch(`https://api.deepgram.com/v1/speak?model=${encodeURIComponent(model)}`, {
        method: 'POST',
        headers: {
          Authorization: `Token ${config.deepgramApiKey}`,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({ text }),
      });

      const arrayBuffer = await response.arrayBuffer();
      if (!response.ok) {
        const raw = Buffer.from(arrayBuffer).toString('utf8');
        throw new Error(`Deepgram TTS HTTP ${response.status}: ${raw.slice(0, 300)}`);
      }

      return {
        provider: 'deepgram',
        model,
        text,
        contentType: response.headers.get('content-type') || 'audio/mpeg',
        audioBuffer: Buffer.from(arrayBuffer),
        bytes: arrayBuffer.byteLength,
        raw: {},
      };
    },
  };
}
