export function createDeepgramSttAdapter(config = {}) {
  return {
    name: 'deepgram',
    kind: 'stt',
    async transcribe(input = {}) {
      if (!config.deepgramApiKey) {
        throw new Error('Deepgram STT requires DEEPGRAM_API_KEY');
      }
      if (!input.audioBuffer?.length) {
        throw new Error('Deepgram STT requires audioBuffer');
      }

      const model = config.deepgramSttModel || 'nova-3';
      const params = new URLSearchParams({
        model,
        smart_format: 'true',
        punctuate: 'true',
      });
      const response = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
        method: 'POST',
        headers: {
          Authorization: `Token ${config.deepgramApiKey}`,
          'Content-Type': input.contentType || 'application/octet-stream',
        },
        body: input.audioBuffer,
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(`Deepgram STT HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 300)}`);
      }

      const alternative = payload?.results?.channels?.[0]?.alternatives?.[0];
      const text = String(alternative?.transcript || '').trim();
      if (!text) throw new Error('Deepgram STT returned no transcript');

      return {
        provider: 'deepgram',
        model,
        text,
        confidence: alternative?.confidence ?? null,
        raw: payload,
      };
    },
  };
}
