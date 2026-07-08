# Test 3 Baseline - Deepgram STT -> Agent -> Piper TTS

Captured: 2026-06-26

This is the deterministic pipeline baseline for Talkbox. It is useful because each stage can be measured independently.

## Architecture

```text
Browser recorded audio
  -> Deepgram STT
  -> Talkbox
  -> backend agent
  -> deterministic Talkbox voice renderer
  -> Piper HTTP TTS
  -> browser playback
```

## Properties

- Turn-taking: one completed user turn.
- Streaming: none.
- STT: Deepgram.
- Backend: generic agent endpoint.
- Voice renderer: deterministic renderer.
- TTS: local Piper HTTP.

## Key Finding

The deterministic pipeline gives strong control, but it creates dead air while the backend agent thinks. That makes it a good measurement baseline, not the best conversational UX.

## Metrics To Record

| Metric | Meaning |
|---|---|
| `totalMs` | End-to-end duration. |
| `speechToTextMs` | Audio-to-text stage. |
| `agentResponseMs` | Backend agent request-to-answer stage. |
| `voiceRenderMs` | Spoken answer planning/rendering. |
| `textToSpeechMs` | Text-to-audio stage. |

## Quality Criteria

- One user turn maps to one backend request.
- Voice-provider metadata is not injected into the backend request.
- The backend agent remains the source of truth.
- Spoken answer should be intentionally summarized, not blindly truncated.
- Full backend response should remain visible and inspectable.
