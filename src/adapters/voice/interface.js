export const VOICE_ADAPTER_CONTRACT = {
  connect: 'connect(config) -> Promise<void>',
  onTranscript: 'onTranscript(callback) -> unsubscribe function',
  speak: 'speak(text) -> Promise<void>',
  onBargeIn: 'onBargeIn(callback) -> unsubscribe function',
  disconnect: 'disconnect() -> Promise<void>',
};

export class VoiceAdapter {
  constructor({ name = 'voice' } = {}) {
    this.name = name;
  }

  async connect() {
    throw new Error(`${this.name} adapter must implement connect(config)`);
  }

  onTranscript() {
    return () => {};
  }

  async speak() {
    throw new Error(`${this.name} adapter must implement speak(text)`);
  }

  onBargeIn() {
    return () => {};
  }

  async disconnect() {}
}
