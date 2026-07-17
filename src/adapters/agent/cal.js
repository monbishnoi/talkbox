import { randomUUID } from 'node:crypto';
import { AgentAdapter } from './interface.js';
import { extractAgentText } from './http.js';

function buildA2ARequest(text, contextId, metadata = undefined) {
  return {
    jsonrpc: '2.0',
    id: `talkbox-${randomUUID()}`,
    method: 'message/send',
    params: {
      contextId,
      metadata,
      message: {
        role: 'user',
        parts: [{ kind: 'text', text }],
      },
    },
  };
}

export function extractCalText(payload) {
  if (!payload || typeof payload !== 'object') return '';

  if (payload.error?.message) {
    throw new Error(payload.error.message);
  }

  if (payload.result?.state === 'failed') {
    throw new Error(payload.result?.error?.message || 'Cal returned failed state');
  }

  return extractAgentText(payload);
}

export class CalAgentAdapter extends AgentAdapter {
  constructor(config = {}) {
    super({ name: 'Cal' });
    this.endpoint = String(config.agentEndpoint || 'http://localhost:8080').replace(/\/+$/, '');
    this.timeoutMs = config.agentTimeoutMs || 300_000;
  }

  async send(message, options = {}) {
    const contextId = options.contextId || 'talkbox-cal';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || this.timeoutMs);

    try {
      const response = await fetch(`${this.endpoint}/api/chat/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildA2ARequest(message, contextId, options.metadata)),
        signal: controller.signal,
      });

      const raw = await response.text();
      if (!response.ok) {
        throw new Error(`Cal HTTP ${response.status}: ${raw.slice(0, 300)}`);
      }

      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new Error(`Cal returned non-JSON response: ${raw.slice(0, 300)}`);
      }

      const text = extractCalText(payload);
      if (!text) {
        throw new Error('Cal response did not contain text');
      }

      return { text, raw: payload };
    } finally {
      clearTimeout(timeout);
    }
  }

  async isReady() {
    try {
      const response = await fetch(`${this.endpoint}/health`, { signal: AbortSignal.timeout(1500) });
      return response.ok;
    } catch {
      return false;
    }
  }
}

export function createCalAgentAdapter(config = {}) {
  return new CalAgentAdapter(config);
}

export async function sendMessage(text, options = {}) {
  const adapter = createCalAgentAdapter({
    agentEndpoint: options.agentEndpoint || options.endpoint,
    agentTimeoutMs: options.timeoutMs,
  });
  return adapter.send(text, options);
}
