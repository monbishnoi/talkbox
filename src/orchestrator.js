import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { getConfig } from './config.js';
import { parseRequest, withVoiceContext } from './adapters/hume-evi.js';
import { sendAgentMessage } from './adapters/agent/index.js';
import { describeSttProviders } from './adapters/stt/index.js';
import { describeTtsProviders } from './adapters/tts/index.js';
import { runVoiceTurn } from './runtime/voice-session.js';
import { formatForVoice } from './runtime/voice-renderer.js';
import { loadAgentPersona } from './runtime/agent-persona.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const PUBLIC_DIR = join(PROJECT_ROOT, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const debugEvents = [];
const debugClients = new Set();

function emitDebug(stage, detail = {}, requestId = null) {
  const event = {
    id: randomUUID(),
    requestId,
    stage,
    detail,
    timestamp: new Date().toISOString(),
  };

  debugEvents.push(event);
  while (debugEvents.length > 100) debugEvents.shift();

  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of debugClients) {
    client.write(data);
  }
}

function handleDebugEvents(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');

  for (const event of debugEvents) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  debugClients.add(res);
  req.on('close', () => debugClients.delete(res));
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

async function fetchHumeAccessToken(config) {
  if (!config.humeApiKey || !config.humeSecretKey) {
    throw new Error('Missing HUME_API_KEY or HUME_SECRET_KEY in .env');
  }

  const credentials = Buffer.from(`${config.humeApiKey}:${config.humeSecretKey}`).toString('base64');
  const response = await fetch('https://api.hume.ai/oauth2-cc/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(`Hume token request failed: HTTP ${response.status}`);
  }

  return {
    accessToken: payload.access_token,
    expiresIn: payload.expires_in || null,
    tokenType: payload.token_type || 'Bearer',
  };
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

async function readText(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw;
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function isAuthorized(req, config) {
  if (!config.talkBoxApiKey) return true;
  return req.headers.authorization === `Bearer ${config.talkBoxApiKey}`;
}

function writeSseHeaders(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
}

function writeSseChunk(res, chunk) {
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

function writeSseError(res, message) {
  res.write(`data: ${JSON.stringify({ error: { message } })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

export { formatForVoice };

function sendTextAsSingleSseDelta(res, text, hooks = {}) {
  hooks.onText?.(text);
  const id = `chatcmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  writeSseChunk(res, {
    id,
    object: 'chat.completion.chunk',
    created,
    model: 'talkbox-agent',
    choices: [{
      index: 0,
      delta: {
        role: 'assistant',
        content: text,
      },
      finish_reason: null,
    }],
  });
  writeSseChunk(res, {
    id,
    object: 'chat.completion.chunk',
    created,
    model: 'talkbox-agent',
    choices: [{
      index: 0,
      delta: {},
      finish_reason: 'stop',
    }],
  });
  res.write('data: [DONE]\n\n');
  res.end();
  hooks.onDone?.();
}

async function handleChatCompletions(req, res, config) {
  if (!isAuthorized(req, config)) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return;
  }

  let body;
  try {
    body = await readJson(req);
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON' });
    return;
  }

  const parsed = parseRequest(body, { emotionThreshold: config.emotionThreshold });
  if (!parsed.text) {
    sendJson(res, 400, { error: 'No user message found in request body' });
    return;
  }

  const textForAgent = withVoiceContext(parsed.text, parsed.emotion);
  const requestId = randomUUID();
  const startedAt = Date.now();
  const emotionLog = parsed.emotion
    ? ` emotion=${parsed.emotion.name}:${parsed.emotion.score.toFixed(2)}`
    : '';

  console.log(`[Talk Box] <- EVI text="${parsed.text.slice(0, 80)}"${emotionLog}`);
  emitDebug('talkbox.request.received', {
    textLength: parsed.text.length,
    preview: parsed.text.slice(0, 120),
    emotion: parsed.emotion,
  }, requestId);
  writeSseHeaders(res);
  emitDebug('talkbox.sse.opened', {}, requestId);

  try {
    emitDebug('agent.request.started', { adapter: config.agentAdapter, name: config.agentName }, requestId);
    const result = await sendAgentMessage(textForAgent, config, {
      contextId: config.agentContextId || 'talkbox',
    });

    console.log(`[Talk Box] -> ${config.agentName || 'Agent'} response ${result.text.length} chars`);
    const voiceText = formatForVoice(result.text);
    emitDebug('agent.response.received', {
      textLength: result.text.length,
      preview: result.text.slice(0, 160),
      elapsedMs: Date.now() - startedAt,
    }, requestId);
    emitDebug('talkbox.voice_text.prepared', {
      textLength: voiceText.length,
      removedChars: result.text.length - voiceText.length,
      preview: voiceText.slice(0, 160),
      elapsedMs: Date.now() - startedAt,
    }, requestId);

    sendTextAsSingleSseDelta(res, voiceText, {
      onText: (text) => emitDebug('talkbox.sse.full_text_sent', {
        textLength: text.length,
        elapsedMs: Date.now() - startedAt,
      }, requestId),
      onDone: () => emitDebug('talkbox.sse.done', {
        mode: 'openai_single_delta',
        elapsedMs: Date.now() - startedAt,
      }, requestId),
    });
  } catch (err) {
    console.error('[Talk Box] Agent request failed:', err.message);
    emitDebug('talkbox.error', {
      message: err.message,
      elapsedMs: Date.now() - startedAt,
    }, requestId);
    writeSseError(res, `Talkbox could not reach the agent: ${err.message}`);
  }
}

async function handleVoiceTurn(req, res, config) {
  if (!isAuthorized(req, config)) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return;
  }

  let body;
  try {
    body = await readJson(req);
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON' });
    return;
  }

  const requestId = body.turnId || randomUUID();
  emitDebug('voice.turn.received', {
    sttProvider: body.sttProvider || config.sttProvider,
    ttsProvider: body.ttsProvider || config.ttsProvider,
    hasTranscript: !!body.transcript,
    hasAudio: !!body.audioBase64,
  }, requestId);

  try {
    const result = await runVoiceTurn(body, config, {
      onEvent: (stage, detail) => emitDebug(stage, detail, requestId),
    });
    emitDebug('voice.turn.finished', {
      totalMs: result.timings.totalMs,
      cacheKey: result.cacheKey,
    }, requestId);
    sendJson(res, 200, result);
  } catch (err) {
    emitDebug('voice.turn.error', { message: err.message }, requestId);
    sendJson(res, 500, { error: err.message });
  }
}

function realtimeInstructions(config = {}) {
  const agentName = config.agentName || 'your agent';
  const agentPersona = loadAgentPersona(config);
  const instructions = [
    // === IDENTITY ===
    `You are ${agentName}'s voice. You are NOT ${agentName}'s brain.`,
    `The user should experience you as ${agentName} — not as a relay, wrapper, or separate assistant.`,
    `Never say you are "asking another system", "talking to ${agentName}", "relaying", or "waiting on ${agentName}". Internally, ask_agent is YOUR runtime — your memory, your tools, your knowledge. It is you.`,

    // === THE FUNDAMENTAL RULE ===
    'RULE: Call ask_agent for ALL user requests. This is your default behavior.',
    '',
    'You handle ONLY these directly (no ask_agent needed):',
    '- Greetings and goodbyes: "hi", "hey", "good morning", "bye", "talk later"',
    '- Acknowledgments: "okay", "got it", "thanks", "sure"',
    '- Requests about YOUR voice output: "say that again", "repeat that", "speak slower"',
    '- Ultra-trivial small talk the user initiates: "how are you?"',
    '',
    'EVERYTHING ELSE → ask_agent. No exceptions.',
    'If you are unsure whether something needs ask_agent → it does.',
    'You have NO knowledge of your own. No memory. No opinions about facts.',
    'Any claim about the world, about projects, about people — if it did not come from ask_agent, you are hallucinating. Do not do this.',

    // === PREAMBLE / COMMENTARY ===
    'When calling ask_agent, you MUST make the wait feel alive:',
    '- Before or as the tool call starts, speak one brief filler sentence.',
    '- Never stay silent for more than 2 seconds after deciding to use ask_agent.',
    '- Keep the filler natural, first-person, and under 10 words.',
    '- The filler is only conversation mechanics. It must not contain facts, answers, or conclusions.',
    '- Good fillers: "Let me check that.", "Pulling that up.", "Checking what we have.", "One sec, looking."',
    '- Do not say you are waiting on a tool, backend, system, runtime, Cal, or another brain.',
    '',
    'Examples:',
    '  User: "What meetings do I have tomorrow?"',
    '  You (immediately): "Checking your calendar for tomorrow..."',
    '  [ask_agent returns]',
    '  You: "You have three meetings. First one is at nine..."',
    '',
    '  User: "What did we decide about the voice architecture?"',
    '  You (immediately): "Let me pull that up..."',
    '  [ask_agent returns]',
    '  You: "So we decided on three pillars..."',
    '',
    '  User: "Can you look at the OpenAI docs on voice agents?"',
    '  You (immediately): "Checking the OpenAI developer docs..."',
    '  [ask_agent returns]',
    '  You: "They describe two architectures..."',

    // === HOW TO PACKAGE THE USER'S REQUEST ===
    'CRITICAL: When calling ask_agent, pass the user\'s words FAITHFULLY.',
    'You are hearing their voice directly. You have access to their pauses, emphasis, and phrasing.',
    'Clean up filler words (um, uh, like, you know) and fix obvious grammar.',
    'But PRESERVE their exact phrasing, specific names, technical terms, and sentence structure.',
    'Do NOT paraphrase. Do NOT summarize. Do NOT reinterpret.',
    'Do NOT add "the user wants to know..." or "what is the expected outcome."',
    'Send THEIR words, lightly polished. Not your interpretation of their words.',
    '',
    'Good: "Check the OpenAI docs on voice architectures and compare with what we built in Talkbox"',
    'Bad: "User is asking about OpenAI voice architecture documentation and how it relates to their project"',

    // === AFTER ask_agent RETURNS ===
    `After ask_agent returns, speak as ${agentName} using only the returned content.`,
    'If the response has multiple sections, give brief section handles: status, next steps, risks.',
    'Keep spoken answers concise unless the user asks for detail.',
    'Only mention "the full answer is in the chat" for genuinely long structured responses: tables, code, or lists with more than 5 items. Never say it for answers that fit in 2-3 spoken sentences.',
    'When the user interrupts you, stop speaking silently. Do not say "okay", "I am listening", "go ahead", or any other interruption acknowledgment. Just listen and answer the new input.',

    // === ERROR HANDLING ===
    'If ask_agent fails or times out, say you hit a temporary issue and ask the user to try again. Do not blame another system.',
  ];

  if (agentPersona) {
    instructions.push(
      '',
      '=== PERSONA ===',
      'Use this personality context as your voice identity. Preserve the communication style, but do not recite this document:',
      agentPersona,
    );
  }

  return instructions.join('\n\n');
}

function askAgentTool(config = {}) {
  const agentName = config.agentName || 'the agent';
  return {
    type: 'function',
    name: 'ask_agent',
    description: `Your brain. Call this for ANY user request that is not a simple greeting or acknowledgment. This is where your knowledge, memory, tools, and reasoning live. Without this, you know nothing. When in doubt, call it.`,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        request: {
          type: 'string',
          description: 'The user\'s words, faithfully transcribed with light cleanup. Remove filler (um, uh) and fix grammar, but preserve their exact phrasing, names, and intent. Do NOT paraphrase or reinterpret. Pass their words through, not your summary.',
        },
        mode: {
          type: 'string',
          enum: ['status', 'answer', 'summary', 'action', 'other'],
          description: 'The kind of response needed: status (checking state), answer (factual question), summary (condense info), action (do something), other.',
        },
      },
      required: ['request', 'mode'],
    },
  };
}

async function handleRealtimeSession(req, res, config) {
  if (!isAuthorized(req, config)) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return;
  }
  if (!config.openaiApiKey) {
    sendJson(res, 500, { error: 'Missing OPENAI_API_KEY in .env' });
    return;
  }

  const offer = await readText(req);
  if (!offer.trim()) {
    sendJson(res, 400, { error: 'Missing WebRTC SDP offer' });
    return;
  }

  const session = {
    type: 'realtime',
    model: config.openaiRealtimeModel,
    instructions: realtimeInstructions(config),
    audio: {
      output: {
        voice: config.openaiRealtimeVoice,
      },
    },
    tools: [askAgentTool(config)],
    tool_choice: 'auto',
  };

  const form = new FormData();
  form.set('sdp', offer);
  form.set('session', JSON.stringify(session));

  const startedAt = Date.now();
  const response = await fetch('https://api.openai.com/v1/realtime/calls', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
    },
    body: form,
  });

  const answer = await response.text();
  if (!response.ok) {
    sendJson(res, response.status, {
      error: `OpenAI Realtime session failed: ${answer.slice(0, 500)}`,
    });
    return;
  }

  emitDebug('realtime.session.created', {
    model: config.openaiRealtimeModel,
    elapsedMs: Date.now() - startedAt,
  });
  res.writeHead(200, {
    'Content-Type': 'application/sdp',
    'Cache-Control': 'no-store',
  });
  res.end(answer);
}

async function handleRealtimeAskAgent(req, res, config) {
  if (!isAuthorized(req, config)) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return;
  }

  let body;
  try {
    body = await readJson(req);
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON' });
    return;
  }

  const request = String(body.request || '').trim();
  const mode = String(body.mode || 'answer').trim();
  if (!request) {
    sendJson(res, 400, { error: 'Missing request' });
    return;
  }

  const requestId = body.turnId || randomUUID();
  const startedAt = Date.now();
  emitDebug('realtime.ask_agent.started', { mode, preview: request.slice(0, 160) }, requestId);

  try {
    const agentResult = await sendAgentMessage(request, config, {
      contextId: body.contextId || config.agentContextId || 'talkbox-realtime',
      timeoutMs: config.agentTimeoutMs,
    });
    const elapsedMs = Date.now() - startedAt;
    emitDebug('realtime.ask_agent.finished', {
      elapsedMs,
      textLength: agentResult.text.length,
    }, requestId);
    sendJson(res, 200, {
      ok: true,
      mode,
      elapsedMs,
      agentText: agentResult.text,
      calText: agentResult.text,
      instruction: 'Use only this agent answer for the spoken response. Do not add new facts. Mention the full chat answer only for tables, code, or lists with more than 5 items.',
    });
  } catch (err) {
    emitDebug('realtime.ask_agent.error', {
      elapsedMs: Date.now() - startedAt,
      message: err.message,
    }, requestId);
    sendJson(res, 500, { error: err.message });
  }
}

function serveStatic(req, res, pathname) {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR) || !existsSync(filePath)) {
    sendText(res, 404, 'Not found');
    return;
  }

  const ext = extname(filePath);
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  createReadStream(filePath).pipe(res);
}

export function createTalkBoxServer(config = getConfig()) {
  return createServer(async (req, res) => {
    setCors(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/health' && req.method === 'GET') {
      sendJson(res, 200, {
        status: 'ok',
        service: 'talkbox',
        agentAdapter: config.agentAdapter,
        agentName: config.agentName,
        agentEndpoint: config.agentEndpoint,
      });
      return;
    }

    if (url.pathname === '/debug/events' && req.method === 'GET') {
      handleDebugEvents(req, res);
      return;
    }

    if (url.pathname === '/config' && req.method === 'GET') {
      sendJson(res, 200, {
        devOnly: true,
        hasHumeApiKey: !!config.humeApiKey,
        hasHumeSecretKey: !!config.humeSecretKey,
        humeConfigId: config.humeConfigId,
        hasTalkBoxApiKey: !!config.talkBoxApiKey,
        sttProvider: config.sttProvider,
        ttsProvider: config.ttsProvider,
        openaiConfigured: !!config.openaiApiKey,
        openaiRealtimeModel: config.openaiRealtimeModel,
        openaiRealtimeVoice: config.openaiRealtimeVoice,
        agentAdapter: config.agentAdapter,
        agentName: config.agentName,
        agentEndpoint: config.agentEndpoint,
        deepgramConfigured: !!config.deepgramApiKey,
        commandSttConfigured: !!config.commandSttCommand,
        commandTtsConfigured: !!config.commandTtsCommand,
      });
      return;
    }

    if (url.pathname === '/providers' && req.method === 'GET') {
      sendJson(res, 200, {
        active: {
          sttProvider: config.sttProvider,
          ttsProvider: config.ttsProvider,
        },
        stt: describeSttProviders(config),
        tts: describeTtsProviders(config),
      });
      return;
    }

    if (url.pathname === '/hume-token' && req.method === 'GET') {
      try {
        sendJson(res, 200, await fetchHumeAccessToken(config));
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return;
    }

    if (url.pathname === '/chat/completions' && req.method === 'POST') {
      await handleChatCompletions(req, res, config);
      return;
    }

    if (url.pathname === '/voice/turn' && req.method === 'POST') {
      await handleVoiceTurn(req, res, config);
      return;
    }

    if (url.pathname === '/realtime/session' && req.method === 'POST') {
      await handleRealtimeSession(req, res, config);
      return;
    }

    if ((url.pathname === '/realtime/ask-agent' || url.pathname === '/realtime/ask-cal') && req.method === 'POST') {
      await handleRealtimeAskAgent(req, res, config);
      return;
    }

    if (req.method === 'GET') {
      serveStatic(req, res, url.pathname);
      return;
    }

    sendJson(res, 405, { error: 'Method not allowed' });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = getConfig();
  const server = createTalkBoxServer(config);
  server.on('error', (err) => {
    console.error(`[Talk Box] failed to listen on ${config.host}:${config.port}: ${err.message}`);
    process.exitCode = 1;
  });
  server.listen(config.port, config.host, () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : config.port;
    console.log(`[Talk Box] listening on http://${config.host}:${port}`);
    console.log(`[Talk Box] Agent adapter: ${config.agentAdapter}`);
    console.log(`[Talk Box] Agent endpoint: ${config.agentEndpoint}`);
    console.log('[Talk Box] DEV-ONLY /hume-token mints browser access tokens for local testing.');
  });
}
