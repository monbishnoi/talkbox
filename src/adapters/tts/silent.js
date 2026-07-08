export function createSilentTtsAdapter() {
  return {
    name: 'silent',
    kind: 'tts',
    async synthesize(text) {
      return {
        provider: 'silent',
        text,
        contentType: 'text/plain; charset=utf-8',
        audioBuffer: Buffer.from(''),
        bytes: 0,
        raw: { skipped: true },
      };
    },
  };
}
