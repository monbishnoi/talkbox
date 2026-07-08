# Experiments

Talkbox was shaped by four experiments.

For measured results, baseline notes, and the reproducible benchmark matrix, see [Benchmark Assessment](../benchmarks/ASSESSMENT.md) and the curated baseline writeups in [benchmarks/baselines](../benchmarks/baselines/).

## Test 1: Hume EVI Bridge

**Architecture:** Hume EVI -> Talkbox -> backend agent

**Benchmark reference:** Covered in the architecture comparison in [Benchmark Assessment](../benchmarks/ASSESSMENT.md).

**What worked:**

- The adapter idea was valid.
- A third-party voice provider could be bridged to a backend agent.

**What failed:**

- Partial turns leaked into the backend.
- Voice output was inconsistent after the first turn.
- The provider owned too much conversational state.

**Decision:** Keep Hume as an experimental adapter, not the core path.

## Test 2: Provider-Neutral Runtime

**Architecture:** swappable STT/TTS adapters + benchmark instrumentation

**Benchmark reference:** This test established the benchmark matrix documented in [Benchmark Assessment](../benchmarks/ASSESSMENT.md).

**What worked:**

- Provider-neutral interfaces worked.
- Latency could be measured by stage.
- The runtime could keep one clean completed user turn per backend request.

**Decision:** Keep as the benchmark and adapter foundation.

## Test 3: Deepgram STT -> Agent -> Piper TTS

**Architecture:** cloud speech-to-text, backend agent, local text-to-speech

**Benchmark reference:** [Phase 1 local voice baseline](../benchmarks/baselines/2026-06-26-phase1-local-voice-baseline.md).

**What worked:**

- Strong control.
- Good measurement.
- Clear backend ownership of task truth.

**What failed:**

- Batch flow created dead air while the backend worked.
- Spoken output needed intelligent summarization, not only first-sentence trimming.

**Decision:** Keep as a baseline and fallback path.

## Test 4: OpenAI Realtime -> `ask_agent` -> Agent

**Architecture:** Realtime voice brain in front of the backend agent

**Benchmark reference:** [OpenAI Realtime live POC](../benchmarks/baselines/2026-06-26-test4-openai-realtime-live-poc.md) and [OpenAI Realtime text probe](../benchmarks/baselines/2026-06-26-test4-openai-realtime-text-probe.md).

**What worked:**

- Best felt latency.
- The voice layer filled silence naturally while the backend worked.
- The backend answer remained visible and inspectable.
- The user could ask follow-up questions about a prior answer.

**Decision:** Recommended primary path.

## Key Finding

Measured latency and perceived latency are different.

The batch pipeline can have better raw stage timings but still feel broken if the user hears silence. The Realtime path can wait longer on the backend and still feel better because it manages the social contract of conversation: acknowledgement, pacing, and progress.

Talkbox's job is to let the voice layer manage conversation mechanics without taking ownership of truth.
