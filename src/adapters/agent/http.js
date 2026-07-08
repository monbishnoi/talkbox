import { AgentAdapter } from './interface.js';

export function extractAgentText(payload) {
  if (!payload || typeof payload !== 'object') return '';

  if (payload.error?.message) {
    throw new Error(payload.error.message);
  }

  const direct = [
    payload.text,
    payload.message,
    payload.response,
    payload.answer,
    payload.output,
    payload.content,
  ].find((value) => typeof value === 'string' && value.trim());
  if (direct) return direct.trim();

  if (typeof payload.result === 'string') return payload.result.trim();
  if (typeof payload.result?.text === 'string') return payload.result.text.trim();
  if (typeof payload.result?.message === 'string') return payload.result.message.trim();
  if (typeof payload.result?.response === 'string') return payload.result.response.trim();

  const artifacts = payload?.result?.artifacts;
  if (Array.isArray(artifacts)) {
    const artifactText = artifacts
      .flatMap((artifact) => artifact?.parts || [])
      .filter((part) => part?.kind === 'text' || part?.type === 'text' || typeof part?.text === 'string')
      .map((part) => part.text)
      .filter(Boolean)
      .join('\n')
      .trim();
    if (artifactText) return artifactText;
  }

  return '';
}

export class HttpAgentAdapter extends AgentAdapter {
  constructor(config = {}) {
    super({ name: config.agentName || 'agent' });
    this.endpoint = String(config.agentEndpoint || 'http://localhost:8080/chat').replace(/\/+$/, '');
    this.timeoutMs = config.agentTimeoutMs || 120_000;
  }

  async send(message, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || this.timeoutMs);

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        body: JSON.stringify({
          message,
          text: message,
          contextId: options.contextId,
          metadata: options.metadata || {},
        }),
        signal: controller.signal,
      });

      const raw = await response.text();
      if (!response.ok) {
        throw new Error(`Agent HTTP ${response.status}: ${raw.slice(0, 300)}`);
      }

      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        const text = raw.trim();
        if (!text) throw new Error('Agent returned an empty response');
        return { text, raw };
      }

      const text = extractAgentText(payload);
      if (!text) {
        throw new Error('Agent response did not contain text');
      }

      return { text, raw: payload };
    } finally {
      clearTimeout(timeout);
    }
  }

  async isReady() {
    try {
      const healthUrl = new URL(this.endpoint);
      healthUrl.pathname = '/health';
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1500) });
      return response.ok;
    } catch {
      return false;
    }
  }
}

export function createHttpAgentAdapter(config = {}) {
  return new HttpAgentAdapter(config);
}
