import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { getConfig } from '../src/config.js';
import {
  createTalkBoxServer,
  fetchWithConnectRetry,
  formatForVoice,
  realtimeInstructions,
} from '../src/orchestrator.js';
import { buildProgressNarrationInstruction } from '../src/runtime/progress-narrator.js';
import { createCalAgentAdapter } from '../src/adapters/agent/cal.js';

async function startServer(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

test('Realtime setup retries one safe pre-connection timeout', async () => {
  let calls = 0;
  const expected = { ok: true };
  const result = await fetchWithConnectRetry('https://api.openai.com/v1/realtime/calls', {}, {
    retryDelayMs: 0,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        throw new TypeError('fetch failed', {
          cause: { code: 'UND_ERR_CONNECT_TIMEOUT' },
        });
      }
      return expected;
    },
  });

  assert.equal(result, expected);
  assert.equal(calls, 2);
});

test('formatForVoice strips markdown that sounds bad in TTS', () => {
  const formatted = formatForVoice(`
## Talk Box: Where It Stands

### Actual Code
| What | Status |
|------|--------|
| \`src/orchestrator.js\` | ✅ Core server |

- **Next:** \`npm start\` → open browser.
`);

  assert.match(formatted, /Talk Box: Where It Stands/);
  assert.match(formatted, /Actual Code/);
  assert.match(formatted, /src\/orchestrator\.js/);
  assert.match(formatted, /done Core server/);
  assert.match(formatted, /npm start to open browser/);
  assert.doesNotMatch(formatted, /What/);
  assert.doesNotMatch(formatted, /Status/);
  assert.doesNotMatch(formatted, /##/);
  assert.doesNotMatch(formatted, /\|/);
  assert.doesNotMatch(formatted, /`/);
  assert.doesNotMatch(formatted, /\*\*/);
});

test('config preserves legacy Cal environment aliases', () => {
  const keys = [
    'AGENT_ADAPTER',
    'AGENT_ENDPOINT',
    'AGENT_NAME',
    'AGENT_VOICE_PERSONA_PATH',
    'AGENT_VOICE_PERSONA_MAX_CHARS',
    'VOICE_USER_NAME',
    'CAL_ENDPOINT',
    'CAL_VOICE_PERSONA_PATH',
    'CAL_VOICE_PERSONA_MAX_CHARS',
    'OPENAI_REALTIME_TRANSCRIPTION_MODEL',
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

  try {
    for (const key of keys) delete process.env[key];
    process.env.CAL_ENDPOINT = 'http://127.0.0.1:8080/';
    process.env.CAL_VOICE_PERSONA_PATH = '/tmp/CAL.md';
    process.env.CAL_VOICE_PERSONA_MAX_CHARS = '3200';
    process.env.VOICE_USER_NAME = 'Taylor';

    const config = getConfig();

    assert.equal(config.agentAdapter, 'cal');
    assert.equal(config.agentEndpoint, 'http://127.0.0.1:8080');
    assert.equal(config.agentName, 'Cal');
    assert.equal(config.agentVoicePersonaPath, '/tmp/CAL.md');
    assert.equal(config.agentVoicePersonaMaxChars, 3200);
    assert.equal(config.voiceUserName, 'Taylor');
    assert.equal(config.openaiRealtimeTranscriptionModel, 'gpt-4o-mini-transcribe');
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  }
});

test('Realtime instructions inject the four voice context layers without overlap', () => {
  const instructions = realtimeInstructions({
    agentName: 'Cal',
    agentVoicePersonaPath: '',
  }, {
    layers: {
      user: 'User-only profile detail.',
      startupMemory: 'Canonical active project memory.',
      conversationContext: {
        earlierSummary: 'Earlier decision summary.',
        recentMessages: [
          { role: 'user', content: 'Continue this strand.' },
          { role: 'assistant', content: 'Picking up from here.' },
        ],
      },
    },
  });

  assert.match(instructions, /=== USER ===[\s\S]*User-only profile detail/);
  assert.match(instructions, /=== STARTUP MEMORY ===[\s\S]*Canonical active project memory/);
  assert.match(instructions, /=== CONVERSATION CONTEXT ===[\s\S]*Earlier decision summary/);
  assert.match(instructions, /Recent conversation \(verbatim\):[\s\S]*User: Continue this strand/);
  assert.match(instructions, /Cal: Picking up from here/);
  assert.match(instructions, /Answer directly when the complete answer is already present/);
  assert.match(instructions, /Call ask_agent for new information, current state, lookups, actions, tools, missing context, or uncertainty/);
  assert.doesNotMatch(instructions, /Call ask_agent for ALL user requests/);
});

test('Cal adapter preserves voice channel metadata in A2A', async () => {
  let received = null;
  const calServer = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    received = JSON.parse(raw);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      jsonrpc: '2.0',
      id: received.id,
      result: {
        state: 'completed',
        artifacts: [{ parts: [{ kind: 'text', text: 'Voice-tagged answer' }] }],
      },
    }));
  });
  const endpoint = await startServer(calServer);

  try {
    const adapter = createCalAgentAdapter({ agentEndpoint: endpoint });
    const result = await adapter.send('Voice question', {
      contextId: 'strand-voice-test',
      metadata: { channel: 'voice', voiceSessionId: 'voice-session-test' },
    });
    assert.equal(result.text, 'Voice-tagged answer');
    assert.equal(received.params.contextId, 'strand-voice-test');
    assert.deepEqual(received.params.metadata, {
      channel: 'voice',
      voiceSessionId: 'voice-session-test',
    });
  } finally {
    calServer.close();
  }
});

test('orchestrator returns OpenAI SSE from a mocked generic agent response', async () => {
  const agentServer = createServer(async (req, res) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/chat');

    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    assert.match(body.message, /What time is it\?/);
    assert.match(body.text, /What time is it\?/);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ text: 'It is test time.' }));
  });
  const agentEndpoint = `${await startServer(agentServer)}/chat`;

  const talkBoxServer = createTalkBoxServer({
    agentEndpoint,
    agentAdapter: 'http',
    agentName: 'TestAgent',
    emotionThreshold: 0.5,
    humeApiKey: 'dev',
    humeConfigId: 'config',
    talkBoxApiKey: '',
  });
  const talkBoxEndpoint = await startServer(talkBoxServer);

  try {
    const response = await fetch(`${talkBoxEndpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stream: true,
        messages: [{ role: 'user', content: 'What time is it?' }],
      }),
    });

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/event-stream/);

    const body = await response.text();
    assert.match(body, /data: /);
    assert.match(body, /It is test time\./);
    assert.match(body, /"object":"chat\.completion\.chunk"/);
    assert.match(body, /"model":"talkbox-agent"/);
    assert.match(body, /"role":"assistant"/);
    assert.match(body, /"finish_reason":"stop"/);
    assert.match(body, /data: \[DONE\]/);
  } finally {
    talkBoxServer.close();
    agentServer.close();
  }
});

test('orchestrator publishes debug events for a chat request', async () => {
  const agentServer = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    JSON.parse(raw);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ text: 'Debug path ok.' }));
  });
  const agentEndpoint = `${await startServer(agentServer)}/chat`;

  const talkBoxServer = createTalkBoxServer({
    agentEndpoint,
    agentAdapter: 'http',
    agentName: 'TestAgent',
    emotionThreshold: 0.5,
    humeApiKey: 'dev',
    humeSecretKey: 'secret',
    humeConfigId: 'config',
    talkBoxApiKey: '',
  });
  const talkBoxEndpoint = await startServer(talkBoxServer);

  try {
    const debugResponse = await fetch(`${talkBoxEndpoint}/debug/events`);
    assert.equal(debugResponse.status, 200);
    assert.match(debugResponse.headers.get('content-type'), /text\/event-stream/);

    const reader = debugResponse.body.getReader();
    const decoder = new TextDecoder();
    let debugBody = '';
    const debugDone = (async () => {
      while (!debugBody.includes('talkbox.sse.done')) {
        const { value, done } = await reader.read();
        if (done) break;
        debugBody += decoder.decode(value, { stream: true });
      }
      await reader.cancel();
      return debugBody;
    })();

    const response = await fetch(`${talkBoxEndpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stream: true,
        messages: [{ role: 'user', content: 'Debug this path.' }],
      }),
    });
    assert.equal(response.status, 200);
    await response.text();

    const events = await debugDone;
    assert.match(events, /talkbox\.request\.received/);
    assert.match(events, /agent\.request\.started/);
    assert.match(events, /agent\.response\.received/);
    assert.match(events, /talkbox\.sse\.full_text_sent/);
    assert.match(events, /talkbox\.sse\.done/);
    assert.match(events, /openai_single_delta/);
  } finally {
    talkBoxServer.close();
    agentServer.close();
  }
});

test('voice turn endpoint runs provider-neutral path with timings', async () => {
  const agentServer = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    JSON.parse(raw);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      text: [
        '## Test answer',
        '**Important principle:** The backend agent is the brain.',
        '- Talk Box handles voice mechanics.',
      ].join('\n'),
    }));
  });
  const agentEndpoint = `${await startServer(agentServer)}/chat`;

  const talkBoxServer = createTalkBoxServer({
    agentEndpoint,
    agentAdapter: 'http',
    agentName: 'TestAgent',
    sttProvider: 'transcript',
    ttsProvider: 'silent',
    emotionThreshold: 0.5,
    talkBoxApiKey: '',
  });
  const talkBoxEndpoint = await startServer(talkBoxServer);

  try {
    const providersResponse = await fetch(`${talkBoxEndpoint}/providers`);
    assert.equal(providersResponse.status, 200);
    const providers = await providersResponse.json();
    assert.equal(providers.active.sttProvider, 'transcript');
    assert.equal(providers.active.ttsProvider, 'silent');

    const response = await fetch(`${talkBoxEndpoint}/voice/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript: 'Explain the current architecture.',
        sttProvider: 'transcript',
        ttsProvider: 'silent',
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();

    assert.equal(payload.transcript, 'Explain the current architecture.');
    assert.match(payload.agentText, /backend agent is the brain/);
    assert.match(payload.spoken, /backend agent is the brain/);
    assert.equal(payload.audio.provider, 'silent');
    assert.ok(payload.cacheKey);
    assert.ok(payload.timings.stt_finishedMs >= 0);
    assert.ok(payload.timings.cal_response_finishedMs >= 0);
    assert.ok(payload.timings.voice_render_finishedMs >= 0);
    assert.ok(payload.timings.tts_finishedMs >= 0);
  } finally {
    talkBoxServer.close();
    agentServer.close();
  }
});

test('progress narrator builds calm commentator realtime instructions', () => {
  const result = buildProgressNarrationInstruction({
    event: {
      tool: 'bash',
      description: 'Search local files for "maybeNarrateVoiceStep"',
      inputSummary: { commandPreview: 'rg -n "maybeNarrateVoiceStep" clients/pwa/index.html' },
    },
    recentActivities: [
      { description: 'Run the test suite' },
      { description: 'Check service health' },
    ],
  }, {
    agentName: 'Cal',
    progressNarrationStyle: 'calm-commentator',
  });

  assert.equal(result.shouldNarrate, true);
  assert.equal(result.activity.description, 'Search local files for "maybeNarrateVoiceStep"');
  assert.match(result.instructions, /calm game commentator/);
  assert.match(result.instructions, /Paint a quick mental picture/);
  assert.match(result.instructions, /Current activity: Search local files/);
  assert.match(result.instructions, /Recent activity context: Run the test suite \| Check service health/);
  assert.doesNotMatch(result.instructions, /Say exactly this brief progress update/);
  assert.doesNotMatch(result.instructions, /I’m running a shell check/);
});

test('Realtime progress endpoint returns reusable narration policy', async () => {
  const talkBoxServer = createTalkBoxServer({
    agentEndpoint: 'http://127.0.0.1:1/chat',
    agentAdapter: 'http',
    agentName: 'TestAgent',
    progressNarrationEnabled: true,
    progressNarrationStyle: 'calm-commentator',
    talkBoxApiKey: '',
  });
  const talkBoxEndpoint = await startServer(talkBoxServer);

  try {
    const response = await fetch(`${talkBoxEndpoint}/realtime/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: {
          tool: 'calendar_read',
          description: 'Calendar read: tomorrow',
        },
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.shouldNarrate, true);
    assert.match(payload.instructions, /TestAgent/);
    assert.match(payload.instructions, /calm game commentator/);
    assert.match(payload.instructions, /Calendar read: tomorrow/);
  } finally {
    talkBoxServer.close();
  }
});

test('history endpoint proxies recent agent chat history', async () => {
  const agentServer = createServer(async (req, res) => {
    assert.equal(req.method, 'GET');
    assert.equal(req.url, '/api/chat/history?limit=4');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      sessionId: 'session-test',
      messageCount: 2,
      lastActivity: 1720612345000,
      messages: [
        { role: 'user', content: 'Where were we?', timestamp: '2026-07-10T17:23:00.000Z' },
        { role: 'assistant', content: 'We were wiring voice hydration.', timestamp: '2026-07-10T17:24:00.000Z' },
      ],
    }));
  });
  const agentEndpoint = await startServer(agentServer);

  const talkBoxServer = createTalkBoxServer({
    agentEndpoint,
    agentAdapter: 'cal',
    agentName: 'Cal',
    talkBoxApiKey: '',
  });
  const talkBoxEndpoint = await startServer(talkBoxServer);

  try {
    const response = await fetch(`${talkBoxEndpoint}/api/history`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.sessionId, 'session-test');
    assert.equal(payload.messageCount, 2);
    assert.equal(payload.messages.length, 2);
    assert.equal(payload.messages[0].role, 'user');
    assert.equal(payload.messages[1].content, 'We were wiring voice hydration.');
  } finally {
    talkBoxServer.close();
    agentServer.close();
  }
});

test('history endpoint forwards the bound Cal session ID', async () => {
  const agentServer = createServer(async (req, res) => {
    assert.equal(req.method, 'GET');
    assert.equal(req.url, '/api/chat/history?limit=7&sessionId=strand-voice-test');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      sessionId: 'strand-voice-test',
      messages: [{ role: 'user', content: 'Strand context' }],
    }));
  });
  const agentEndpoint = await startServer(agentServer);
  const talkBoxServer = createTalkBoxServer({
    agentEndpoint,
    agentAdapter: 'cal',
    agentName: 'Cal',
    talkBoxApiKey: '',
  });
  const talkBoxEndpoint = await startServer(talkBoxServer);

  try {
    const response = await fetch(`${talkBoxEndpoint}/api/history?limit=7&sessionId=strand-voice-test`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.sessionId, 'strand-voice-test');
    assert.equal(payload.messages[0].content, 'Strand context');
  } finally {
    talkBoxServer.close();
    agentServer.close();
  }
});

test('history endpoint degrades to empty messages when agent history fails', async () => {
  const agentServer = createServer(async (_req, res) => {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'down' }));
  });
  const agentEndpoint = await startServer(agentServer);

  const talkBoxServer = createTalkBoxServer({
    agentEndpoint,
    agentAdapter: 'cal',
    agentName: 'Cal',
    talkBoxApiKey: '',
  });
  const talkBoxEndpoint = await startServer(talkBoxServer);

  try {
    const response = await fetch(`${talkBoxEndpoint}/api/history`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { messages: [] });
  } finally {
    talkBoxServer.close();
    agentServer.close();
  }
});

test('browser UI exposes provider-neutral runtime controls', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

  assert.match(html, /Talk Box Runtime/);
  assert.match(html, /id="runtimeStt"/);
  assert.match(html, /id="runtimeTts"/);
  assert.match(html, /id="runtimeInput"/);
  assert.match(html, /id="talkToCalButton"/);
  assert.match(html, /id="voiceVisualizer"/);
  assert.match(html, /\.voice-visualizer \{/);
  assert.match(html, /width: min\(168px, 52vw\);/);
  assert.match(html, /margin: 16px auto 0;/);
  assert.match(html, /startVoiceVisualizer\(realtimeStream\);/);
  assert.match(html, /startVoiceVisualizer\(runtimeStream\);/);
  assert.match(html, /requestRealtimePreamble\(request, mode, call\.call_id\);/);
  assert.match(html, /hydrateRealtimeSession/);
  assert.match(html, /\/api\/history/);
  assert.match(html, /realtime\.hydration\.injected/);
  assert.match(html, /type: 'conversation\.item\.create'/);
  assert.match(html, /type: msg\.role === 'user' \? 'input_text' : 'text'/);
  assert.match(html, /const maxTotal = 8000/);
  assert.match(html, /const maxPerMessage = 2000/);
  assert.match(html, /void hydrateRealtimeSession\(\)\.then\(\(\) => sendSessionOpenNudge\(\)\);/);
  const hydrationSource = html.match(/async function hydrateRealtimeSession\(\) \{[\s\S]+?\n      \}/)?.[0] || '';
  assert.doesNotMatch(hydrationSource, /response\.create/);
  assert.match(html, /queueRealtimeFunctionCall/);
  assert.match(html, /drainQueuedRealtimeFunctionCall/);
  assert.match(html, /if \(await drainQueuedRealtimeFunctionCall\(\)\) return;/);
  assert.match(html, /handleAudioStopped\(event\.response_id\)/);
  assert.match(html, /\|\| hasRealtimeGreeted\) return;/);
  assert.match(html, /hasRealtimeGreeted = true;[\s\S]*phase: 'session_open'/);
  assert.match(html, /voiceUserName/);
  assert.match(html, /Start directly with the first substantive new information/);
  assert.match(html, /tool_choice: 'none'/);
  assert.match(html, /Keep the spoken response concise unless the user asked for detail/);
  assert.match(html, /tables, code, or lists with more than 5 items/);
  assert.match(html, /Do not say "okay, I am listening" or "go ahead"/);
  assert.match(html, /Start Talking/);
  assert.match(html, /agent/);
  assert.match(html, /Experiment History/);
  assert.match(html, /Benchmark Comparison/);
  assert.match(html, /Test 1: Hume EVI/);
  assert.match(html, /Test 3:<\/strong> Deepgram STT -> agent -> Piper TTS/);
  assert.match(html, /Test 4:<\/strong> OpenAI Realtime voice brain -> agent/);
  assert.match(html, /Recommended/);
  assert.match(html, /id="recordSampleButton"/);
  assert.match(html, /id="audioFileInput"/);
  assert.match(html, /id="downloadSampleLink"/);
  assert.match(html, /id="sendRuntimeButton"/);
  assert.match(html, /\/voice\/turn/);
  assert.match(html, /\/providers/);
  assert.match(html, /Test 4: Realtime voice brain/);
  assert.match(html, /id="connectRealtimeButton"/);
  assert.match(html, /id="realtimeCalAnswer"/);
  assert.match(html, /\/realtime\/session/);
  assert.match(html, /\/realtime\/ask-agent/);
  assert.match(html, /\/realtime\/progress/);
  assert.match(html, /Experimental Hume adapter/);
});

test('Realtime voice instructions enforce filler, chat mention bounds, and silent interruption', async () => {
  const source = await readFile(new URL('../src/orchestrator.js', import.meta.url), 'utf8');
  const persona = await readFile(new URL('../personas/cal-voice.md', import.meta.url), 'utf8');

  assert.match(source, /Never stay silent for more than 2 seconds/);
  assert.match(source, /Keep spoken answers concise unless the user asks for detail/);
  assert.match(source, /tables, code, or lists with more than 5 items/);
  assert.match(source, /stop speaking silently/);
  assert.match(source, /transcription:\s*\{[\s\S]*model: config\.openaiRealtimeTranscriptionModel/);
  assert.match(source, /metadata:\s*\{[\s\S]*channel: body\.channel === 'voice' \? 'voice'/);
  assert.doesNotMatch(source, /You are NOT a text-to-speech reader/);
  assert.doesNotMatch(source, /Do not read it word-for-word/);
  assert.doesNotMatch(source, /Default spoken length: 2-3 sentences/);
  assert.doesNotMatch(source, /Mention that the full answer is visible in the chat if you summarize/);

  assert.match(persona, /stop silently/);
  assert.match(persona, /unless the response is a table, code, or a list with more than five items/);
  assert.doesNotMatch(persona, /Not a reader/);
});
