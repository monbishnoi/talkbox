import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createTalkBoxServer, formatForVoice } from '../src/orchestrator.js';

async function startServer(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

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

test('browser UI exposes provider-neutral runtime controls', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

  assert.match(html, /Talk Box Runtime/);
  assert.match(html, /id="runtimeStt"/);
  assert.match(html, /id="runtimeTts"/);
  assert.match(html, /id="runtimeInput"/);
  assert.match(html, /id="talkToCalButton"/);
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
  assert.match(html, /Experimental Hume adapter/);
});
