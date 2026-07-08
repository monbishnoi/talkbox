export const AGENT_ADAPTER_CONTRACT = {
  send: 'send(message, options) -> Promise<{ text, raw }>',
  onEvent: 'onEvent(callback) -> unsubscribe function',
  isReady: 'isReady() -> Promise<boolean>',
};

export class AgentAdapter {
  constructor({ name = 'agent' } = {}) {
    this.name = name;
  }

  async send() {
    throw new Error(`${this.name} adapter must implement send(message, options)`);
  }

  onEvent() {
    return () => {};
  }

  async isReady() {
    return true;
  }
}
