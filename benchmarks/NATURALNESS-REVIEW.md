# Talkbox Naturalness Review

Use this rubric after running the provider matrix with `--save-audio-dir`.

Generated audio artifacts are local test outputs and are ignored by Git.

## Rubric

Score each item from 1 to 5.

| Criterion | What To Listen For | Score |
|---|---|---:|
| Pacing | Does speech start promptly and continue at a usable speed? |  |
| Pronunciation | Are product names, file paths, and technical terms understandable? |  |
| Meaning Preservation | Does the spoken version preserve the backend agent's answer without inventing substance? |  |
| Formatting Hygiene | Does it avoid reading markdown, pipes, bullets, code ticks, or table syntax awkwardly? |  |
| Listening Comfort | Could you tolerate this voice for a 10-minute work session? |  |
| Control Feel | Does the spoken answer feel like a voice layer for the agent, not a second agent pretending to know things? |  |

## Notes To Capture

- Which STT provider was used.
- Which TTS provider was used.
- Which backend adapter was used.
- Whether the user heard dead air.
- Whether barge-in worked.
- Whether the full backend answer remained visible.
- Whether the voice summary was useful or too lossy.
