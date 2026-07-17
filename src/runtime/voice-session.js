import { randomUUID } from 'node:crypto';
import { sendAgentMessage } from '../adapters/agent/index.js';
import { createSttAdapter } from '../adapters/stt/index.js';
import { createTtsAdapter } from '../adapters/tts/index.js';
import { detailCache } from './detail-cache.js';
import { LatencyTracker } from './latency-tracker.js';
import { renderSpokenResponse } from './voice-renderer.js';

// ============================================================================
// DORMANT SYSTEM 2 PATH — Deepgram/Piper deterministic STT/TTS baseline only.
// The live product/demo path is OpenAI Realtime in public/index.html.
// Keep for benchmarks and compatibility; do not add live Realtime behavior here.
// ============================================================================
function decodeAudioBase64(audioBase64) {
  if (!audioBase64) return null;
  const clean = String(audioBase64).replace(/^data:[^;]+;base64,/, '');
  return Buffer.from(clean, 'base64');
}

// DORMANT SYSTEM 2: legacy Deepgram/Piper turn runner; not live Realtime.
export async function runVoiceTurn(input = {}, config = {}, hooks = {}) {
  const tracker = new LatencyTracker();
  const turnId = input.turnId || `turn-${randomUUID()}`;
  const sttName = input.sttProvider || config.sttProvider || 'transcript';
  const ttsName = input.ttsProvider || config.ttsProvider || 'silent';
  const stt = createSttAdapter(sttName, config);
  const tts = createTtsAdapter(ttsName, config);

  hooks.onEvent?.('turn.started', { turnId, sttProvider: stt.name, ttsProvider: tts.name });
  tracker.mark('stt.started', { provider: stt.name });
  const sttResult = await stt.transcribe({
    transcript: input.transcript,
    audioBuffer: decodeAudioBase64(input.audioBase64),
    contentType: input.audioContentType,
    extension: input.audioExtension,
  });
  tracker.mark('stt.finished', {
    provider: sttResult.provider,
    textLength: sttResult.text.length,
  });

  hooks.onEvent?.('agent.request.started', { turnId, textLength: sttResult.text.length });
  tracker.mark('agent.request.started');
  const agentResult = await sendAgentMessage(sttResult.text, config, {
    contextId: input.contextId || config.agentContextId || config.contextId || 'talkbox',
    timeoutMs: config.agentTimeoutMs,
  });
  tracker.mark('agent.response.finished', { textLength: agentResult.text.length });

  tracker.mark('voice_render.started');
  const rendered = renderSpokenResponse(agentResult.text, { mode: input.voiceMode || config.voiceMode });
  const cacheEntry = detailCache.put({
    turnId,
    transcript: sttResult.text,
    fullText: agentResult.text,
    spoken: rendered.spoken,
    followUps: rendered.followUps,
  });
  tracker.mark('voice_render.finished', {
    spokenLength: rendered.spoken.length,
    followUps: rendered.followUps.length,
  });

  let ttsResult = null;
  if (input.speak !== false) {
    tracker.mark('tts.started', { provider: tts.name });
    ttsResult = await tts.synthesize(rendered.spoken, { turnId });
    tracker.mark('tts.finished', {
      provider: ttsResult.provider,
      bytes: ttsResult.bytes,
      contentType: ttsResult.contentType,
    });
  }

  hooks.onEvent?.('turn.finished', { turnId });
  const timings = tracker.summary();
  timings.cal_request_startedMs ??= timings.agent_request_startedMs;
  timings.cal_response_finishedMs ??= timings.agent_response_finishedMs;

  return {
    turnId,
    sttProvider: stt.name,
    ttsProvider: tts.name,
    transcript: sttResult.text,
    agentText: agentResult.text,
    calText: agentResult.text,
    spoken: rendered.spoken,
    followUps: rendered.followUps,
    cacheKey: cacheEntry.cacheKey,
    audio: ttsResult ? {
      provider: ttsResult.provider,
      model: ttsResult.model,
      contentType: ttsResult.contentType,
      bytes: ttsResult.bytes,
      base64: input.includeAudioBase64 ? ttsResult.audioBuffer.toString('base64') : undefined,
    } : null,
    timings,
  };
}
