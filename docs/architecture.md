# Talkbox Architecture

Talkbox gives an existing AI agent a voice without moving the agent's reasoning, memory, or tools into the voice layer.

## Core Flow

```text
User audio
  -> voice provider
  -> Talkbox runtime
  -> ask_agent boundary
  -> backend agent
  -> full answer
  -> voice provider summarizes/speaks
```

## Boundary Rule

The voice layer may manage conversation mechanics:

- turn-taking
- acknowledgement
- filler while the backend works
- barge-in
- spoken summarization
- progress narration from renderer-provided activity events
- drill-down on prior answers

The voice layer must not invent task answers. Substantive answers come from the backend agent through one boundary tool: `ask_agent`.

## Default Runtime

The default backend adapter is generic HTTP:

```env
AGENT_ADAPTER=http
AGENT_ENDPOINT=http://localhost:8080/chat
AGENT_NAME=MyAgent
```

The HTTP adapter sends:

```json
{
  "message": "user request",
  "text": "user request",
  "contextId": "talkbox",
  "metadata": {}
}
```

It accepts common response shapes such as:

```json
{ "text": "answer" }
```

```json
{ "response": "answer" }
```

```json
{ "result": { "text": "answer" } }
```

## Cal Reference Adapter

Cal Gateway is included as a reference adapter for users who want to connect Talkbox to a Cal deployment. It is not required.

```env
AGENT_ADAPTER=cal
AGENT_ENDPOINT=http://localhost:8080
AGENT_NAME=Cal
```

The Cal adapter speaks A2A JSON-RPC to `POST /api/chat/send`.

## Realtime Path

The recommended path is OpenAI Realtime as the voice brain:

- Realtime handles live audio, pacing, fillers, and barge-in.
- Talkbox exposes `ask_agent`.
- Talkbox exposes `/realtime/progress` so renderers can turn backend activity events into natural spoken progress updates.
- The backend agent owns truth, memory, tools, and task execution.

This design improves perceived latency because the user hears progress while the backend agent works.

## Preamble vs Progress Narration

There are two latency-covering behaviors:

1. **Immediate preamble:** OpenAI Realtime says one short filler line as the `ask_agent` tool begins. This covers the first quiet moment.
2. **Progress narration:** A renderer sends meaningful backend activity events to `POST /realtime/progress`. Talkbox returns Realtime instructions that ask the voice model to narrate progress like a calm commentator, not a mechanical log reader.

Talkbox does not store or own the activity stream. It owns the narration policy. Your renderer decides which events are worth sending, and your backend agent remains the source of truth.
