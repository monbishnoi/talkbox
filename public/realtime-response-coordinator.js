const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_CANCEL_GRACE_MS = 1500;

function defaultId() {
  return globalThis.crypto?.randomUUID?.() || `talkbox-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createRealtimeResponseCoordinator({
  sendEvent,
  onLifecycle = () => {},
  makeId = defaultId,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  cancelGraceMs = DEFAULT_CANCEL_GRACE_MS,
} = {}) {
  let active = null;
  const queue = [];

  function describe(record) {
    if (!record) return {};
    return {
      phase: record.phase,
      callId: record.callId,
      responseId: record.responseId,
      logicalDone: record.logicalDone,
      audioStopped: record.audioStopped,
    };
  }

  function clearRecordTimers(record) {
    if (!record) return;
    if (record.timeoutHandle) clearTimer(record.timeoutHandle);
    if (record.cancelGraceHandle) clearTimer(record.cancelGraceHandle);
  }

  function finishActive(reason) {
    const finished = active;
    if (!finished) return;
    clearRecordTimers(finished);
    active = null;
    onLifecycle('finished', { ...describe(finished), reason });
    drain();
  }

  function forceReleaseAfterCancel(record) {
    if (active !== record) return;
    onLifecycle('forced_release', describe(record));
    finishActive('cancel_grace_elapsed');
  }

  function handleTimeout(record) {
    if (active !== record) return;
    onLifecycle('timeout', describe(record));
    sendEvent({
      type: 'response.cancel',
      ...(record.responseId ? { response_id: record.responseId } : {}),
    });
    record.cancelGraceHandle = setTimer(
      () => forceReleaseAfterCancel(record),
      cancelGraceMs,
    );
  }

  function send(record) {
    active = record;
    sendEvent({
      type: 'response.create',
      event_id: record.eventId,
      response: {
        ...record.response,
        metadata: {
          ...(record.response.metadata || {}),
          talkbox_phase: record.phase,
          talkbox_call_id: record.callId || '',
        },
      },
    });
    if (record.waitForAudioStop) {
      record.timeoutHandle = setTimer(() => handleTimeout(record), timeoutMs);
    }
    onLifecycle('sent', describe(record));
  }

  function drain() {
    if (active || queue.length === 0) return;
    send(queue.shift());
  }

  function request({
    phase,
    callId = '',
    response = {},
    waitForAudioStop = false,
  }) {
    const record = {
      phase,
      callId,
      response,
      waitForAudioStop,
      eventId: `talkbox-${makeId()}`,
      responseId: '',
      logicalDone: false,
      audioStopped: false,
      timeoutHandle: null,
      cancelGraceHandle: null,
    };
    queue.push(record);
    onLifecycle('queued', describe(record));
    drain();
    return record.eventId;
  }

  function matches(record, response = {}) {
    if (!record) return false;
    if (record.responseId && response.id) return record.responseId === response.id;
    const metadata = response.metadata || {};
    return metadata.talkbox_phase === record.phase
      && String(metadata.talkbox_call_id || '') === record.callId;
  }

  function handleResponseCreated(response = {}) {
    if (active && matches(active, response)) {
      active.responseId = response.id || active.responseId;
      onLifecycle('created', describe(active));
      return;
    }
    if (active) return;

    // Server-authored responses (for example VAD turns) also occupy the one-response lane.
    active = {
      phase: 'server',
      callId: '',
      response: {},
      waitForAudioStop: false,
      eventId: '',
      responseId: response.id || '',
      logicalDone: false,
      audioStopped: false,
      timeoutHandle: null,
      cancelGraceHandle: null,
    };
    onLifecycle('created', describe(active));
  }

  function handleError(error = {}) {
    if (!active?.eventId || error.event_id !== active.eventId) return;
    onLifecycle('error', {
      ...describe(active),
      errorType: error.type || '',
      errorCode: error.code || '',
    });
    finishActive('response_error');
  }

  function requireActiveAudioStop(responseId = '') {
    if (!active || (active.responseId && responseId && active.responseId !== responseId)) return;
    if (!active.responseId && responseId) active.responseId = responseId;
    active.waitForAudioStop = true;
    if (!active.timeoutHandle) {
      active.timeoutHandle = setTimer(() => handleTimeout(active), timeoutMs);
    }
    onLifecycle('audio_gate_required', describe(active));
  }

  function handleResponseDone(response = {}) {
    if (!active) return;
    if (active.phase !== 'server' && !matches(active, response)) return;
    if (active.phase === 'server' && active.responseId && response.id !== active.responseId) return;
    active.responseId = response.id || active.responseId;
    active.logicalDone = true;
    onLifecycle('done', describe(active));
    if (!active.waitForAudioStop || active.audioStopped) finishActive('response_done');
  }

  function handleAudioStopped(responseId = '') {
    if (!active || !active.waitForAudioStop) return;
    if (active.responseId && responseId && active.responseId !== responseId) return;
    if (!active.responseId && responseId) active.responseId = responseId;
    active.audioStopped = true;
    onLifecycle('audio_stopped', describe(active));
    if (active.logicalDone) finishActive('audio_stopped');
  }

  function reset() {
    clearRecordTimers(active);
    active = null;
    for (const record of queue) clearRecordTimers(record);
    queue.length = 0;
  }

  return {
    request,
    handleResponseCreated,
    handleError,
    requireActiveAudioStop,
    handleResponseDone,
    handleAudioStopped,
    reset,
    snapshot: () => ({ active: describe(active), queued: queue.map(describe) }),
  };
}
