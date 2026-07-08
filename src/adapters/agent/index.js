import { createHttpAgentAdapter } from './http.js';
import { createCalAgentAdapter } from './cal.js';

export function createAgentAdapter(config = {}) {
  const adapterName = String(config.agentAdapter || 'http').toLowerCase();

  if (adapterName === 'cal') {
    return createCalAgentAdapter(config);
  }

  if (adapterName === 'http' || adapterName === 'generic-http') {
    return createHttpAgentAdapter(config);
  }

  throw new Error(`Unknown agent adapter: ${adapterName}`);
}

export async function sendAgentMessage(message, config = {}, options = {}) {
  const adapter = createAgentAdapter(config);
  return adapter.send(message, {
    contextId: options.contextId || config.agentContextId || config.contextId || 'talkbox',
    timeoutMs: options.timeoutMs || config.agentTimeoutMs,
    metadata: options.metadata,
    headers: options.headers,
  });
}
