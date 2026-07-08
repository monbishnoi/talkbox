export function createTranscriptSttAdapter() {
  return {
    name: 'transcript',
    kind: 'stt',
    async transcribe(input = {}) {
      const text = String(input.transcript || '').trim();
      if (!text) {
        throw new Error('Transcript STT adapter requires input.transcript');
      }
      return {
        provider: 'transcript',
        text,
        confidence: 1,
        raw: { source: 'provided_text' },
      };
    },
  };
}
