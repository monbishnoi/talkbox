# Adapters

Talkbox is pluggable on both sides:

- voice providers
- backend agents

## Agent Adapter Contract

Agent adapters implement:

```js
send(message, options)
onEvent(callback)
isReady()
```

See `src/adapters/agent/interface.js`.

### Generic HTTP Adapter

Default:

```env
AGENT_ADAPTER=http
AGENT_ENDPOINT=http://localhost:8080/chat
```

Talkbox sends:

```json
{
  "message": "What should I do next?",
  "text": "What should I do next?",
  "contextId": "talkbox",
  "metadata": {}
}
```

Your agent can respond with any of these:

```json
{ "text": "Here is the answer." }
```

```json
{ "message": "Here is the answer." }
```

```json
{ "response": "Here is the answer." }
```

```json
{ "result": { "text": "Here is the answer." } }
```

### Cal Reference Adapter

Cal is a reference adapter:

```env
AGENT_ADAPTER=cal
AGENT_ENDPOINT=http://localhost:8080
AGENT_NAME=Cal
# Optional personalized greeting name.
VOICE_USER_NAME=Taylor
```

It posts A2A JSON-RPC to:

```text
POST /api/chat/send
```

This keeps Cal as an example without making Cal a dependency.

For multi-session renderers, pass the session selected when voice starts as `contextId` on `/realtime/ask-agent`. The Cal adapter preserves it in the A2A request. Session hydration uses the same identity:

```http
GET /api/history?sessionId=strand-123&limit=20
```

Talkbox forwards `sessionId` to the configured agent-history endpoint. The renderer should keep this binding stable until the voice connection closes.

For an `ask_agent` request originating inside a voice connection, pass `channel: "voice"` and an optional `voiceSessionId` to `/realtime/ask-agent`. The Cal adapter preserves these values in A2A `params.metadata`, allowing the backend to tag its normally persisted user and assistant messages as voice. Local voice exchanges that do not invoke the agent should use the renderer/backend's silent-writeback path instead; do not submit an `ask_agent` exchange through both paths.

## Voice Adapter Contract

Voice adapters implement:

```js
connect(config)
onTranscript(callback)
speak(text)
onBargeIn(callback)
disconnect()
```

See `src/adapters/voice/interface.js`.

## Included Voice Paths

| Path | Status | Notes |
|---|---|---|
| OpenAI Realtime | Recommended | Best perceived latency and natural turn-taking. |
| Deepgram + Piper | Baseline | Good instrumentation and provider-neutral testing. |
| Hume EVI | Experimental | Kept because it was Test 1 and may be useful for emotion-aware experiments. |

## Progress Events

If your renderer can observe agent activity while a request is in flight, it can ask Talkbox to produce Realtime narration instructions:

```http
POST /realtime/progress
```

Example body:

```json
{
  "event": {
    "kind": "step_started",
    "tool": "search",
    "description": "Search project notes for the deployment plan"
  },
  "recentActivities": []
}
```

Talkbox returns `{ "shouldNarrate": true, "instructions": "..." }`. Forward those instructions to the OpenAI Realtime data channel with `response.create`. Keep this as narration only; do not use progress events as a substitute for the final `ask_agent` answer.

## Writing A New Adapter

Start by copying the closest existing adapter and keep the boundary small:

- receive one completed user turn
- call the backend agent only through `send`
- return full text to the runtime
- do not expose backend tools directly to the voice provider
