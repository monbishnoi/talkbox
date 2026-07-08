# Implementation Notes

Talkbox is a standalone Node.js runtime.

## Runtime

- `src/orchestrator.js` starts the HTTP server and browser demo.
- `src/config.js` loads `.env` without requiring a framework dependency.
- `public/index.html` is intentionally a single-file demo UI so the project stays easy to run locally.

## Agent Side

- Generic HTTP is the default adapter.
- Cal is included as a reference adapter, not a dependency.
- The voice layer only calls the backend through the agent adapter boundary.

## Voice Side

- OpenAI Realtime is the recommended primary path.
- Deepgram + Piper remains as the measurable STT/TTS baseline.
- Hume remains as an experimental adapter from the first prototype.

## Benchmarks

Benchmark scripts measure:

- total turn time
- STT completion
- backend agent response
- voice rendering
- TTS completion

The important product metric is not only raw latency. The main design goal is lower perceived latency while preserving backend-agent control.
