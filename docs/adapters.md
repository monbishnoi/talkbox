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
```

It posts A2A JSON-RPC to:

```text
POST /api/chat/send
```

This keeps Cal as an example without making Cal a dependency.

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

## Writing A New Adapter

Start by copying the closest existing adapter and keep the boundary small:

- receive one completed user turn
- call the backend agent only through `send`
- return full text to the runtime
- do not expose backend tools directly to the voice provider
