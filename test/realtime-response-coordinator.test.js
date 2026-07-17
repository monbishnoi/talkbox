import test from 'node:test';
import assert from 'node:assert/strict';
import { createRealtimeResponseCoordinator } from '../public/realtime-response-coordinator.js';

function testCoordinator(options = {}) {
  const events = [];
  let nextId = 0;
  const coordinator = createRealtimeResponseCoordinator({
    sendEvent: (event) => events.push(event),
    makeId: () => String(++nextId),
    ...options,
  });
  return { coordinator, events };
}

test('parks the answer until the matching filler is done and its audio stops', () => {
  const { coordinator, events } = testCoordinator();
  coordinator.request({ phase: 'filler', callId: 'call-1', waitForAudioStop: true });
  coordinator.request({ phase: 'answer', callId: 'call-1' });

  assert.equal(events.filter((event) => event.type === 'response.create').length, 1);
  coordinator.handleResponseCreated({
    id: 'filler-response',
    metadata: { talkbox_phase: 'filler', talkbox_call_id: 'call-1' },
  });
  coordinator.handleResponseDone({
    id: 'different-response',
    metadata: { talkbox_phase: 'filler', talkbox_call_id: 'call-1' },
  });
  assert.equal(events.filter((event) => event.type === 'response.create').length, 1);
  coordinator.handleResponseDone({
    id: 'filler-response',
    metadata: { talkbox_phase: 'filler', talkbox_call_id: 'call-1' },
  });
  assert.equal(events.filter((event) => event.type === 'response.create').length, 1);

  coordinator.handleAudioStopped('different-response');
  assert.equal(events.filter((event) => event.type === 'response.create').length, 1);
  coordinator.handleAudioStopped('filler-response');

  const creates = events.filter((event) => event.type === 'response.create');
  assert.equal(creates.length, 2);
  assert.equal(creates[1].response.metadata.talkbox_phase, 'answer');
});

test('does not wait when filler audio has already stopped before the answer is ready', () => {
  const { coordinator, events } = testCoordinator();
  coordinator.request({ phase: 'filler', callId: 'call-1', waitForAudioStop: true });
  coordinator.handleResponseCreated({
    id: 'filler-response',
    metadata: { talkbox_phase: 'filler', talkbox_call_id: 'call-1' },
  });
  coordinator.handleResponseDone({
    id: 'filler-response',
    metadata: { talkbox_phase: 'filler', talkbox_call_id: 'call-1' },
  });
  coordinator.handleAudioStopped('filler-response');
  coordinator.request({ phase: 'answer', callId: 'call-1' });

  assert.equal(events.filter((event) => event.type === 'response.create').length, 2);
});

test('cancels and eventually releases a parked answer when audio-stop is missing', () => {
  const timers = [];
  const { coordinator, events } = testCoordinator({
    setTimer: (callback) => {
      timers.push(callback);
      return timers.length;
    },
    clearTimer: () => {},
  });
  coordinator.request({ phase: 'filler', callId: 'call-1', waitForAudioStop: true });
  coordinator.request({ phase: 'answer', callId: 'call-1' });
  coordinator.handleResponseCreated({
    id: 'filler-response',
    metadata: { talkbox_phase: 'filler', talkbox_call_id: 'call-1' },
  });

  timers.shift()();
  assert.deepEqual(events.at(-1), { type: 'response.cancel', response_id: 'filler-response' });
  timers.shift()();

  const creates = events.filter((event) => event.type === 'response.create');
  assert.equal(creates.length, 2);
  assert.equal(creates[1].response.metadata.talkbox_phase, 'answer');
});

test('releases a failed managed response by matching the outgoing event id', () => {
  const { coordinator, events } = testCoordinator();
  const eventId = coordinator.request({ phase: 'session_open', waitForAudioStop: true });
  coordinator.request({ phase: 'answer' });

  coordinator.handleError({
    event_id: 'different-event',
    type: 'invalid_request_error',
  });
  assert.equal(events.filter((event) => event.type === 'response.create').length, 1);

  coordinator.handleError({
    event_id: eventId,
    type: 'invalid_request_error',
    code: 'unknown_parameter',
  });
  assert.equal(events.filter((event) => event.type === 'response.create').length, 2);
});

test('can add an audio-stop gate to a server-authored response after a function call', () => {
  const { coordinator, events } = testCoordinator();
  coordinator.handleResponseCreated({ id: 'server-response' });
  coordinator.requireActiveAudioStop('server-response');
  coordinator.request({ phase: 'filler', callId: 'call-1' });

  coordinator.handleResponseDone({ id: 'server-response' });
  assert.equal(events.filter((event) => event.type === 'response.create').length, 0);

  coordinator.handleAudioStopped('server-response');
  assert.equal(events.filter((event) => event.type === 'response.create').length, 1);
});
