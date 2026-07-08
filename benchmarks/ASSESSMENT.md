# Talkbox Benchmark Assessment

This folder captures the public benchmark story for Talkbox. It intentionally avoids machine-specific paths, private agent state, and user-specific logs.

## What We Measure

| Metric | Meaning |
|---|---|
| `totalMs` | End-to-end turn duration. |
| `stt_finishedMs` | Time until speech-to-text completes, when STT is used. |
| `agent_response_finishedMs` | Time until the backend agent returns an answer. |
| `voice_render_finishedMs` | Time until Talkbox prepares speech-safe output. |
| `tts_finishedMs` | Time until text-to-speech output is ready, when separate TTS is used. |

Realtime architectures should also track:

- `firstFillerAudioMs`
- `firstMeaningfulAudioMs`
- `bargeInStopMs`
- `toolEventNarrationLagMs`

## Architecture Comparison

| Test | Architecture | What It Proved | Main Limitation |
|---|---|---|---|
| Test 1 | Hume EVI -> Talkbox -> backend agent | A voice provider can be bridged to an existing agent. | Provider-owned state made output inconsistent. |
| Test 2 | Provider-neutral STT/TTS adapters | Swappable adapters and stage-level instrumentation work. | Not a full conversational UX by itself. |
| Test 3 | Deepgram STT -> backend agent -> Piper TTS | Strong control and reproducible latency metrics. | Batch flow creates dead air while the backend thinks. |
| Test 4 | OpenAI Realtime -> `ask_agent` -> backend agent | Best perceived latency and most natural interaction. | Requires a cloud Realtime provider. |

## Current Recommendation

Use OpenAI Realtime as the primary voice/conversation layer and keep the backend agent behind the `ask_agent` boundary.

Why:

- The user hears acknowledgement and filler while the backend agent works.
- The backend agent remains the source of truth.
- The full backend response can remain visible in the UI.
- The voice layer can summarize for speech without owning memory, tools, or task execution.

Keep the Deepgram + Piper path as the deterministic benchmark and fallback path.

## Running The Matrix

```bash
npm run doctor:providers
npm run experiment:matrix -- --mock-agent --runs=3
```

With an audio sample:

```bash
npm run experiment:matrix -- \
  --mock-agent \
  --runs=3 \
  --audio=/path/to/sample.wav
```

With Deepgram and Piper:

```bash
DEEPGRAM_API_KEY=... \
PIPER_HTTP_ENDPOINT=http://127.0.0.1:8092 \
npm run experiment:matrix -- \
  --mock-agent \
  --runs=3 \
  --stacks=deepgram-piper \
  --audio=/path/to/sample.wav
```

Generated benchmark JSON and audio artifacts are intentionally ignored by Git. Keep public benchmark writeups curated and generic.
