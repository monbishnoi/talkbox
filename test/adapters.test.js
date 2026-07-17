import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRequest, withVoiceContext } from '../src/adapters/hume-evi.js';
import { extractCalText } from '../src/adapters/agent/cal.js';
import { extractAgentText } from '../src/adapters/agent/http.js';
import { createSttAdapter, describeSttProviders } from '../src/adapters/stt/index.js';
import { createTtsAdapter, describeTtsProviders } from '../src/adapters/tts/index.js';
import { extractAgentPersona } from '../src/runtime/agent-persona.js';
import { renderSpokenResponse } from '../src/runtime/voice-renderer.js';

test('parseRequest extracts the last user message', () => {
  const result = parseRequest({
    messages: [
      { role: 'system', content: 'ignore' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: [{ type: 'text', text: 'second' }] },
    ],
  });

  assert.equal(result.text, 'second');
});

test('parseRequest applies emotion threshold', () => {
  const result = parseRequest({
    messages: [{ role: 'user', content: 'What is next?' }],
    metadata: { prosody: { curious: 0.8, calm: 0.3 } },
  }, { emotionThreshold: 0.5 });

  assert.deepEqual(result.emotion, { name: 'curious', score: 0.8 });
  assert.equal(withVoiceContext(result.text, result.emotion), '[VOICE CONTEXT: curious, 0.80]\nWhat is next?');
});

test('parseRequest ignores weak emotion signal', () => {
  const result = parseRequest({
    messages: [{ role: 'user', content: 'What is next?' }],
    metadata: { prosody: { curious: 0.49 } },
  }, { emotionThreshold: 0.5 });

  assert.equal(result.emotion, null);
  assert.equal(withVoiceContext(result.text, result.emotion), 'What is next?');
});

test('extractCalText reads A2A artifacts', () => {
  const text = extractCalText({
    result: {
      state: 'completed',
      artifacts: [
        { parts: [{ kind: 'text', text: 'Hello from Cal' }] },
      ],
    },
  });

  assert.equal(text, 'Hello from Cal');
});

test('extractCalText supports direct response fallback', () => {
  assert.equal(extractCalText({ message: 'Direct Cal response' }), 'Direct Cal response');
});

test('extractAgentText supports common generic HTTP response shapes', () => {
  assert.equal(extractAgentText({ text: 'Direct agent response' }), 'Direct agent response');
  assert.equal(extractAgentText({ result: { response: 'Nested agent response' } }), 'Nested agent response');
});

test('STT and TTS provider registries expose swappable adapters', async () => {
  const stt = createSttAdapter('transcript');
  const transcript = await stt.transcribe({ transcript: 'Clean final user turn.' });
  assert.equal(transcript.text, 'Clean final user turn.');

  const tts = createTtsAdapter('silent');
  const audio = await tts.synthesize('Short spoken answer.');
  assert.equal(audio.provider, 'silent');
  assert.equal(audio.bytes, 0);

  const sttProviders = describeSttProviders({ deepgramApiKey: 'key', commandSttCommand: 'sherpa {audio}' });
  assert.equal(sttProviders.find((provider) => provider.name === 'deepgram').available, true);
  assert.equal(sttProviders.find((provider) => provider.name === 'sherpa').available, true);

  const nodeSherpaProviders = describeSttProviders({ sherpaSttConfigJson: '{"model":{}}' });
  assert.equal(nodeSherpaProviders.find((provider) => provider.name === 'sherpa').available, true);

  const ttsProviders = describeTtsProviders({
    deepgramApiKey: 'key',
    commandTtsCommand: 'say -o {output} {text}',
    piperHttpEndpoint: 'http://127.0.0.1:8092',
  });
  assert.equal(ttsProviders.find((provider) => provider.name === 'deepgram').available, true);
  assert.equal(ttsProviders.find((provider) => provider.name === 'piper-http').available, true);
  assert.equal(ttsProviders.find((provider) => provider.name === 'say').available, true);
});

test('spoken renderer preserves important text while trimming markdown noise', () => {
  const rendered = renderSpokenResponse(`
## Architecture Decision

**Important principle:** Talk Box manages conversation mechanics, but does not invent task answers.

| What | Status |
|------|--------|
| Agent | Brain |

More detail follows.
`, { mode: 'brief' });

  assert.match(rendered.spoken, /Architecture Decision/);
  assert.match(rendered.spoken, /Important principle/);
  assert.doesNotMatch(rendered.spoken, /\|/);
  assert.deepEqual(rendered.followUps, ['Architecture Decision']);
});

test('spoken renderer removes operational agent footer from speech', () => {
  const rendered = renderSpokenResponse(`
All systems go.

---
Tip: Agent seems unresponsive. Type /reset to start a fresh session.
`);

  assert.equal(rendered.spoken, 'All systems go.');
  assert.match(rendered.fullText, /Tip: Agent seems unresponsive/);
});

test('agent persona extraction keeps voice-relevant identity sections bounded', () => {
  const persona = extractAgentPersona(`
## Identity

**Name:** Demo Agent
**Nature:** Thinking partner

## Session Startup

Do not put this coding-session startup section in voice.

## How I Communicate

- Signal, not noise.

## Completion Contract

Run drift checks.
`, { maxChars: 500 });

  assert.match(persona, /Name:\*\* Demo Agent/);
  assert.match(persona, /Signal, not noise/);
  assert.doesNotMatch(persona, /Session Startup/);
  assert.doesNotMatch(persona, /Completion Contract/);
});

test('generic agent persona extraction keeps voice-relevant sections bounded', () => {
  const persona = extractAgentPersona(`
## Identity

Name: Demo Agent

## Operational Details

Do not include this.

## Communication Style

Clear and direct.
`, { maxChars: 500 });

  assert.match(persona, /Demo Agent/);
  assert.match(persona, /Clear and direct/);
  assert.doesNotMatch(persona, /Operational Details/);
});

test('Cal voice persona extraction includes behavior but excludes user biography', () => {
  const persona = extractAgentPersona(`
## Identity

You are Cal, a thinking partner.

## About the User

Private biography that belongs in USER.md.

## Spoken Character

Conversational, direct, and brief.

## Voice Interaction Rules

If interrupted, stop silently.

## Avoid

Robotic process narration.

## Natural Examples

“The weak spot is the handoff.”
`, { maxChars: 1000 });

  assert.match(persona, /thinking partner/);
  assert.match(persona, /Conversational, direct, and brief/);
  assert.match(persona, /stop silently/);
  assert.match(persona, /Robotic process narration/);
  assert.match(persona, /weak spot is the handoff/);
  assert.doesNotMatch(persona, /Private biography/);
});
