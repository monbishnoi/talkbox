# Talkbox

**Give any AI agent a voice without giving up its brain.**

You built an agent. It reasons, remembers, uses tools. Now you want to talk to it.

The problem: speech-native models (like OpenAI Realtime) are incredible at natural conversation, but they replace your agent's reasoning. They become the brain. Your agent's memory, tools, and personality disappear.

Talkbox sits between a speech model and your agent. The speech model handles the voice. Your agent stays the brain. Talkbox enforces the boundary between them.

---

## Core Design

Talkbox contributes three things that you'd otherwise have to figure out yourself:

### 1. The Ask-Agent Boundary

The central design decision. A speech model wants to answer everything itself. Talkbox constrains it:

- **Identity framing:** The speech model is told "you ARE the agent" (not "you are relaying to the agent"). The user never hears about a second system.
- **Tool enforcement:** One tool (`ask_agent`) is the only path to substantive answers. The speech model must call it for anything requiring memory, tools, project state, or facts.
- **Hallucination prevention:** After `ask_agent` returns, the speech model is instructed to speak only the returned content. No invented facts.
- **Graceful failure:** If the agent is unreachable, the speech model says "I hit a voice pipe issue" rather than making something up.

```
User: "What's on my calendar today?"

Speech model (internally):
  → This requires memory/state → must call ask_agent
  → Says aloud: "Let me check that."

ask_agent fires → Talkbox routes to YOUR AGENT → agent returns real answer

Speech model speaks the answer as if it always knew it.
User hears one coherent voice. Never hears "let me ask your backend."
```

### 2. Persona Injection

Your agent has an identity: a name, a communication style, a personality. The speech model doesn't know any of that by default.

Talkbox reads a markdown persona file, extracts identity-defining sections (Identity, Communication Style, Voice, Personality), and injects them into the speech session. The speech model then speaks *as* your agent: same name, same tone, same personality.

Without this, you get a generic assistant voice reading out answers. With it, the user experiences one coherent identity.

```env
AGENT_VOICE_PERSONA_PATH=./my-agent-persona.md
AGENT_VOICE_PERSONA_MAX_CHARS=4500
```

### 3. Voice Rendering

AI agents think in markdown. Tables, code blocks, bullet lists, headers. None of that is hearable.

Voice rendering transforms agent output from readable to speakable: strips markdown formatting, translates visual symbols into words, and selects a concise spoken summary (3-6 sentences) from longer responses. Section headings become follow-up prompts ("I can go deeper on X, Y, Z."). The full agent response remains available in the chat for reading.

### 4. Progress Narration

Long-running agents often stream useful activity events while they work: searching files, checking memory, running tests, calling tools. Talkbox can turn those renderer-provided events into natural progress narration for OpenAI Realtime.

The goal is not robotic play-by-play. Talkbox tells the voice model to act like a calm game commentator: synthesize the action into a vivid, useful update, skip vague/repetitive events, and never say "tool call", "backend", or "bash" to the user.

```http
POST /realtime/progress
```

Send a normalized activity event and Talkbox returns Realtime instructions your renderer can forward over the voice data channel.

This is separate from the speech model's immediate filler. Realtime can say a quick "Let me check that" as the `ask_agent` call begins. `/realtime/progress` is for the longer wait after your agent starts streaming activity events.

---

## How It Works

```
┌───────────────────────┐       ┌───────────────────────────┐       ┌───────────────────────────┐
│                       │       │                           │       │                           │
│  🧠 YOUR AGENT        │       │  🔒 TALKBOX               │       │  🎙️ SPEECH MODEL           │
│     (the brain)       │       │     (the boundary)        │       │     (the voice)           │
│                       │       │                           │       │                           │
│  • Reasoning          │       │  • Defines where the      │       │  • Listening (VAD)        │
│  • Memory             │ ask_  │    brain is               │ sets  │  • Turn-taking            │
│  • Tools              │ agent │  • Injects persona into   │  up   │  • Filler while agent     │
│  • Task execution     │◄─────►│    the voice              │◄─────►│    thinks                 │
│                       │       │  • Renders text into      │  the  │  • Natural delivery       │
│                       │       │    speech                 │ call  │  • Barge-in /             │
│                       │       │  • Narrates progress      │       │    interruption handling   │
│                       │       │  • Wires the session      │       │                           │
│                       │       │                           │       │                           │
└───────────────────────┘       └───────────────────────────┘       └───────────────────────────┘
```

**What each layer owns:**

| Layer | Owns | Does NOT own |
|-------|------|--------------|
| Your agent | Facts, memory, tools, reasoning, personality | Voice, listening, speaking |
| Talkbox | Boundary enforcement, persona injection, voice rendering, progress narration policy, session wiring | Reasoning, audio generation, VAD |
| Speech model | Natural conversation, immediate filler, barge-in, delivery, VAD | Facts, memory, tools, identity |

### Preamble vs Progress Narration

Talkbox uses two different mechanisms to make long agent work feel natural:

| Mechanism | Who performs it | What it does |
|---|---|---|
| Immediate preamble | OpenAI Realtime speech model | Says one brief filler line when it starts `ask_agent`, such as "Let me check that." |
| Progress narration | Talkbox `/realtime/progress` + OpenAI Realtime | Converts your renderer's agent activity events into natural commentary while the agent is still working. |

In other words: Realtime owns the live speaking mechanics. Talkbox owns the rules, boundary, persona, rendering, and narration policy. Your backend agent owns the truth.

---

## Voice Paths

### Fully Implemented: OpenAI Realtime (recommended)

```
User speaks
    ↓
Speech model listens (VAD detects speech end)
    ↓
Speech model decides: is this a substantive question?
    ├── No (greeting, clarification) → responds directly using persona
    └── Yes (needs facts/memory/tools) → calls ask_agent
                                              ↓
                                    Talkbox routes to your agent
                                              ↓
                                    Agent returns answer
                                              ↓
                                    Voice renderer makes it speakable
                                              ↓
                              Speech model delivers answer naturally
```

Turn-taking, filler ("Got it, checking that"), barge-in, and silence detection are native capabilities of the speech model. Talkbox does not implement these. Talkbox enables you to *use* them without replacing your agent's brain.

This is the only path where all three core capabilities (ask-agent boundary, persona injection, voice rendering) work together in a live conversational experience.

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
| OpenAI Realtime | **Fully implemented** | Live conversation with filler, barge-in, natural delivery |
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

- **Session wiring** — Handles WebRTC/SDP negotiation, data channel setup, and tool call routing so you don't have to build the real-time plumbing yourself
- **Provider abstraction** — Swap STT/TTS providers in the batch path without changing agent code
- **Progress narration endpoint** — Normalize renderer-provided agent events into OpenAI Realtime instructions for natural "what's happening" commentary during long waits
- **Latency tracking** — Measures each stage (STT, agent, render, TTS) with millisecond precision
- **Detail cache** — Stores full agent responses so the chat shows complete answers while voice summarizes
- **Debug pipeline** — Real-time SSE event stream showing every stage as it happens
- **Benchmark suite** — Provider matrix testing for latency and reliability

---

## Docs

- [Adapters](docs/adapters.md) — Writing custom adapters
- [Experiments](docs/experiments.md) — What we tried and learned, including why OpenAI Realtime became the recommended path
- [Benchmarks](benchmarks/ASSESSMENT.md) — Stage timing, baseline comparison, and reproducible matrix commands
- [Baseline Notes](benchmarks/baselines/) — Curated notes for the Deepgram/Piper and OpenAI Realtime tests
- [Coding Agent Guide](AGENTS.md) — Instructions for coding agents working on Talkbox

---

## Experiment Results

Talkbox was built through four architecture tests. The short version is in [Experiments](docs/experiments.md); the measured baselines and reproducible benchmark commands are in [Benchmarks](benchmarks/ASSESSMENT.md). The OpenAI Realtime test is why Realtime is recommended: it handled perceived latency better by filling silence while the backend agent worked.

---

## License

MIT
