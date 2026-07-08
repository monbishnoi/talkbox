# Test 4 Baseline - OpenAI Realtime -> Agent

Captured: 2026-06-26

This is the recommended Talkbox architecture.

## Architecture

```text
OpenAI Realtime voice front layer
  -> Talkbox ask_agent boundary
  -> backend agent
  -> OpenAI Realtime spoken summary
```

## Configuration

| Layer | Value |
|---|---|
| Voice brain | OpenAI Realtime |
| Tool boundary | `ask_agent` |
| Backend | Generic agent adapter |
| Default transport | HTTP |

## UX Finding

This architecture can feel faster even when the backend wait is longer, because the voice front layer manages the social contract of conversation:

- acknowledge the user immediately
- fill silence while the backend works
- summarize long backend responses for speech
- let the user ask follow-up questions about prior answers
- keep the full backend answer visible in the UI

## Control Rule

OpenAI Realtime may manage conversation mechanics, but it must not invent task answers. Substantive answers come from the backend agent through `ask_agent`.

## Next Benchmark Additions

- First filler audio latency.
- First meaningful audio latency.
- Backend tool-call duration.
- Barge-in stop latency.
- Summary usefulness score.
