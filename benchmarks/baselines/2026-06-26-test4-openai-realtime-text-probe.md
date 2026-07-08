# Test 4 Probe - OpenAI Realtime Text Trigger

Captured: 2026-06-26

This probe verifies the Realtime session and `ask_agent` boundary without depending on microphone permissions.

## Architecture

```text
Browser UI text trigger
  -> OpenAI Realtime
  -> Talkbox ask_agent tool
  -> backend agent
  -> spoken-summary transcript
  -> full backend answer visible in Talkbox UI
```

## What This Proves

- OpenAI Realtime session creation works.
- The voice layer can call the backend through `ask_agent`.
- The backend answer can remain visible in the Talkbox UI.
- Realtime can produce a speech-friendly summary.

## What This Does Not Prove

- Browser microphone permissions.
- Live barge-in quality.
- Real first-audio latency.
- Long-session stability.

Use this as a connectivity smoke test before running full live voice tests.
