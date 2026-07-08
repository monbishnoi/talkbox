# AGENTS.md

This file is for coding agents working on Talkbox.

Talkbox is an open-source voice orchestrator. Its job is simple:

```text
voice system  <->  Talkbox  <->  backend agent
```

The backend agent owns truth, memory, tools, and task execution. Talkbox owns voice mechanics, protocol translation, turn-taking, instrumentation, and speech-friendly rendering.

## Core Principle

**Talkbox may manage conversation mechanics, but it must not invent task answers.**

The voice layer can acknowledge, fill silence, summarize, and help the user navigate a long answer. Substantive facts must come from the configured backend agent through the `ask_agent` boundary.

## Default Integration Shape

The default public setup is:

```text
Browser mic
  -> Talkbox server
  -> OpenAI Realtime
  -> ask_agent tool
  -> Talkbox /realtime/ask-agent
  -> AGENT_ENDPOINT
  -> agent text answer
  -> OpenAI Realtime spoken response
```

Minimum `.env` values:

```env
OPENAI_API_KEY=your-openai-api-key
OPENAI_REALTIME_MODEL=gpt-realtime
OPENAI_REALTIME_VOICE=ash

AGENT_ADAPTER=http
AGENT_ENDPOINT=http://localhost:8080/chat
AGENT_NAME=MyAgent
```

Optional values:

```env
AGENT_CONTEXT_ID=talkbox
AGENT_TIMEOUT_MS=120000
AGENT_VOICE_PERSONA_PATH=./agent-persona.example.md
TALKBOX_API_KEY=local-shared-secret
```

## Backend Agent Contract

For `AGENT_ADAPTER=http`, Talkbox sends a `POST` to `AGENT_ENDPOINT`:

```json
{
  "message": "user request",
  "text": "user request",
  "contextId": "talkbox",
  "metadata": {}
}
```

The agent may respond with any common text shape:

```json
{ "text": "answer" }
```

```json
{ "message": "answer" }
```

```json
{ "response": "answer" }
```

```json
{ "result": { "text": "answer" } }
```

If a new agent has a different API shape, add or update an adapter under:

```text
src/adapters/agent/
```

Do not put agent-specific request logic directly in `src/orchestrator.js`.

## Voice Provider Contract

Voice adapters should expose this conceptual interface:

```js
connect(config)
onTranscript(callback)
speak(text)
onBargeIn(callback)
disconnect()
```

The formal contract lives in:

```text
src/adapters/voice/interface.js
```

Current voice paths:

- OpenAI Realtime: recommended primary path.
- Deepgram + Piper: measurable STT/TTS baseline.
- Hume EVI: experimental/Test 1 compatibility path.

## Important Routes

```text
GET  /health
GET  /config
GET  /providers
GET  /debug/events
POST /realtime/session
POST /realtime/ask-agent
POST /voice/turn
POST /chat/completions
```

Notes:

- `/realtime/ask-agent` is the public Realtime backend boundary.
- `/realtime/ask-cal` exists only as a compatibility alias.
- `/voice/turn` is the deterministic STT/TTS test path.
- `/chat/completions` is the Hume/CLM-compatible experimental path.

## Cal Reference Adapter

Cal is included as a reference adapter, not as a dependency.

Use:

```env
AGENT_ADAPTER=cal
AGENT_ENDPOINT=http://localhost:8080
AGENT_NAME=Cal
```

The Cal adapter speaks A2A JSON-RPC to:

```text
POST /api/chat/send
```

Keep Cal-specific behavior in:

```text
src/adapters/agent/cal.js
```

Do not make Cal the default path.

## Files To Know

```text
README.md                         Human-facing story and quick start
.env.example                      Public configuration template
src/orchestrator.js               HTTP server and route wiring
src/config.js                     Environment/config loader
src/adapters/agent/http.js        Default generic agent adapter
src/adapters/agent/cal.js         Cal reference adapter
src/adapters/agent/interface.js   Agent adapter contract
src/adapters/voice/interface.js   Voice adapter contract
src/runtime/voice-session.js      Deterministic STT/TTS voice-turn path
src/runtime/voice-renderer.js     Speech-safe rendering of agent output
src/runtime/agent-persona.js      Optional persona extraction for voice layer
public/index.html                 Demo/runtime UI
docs/architecture.md              Architecture explanation
docs/adapters.md                  Adapter guide
docs/experiments.md               Test 1-4 history
```

## Development Rules

- Keep generic HTTP as the default agent adapter.
- Keep OpenAI Realtime as the primary recommended voice path.
- Keep Hume as experimental, not removed.
- Keep Cal as a reference adapter, not required.
- Do not commit real API keys, local private paths, or personal memory files.
- Do not move backend-agent tools into the voice layer.
- Preserve `ask_agent` as the public boundary name.
- If adding provider-specific logic, put it behind an adapter.
- If changing public config, update `.env.example`, README, and docs together.

## Verification

Run:

```bash
npm test
git diff --check
```

Useful scans before public release. Also check manually for absolute local paths and personal machine paths.

```bash
rg -n "github\\.tools\\.|sk[_-][A-Za-z0-9_-]{20,}" \
  -S -g '!node_modules' -g '!models' -g '!benchmarks/audio-artifacts' .
```

Expected test coverage includes:

- generic HTTP agent path
- Cal reference adapter parsing
- Realtime `/realtime/ask-agent` boundary
- provider-neutral `/voice/turn`
- Hume request parsing
- speech-safe markdown rendering
