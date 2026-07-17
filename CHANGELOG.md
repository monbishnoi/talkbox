# Changelog

## 0.2.0 - 2026-07-17

### Added

- Session-aware voice hydration with separate persona, user, active-memory, and conversation-context layers.
- Voice-channel and voice-session metadata propagation through the Cal A2A reference adapter.
- Input transcription configuration for durable voice writeback.
- Realtime response coordination for fillers, tool calls, answers, and audio completion.
- One-time personalized session greeting and configurable user name.
- Safe retry for transient OpenAI Realtime connection timeouts.

### Changed

- Realtime can answer directly from injected context when the answer is fully grounded.
- New, current, actionable, missing, or uncertain work continues through `ask_agent`.
- Persona extraction now keeps voice behavior separate from user biography and project memory.
- The deterministic STT/TTS path is explicitly retained as a benchmark and compatibility path.
- Documentation now describes session binding, hydration, progress narration, and voice writeback responsibilities.

### Fixed

- Prevented overlapping Realtime responses when filler audio is still playing.
- Released failed managed responses by correlating Realtime errors to their outgoing event IDs.
- Removed unsupported per-response modality overrides from the standalone Realtime client.
- Added recovery when an expected audio-stop event never arrives.
