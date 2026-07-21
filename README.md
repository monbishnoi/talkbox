# Talkbox

**The voice harness for text-based agents.**

[![Release v0.2.0](https://img.shields.io/badge/release-v0.2.0-blue.svg)](https://github.com/monbishnoi/talkbox/releases/tag/v0.2.0)
[![License MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node.js 18+](https://img.shields.io/badge/node-%3E%3D18-339933.svg?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![OpenAI Realtime](https://img.shields.io/badge/voice-OpenAI%20Realtime-412991.svg)](https://platform.openai.com/docs/guides/realtime)

[![Watch the Talkbox demo](https://img.youtube.com/vi/5U29Hiqw00o/maxresdefault.jpg)](https://youtu.be/5U29Hiqw00o)

**Give any AI agent a voice without giving up its brain.**

You built a text-based agent. It reasons, remembers, uses tools, and completes work. Now you want to talk to it without replacing everything that makes it useful.

Talkbox is a voice harness that connects a speech system to an existing backend agent. The speech system listens and speaks. Your agent keeps ownership of facts, memory, reasoning, tools, and task execution. Talkbox defines and enforces the boundary between them.

```text
voice system  <->  Talkbox  <->  backend agent
```

## Architecture

The recommended live path uses OpenAI Realtime, but Talkbox is not in the direct audio stream after setup. The browser or consuming renderer owns the microphone, WebRTC peer, audio playback, and Realtime data channel.

```text
┌─────────────────────┐       SDP + session config        ┌─────────────────────┐
│ Browser / renderer  │ ─────────────────────────────────► │ Talkbox             │
│                     │ ◄───────────────────────────────── │ voice harness       │
│ • microphone        │          SDP answer               │                     │
│ • WebRTC peer       │                                   │ • Realtime policy   │
│ • data channel      │       direct WebRTC after setup   │ • ask_agent tool    │
│ • audio playback    │ ◄────────────────────────────────► │ • agent adapters    │
└──────────┬──────────┘            OpenAI Realtime         │ • context/persona   │
           │                                               │ • narration policy  │
           │ ask_agent call and result                     └──────────┬──────────┘
           │ through renderer                                         │
           └───────────────────────────────────────────────────────────┤
                                                                       │ text request
                                                                       ▼
                                                            ┌─────────────────────┐
                                                            │ Backend agent       │
                                                            │ • facts and memory  │
                                                            │ • reasoning/tools   │
                                                            │ • task execution    │
                                                            └─────────────────────┘
```

Talkbox receives the browser's SDP offer at `POST /realtime/session`, builds the Realtime instructions and `ask_agent` tool, optionally loads persona and backend-supplied context, and exchanges the offer with OpenAI. It returns the SDP answer to the browser. Once connected, the browser communicates directly with OpenAI Realtime.

When Realtime calls `ask_agent`, the consuming renderer sends the request to `POST /realtime/ask-agent`. Talkbox calls the configured backend agent through an adapter and returns the agent's complete text answer. The renderer then places that result on its Realtime data channel so the speech model can deliver it naturally.

Explore the interactive [Talkbox architecture flow](https://monbishnoi.github.io/talkbox/) for the connection, hydration, `ask_agent`, and progress-narration phases.

### What each layer owns

| Layer | Owns | Does not own |
|---|---|---|
| Backend agent | Facts, memory, reasoning, tools, personality, task execution, durable history | Voice transport, listening, audio generation |
| Talkbox | Realtime session policy, SDP bootstrap, `ask_agent` boundary, adapters, optional persona/context injection, progress-narration policy | Backend truth, backend tools, durable conversation storage, the live WebRTC data channel |
| Browser or renderer | Microphone and playback, WebRTC/data-channel events, forwarding tool results, optional activity bridging and silent writeback | Task facts, agent reasoning, Talkbox policy |
| Speech model | Listening, VAD, turn-taking, filler, barge-in, natural spoken delivery | Backend memory, tools, current state, task execution |

### Context and session continuity

Talkbox supports two complementary forms of context:

- The bundled browser can fetch recent agent history through `GET /api/history` and inject selected messages into the Realtime conversation without prompting a response.
- `AGENT_VOICE_CONTEXT_URL` can return session-aware `user`, `startupMemory`, and `conversationContext` layers. Talkbox adds those backend-supplied layers to the Realtime session instructions.

Talkbox forwards session identity rather than owning it. Multi-session renderers should bind one backend session when voice starts, use it as `contextId` for `/realtime/ask-agent`, and pass it as `sessionId` for history and voice-context requests. The backend remains responsible for resolving that identity and keeping histories separate.

The bundled browser also supports a short session-opening greeting. Set `VOICE_USER_NAME` to include the user's name once when a new Realtime connection opens. External renderers must implement their own session-opening event and once-per-session guard.

For persistence, Talkbox forwards optional `channel: "voice"` and `voiceSessionId` metadata on agent calls. A consuming renderer or backend must implement silent writeback for Realtime-only exchanges that never cross `ask_agent`. Talkbox does not store those exchanges itself.

## Core Capabilities

Talkbox provides four voice-harness capabilities across its live and deterministic batch paths:

### 1. The Ask-Agent Boundary

The central design decision. A speech model wants to answer everything itself. Talkbox constrains it:

- **Identity framing:** The speech model is told that it is the agent's voice, not a relay or a second assistant. The backend agent remains the brain.
- **Context-first routing:** The speech model may answer directly when the complete answer is explicit in the injected user, memory, or conversation context. It calls `ask_agent` for new information, current state, actions, tools, missing context, or uncertainty.
- **Hallucination prevention:** After `ask_agent` returns, the speech model is instructed to speak only the returned content. No invented facts.
- **Graceful failure:** If the agent is unreachable, the speech model reports a temporary voice issue and asks the user to try again rather than making up an answer.

```
User: "What's on my calendar today?"

Speech model (internally):
  → This requires current calendar state → must call ask_agent
  → Says aloud: "Let me check that."

ask_agent fires → Talkbox routes to YOUR AGENT → agent returns real answer

Speech model speaks the answer as if it always knew it.
User hears one coherent voice. Never hears "let me ask your backend."
```

### 2. Persona and Context Injection

Your agent has an identity: a name, a communication style, a personality. The speech model doesn't know any of that by default.

Talkbox reads an optional markdown persona file, extracts agent identity and spoken-behavior sections, and injects them into the speech session. The speech model can then speak with the agent's name, tone, and communication style. User biography, project memory, and conversation history remain separate backend-supplied context layers rather than being duplicated in the persona.

Without this, you get a generic assistant voice reading out answers. With it, the user experiences one coherent identity.

```env
AGENT_VOICE_PERSONA_PATH=./my-agent-persona.md
AGENT_VOICE_PERSONA_MAX_CHARS=4500
# Optional in the bundled browser: first-response greeting name.
VOICE_USER_NAME=Taylor
# Optional backend endpoint returning session-aware voice context layers.
AGENT_VOICE_CONTEXT_URL=http://localhost:8080/api/voice/context
```

### 3. Speech-Safe Rendering

The deterministic batch path includes a markdown-to-speech renderer. It strips visual formatting, translates common symbols, selects a concise 3–6 sentence spoken response, and keeps the complete agent text in the returned turn result. Longer structured answers can expose section headings as follow-up handles.

The live OpenAI Realtime path is different. Talkbox returns the complete backend answer to the browser and instructs Realtime to deliver it concisely. It does not run that answer through the batch markdown renderer.

### 4. Progress Narration

Long-running agents often stream useful activity events while they work: searching files, checking memory, running tests, calling tools. Talkbox can turn those renderer-provided events into natural progress narration for OpenAI Realtime.

The goal is not robotic play-by-play. Talkbox tells the voice model to act like a calm game commentator: synthesize the action into a vivid, useful update, skip vague/repetitive events, and never say "tool call", "backend", or "bash" to the user.

```http
POST /realtime/progress
```

Send a normalized activity event and Talkbox returns Realtime instructions your renderer can forward over the voice data channel.

This is separate from the speech model's immediate filler. Realtime can say a quick "Let me check that" as the `ask_agent` call begins. `/realtime/progress` is for the longer wait after your agent starts streaming activity events.

---

### Preamble vs Progress Narration

Talkbox uses two different mechanisms to make long agent work feel natural:

| Mechanism | Who performs it | What it does |
|---|---|---|
| Immediate preamble | OpenAI Realtime speech model | Says one brief filler line when it starts `ask_agent`, such as "Let me check that." |
| Progress narration | Talkbox `/realtime/progress` + OpenAI Realtime | Converts your renderer's agent activity events into natural commentary while the agent is still working. |

In other words: Realtime owns the live speaking mechanics. Talkbox owns the session policy, boundary, optional persona/context injection, adapter routing, and narration policy. Your backend agent owns the truth.

---

## Voice Paths

### OpenAI Realtime (recommended live path)

```
User speaks
    ↓
Speech model listens (VAD detects speech end)
    ↓
Speech model decides: is this a substantive question?
    ├── No (greeting or fully grounded in injected context) → responds directly
    └── Yes (new/current/actionable/missing/uncertain) → calls ask_agent
                                              ↓
                                    Talkbox routes to your agent
                                              ↓
                                    Agent returns answer
                                              ↓
                             Renderer returns complete tool output
                                              ↓
                              Speech model delivers it naturally
```

Turn-taking, filler ("Got it, checking that"), barge-in, and silence detection are native capabilities of the speech model. Talkbox does not implement these. Talkbox enables you to *use* them without replacing your agent's brain.

This is the path where the `ask_agent` boundary, optional persona/context injection, and Realtime delivery work together in a live conversational experience. Progress narration is available when the consuming renderer supplies agent activity events.

### Batch Path: STT → Agent → TTS (testing and benchmarking)

```
Audio in → STT adapter → Your agent → Voice renderer → TTS adapter → Audio out
```

A deterministic pipeline for testing and measurement. No filler, no barge-in. The user waits in silence while the agent thinks. Useful when you need measurable results, want to run locally, or are evaluating STT/TTS providers.

### Experimental: Hume EVI (adapter only)

An early experiment that proved the adapter concept but revealed limitations. Hume owned too much of the turn-taking loop, making it difficult to enforce the ask-agent boundary cleanly. The adapter remains in the codebase for reference and potential future development as the Hume platform evolves.

### Why OpenAI Realtime Won

We evaluated multiple approaches. The key finding: raw latency and *felt* latency diverge. The batch path (STT → Agent → TTS) measured 12 seconds of dead silence. OpenAI Realtime took longer for the agent call (~26 seconds for complex queries), but felt faster because the speech model kept the conversation alive while the agent worked. See [Experiments](docs/experiments.md) for the experiment narrative and [Benchmarks](benchmarks/ASSESSMENT.md) for the measured baselines.

---

## Quick Start

```bash
git clone https://github.com/monbishnoi/talkbox
cd talkbox
npm install
cp .env.example .env
```

Edit `.env`:

```env
OPENAI_API_KEY=your-openai-api-key
OPENAI_REALTIME_MODEL=gpt-realtime
OPENAI_REALTIME_VOICE=ash

AGENT_ADAPTER=http
AGENT_ENDPOINT=http://localhost:3000/chat
AGENT_NAME=MyAgent
```

Run:

```bash
npm start
```

Open `http://127.0.0.1:8090` and click "Start Talking."

### Agent HTTP Contract

Talkbox sends a POST to your agent:

```json
{
  "message": "user's spoken request",
  "text": "user's spoken request",
  "contextId": "talkbox",
  "metadata": {}
}
```

Your agent responds with any common shape:

```json
{ "text": "answer" }
{ "message": "answer" }
{ "response": "answer" }
{ "result": { "text": "answer" } }
```

Any HTTP endpoint that accepts text and returns text works.

If your renderer has multiple agent sessions, bind voice to one session when it connects. Pass that ID as `contextId` on `POST /realtime/ask-agent` and as `sessionId` on `GET /api/history`; Talkbox forwards the identity so the backend can keep each conversation separate.

Treat voice as a channel for the lifetime of that connection. When a renderer includes `channel: "voice"` and an optional `voiceSessionId` on `/realtime/ask-agent`, Talkbox forwards that metadata to the backend adapter. The renderer or backend remains responsible for silently writing back local Realtime-only exchanges and avoiding duplicate persistence.

---

## Adapters

### Agent

| Adapter | Type | Notes |
|---------|------|-------|
| `http` | Generic | Any HTTP endpoint (default) |
| `cal` | Reference | Cal Gateway reference implementation |

### Voice Paths

| Path | Status | Best for |
|------|--------|----------|
| OpenAI Realtime | **Recommended** | Live conversation with filler, barge-in, natural delivery |
| STT → Agent → TTS | Functional | Benchmarking, testing, local/offline use |
| Hume EVI | Experimental | Reference only. Hume owns too much of the loop for clean boundary enforcement. |

### STT (batch path)

| Adapter | Type | Notes |
|---------|------|-------|
| `deepgram` | Cloud | Streaming, low latency |
| `sherpa` | Local | Offline, privacy-first |
| `command` | System | Custom shell command |
| `transcript` | Mock | Pre-transcribed text for tests |

### TTS (batch path)

| Adapter | Type | Notes |
|---------|------|-------|
| `deepgram` | Cloud | Streaming, natural voice |
| `piper-http` | Local | Fast, offline |
| `sherpa` | Local | Offline, streaming |
| `command` | System | Custom shell command |
| `silent` | Mock | For benchmarks/testing |

---

## Infrastructure

Beyond the core design, Talkbox provides developer tools:

- **Realtime bootstrap:** Builds the session instructions and tools, exchanges the browser's SDP offer with OpenAI, and returns the answer; the consuming browser owns the peer and data channel
- **Provider abstraction:** Swap STT/TTS providers in the batch path without changing agent code
- **Progress narration endpoint:** Normalize renderer-provided agent events into OpenAI Realtime instructions for natural "what's happening" commentary during long waits
- **Batch latency tracking:** Measures each deterministic STT, agent, render, and TTS stage with millisecond precision
- **Batch detail cache:** Retains recent full and spoken turn representations in memory for deterministic pipeline integrations
- **Debug pipeline:** Real-time SSE event stream showing every stage as it happens
- **Benchmark suite:** Provider matrix testing for latency and reliability

---

## Docs

- [Adapters](docs/adapters.md): Writing custom adapters
- [Experiments](docs/experiments.md): What we tried and learned, including why OpenAI Realtime became the recommended path
- [Benchmarks](benchmarks/ASSESSMENT.md): Stage timing, baseline comparison, and reproducible matrix commands
- [Baseline Notes](benchmarks/baselines/): Curated notes for the Deepgram/Piper and OpenAI Realtime tests
- [Changelog](CHANGELOG.md): Release history
- [Coding Agent Guide](AGENTS.md): Instructions for coding agents working on Talkbox

---

## Experiment Results

Talkbox was built through four architecture tests. The short version is in [Experiments](docs/experiments.md); the measured baselines and reproducible benchmark commands are in [Benchmarks](benchmarks/ASSESSMENT.md). The OpenAI Realtime test is why Realtime is recommended: it handled perceived latency better by filling silence while the backend agent worked.

---

## License

MIT
