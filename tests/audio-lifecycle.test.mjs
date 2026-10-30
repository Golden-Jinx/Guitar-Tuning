import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as pitch from '../dist/pitch.mjs';
import * as tunings from '../dist/tunings.mjs';
import * as library from '../dist/library.mjs';

// Run the real application with inert DOM/audio boundaries. No audio lifecycle
// implementation is copied into this harness, and no real microphone is used.
const appSource = (await readFile(new URL('../dist/app.mjs', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '')
  + '\n;globalThis.appTest = { state, startListening, stopListening };';
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

class Events {
  listeners = new Map();
  addEventListener(type, fn) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(fn); this.listeners.set(type, handlers);
  }
  emit(type) { for (const fn of this.listeners.get(type) || []) fn({ target: this }); }
}
class Element extends Events {
  children = []; style = { setProperty() {} }; dataset = {}; textContent = ''; value = ''; hidden = false;
  classList = { toggle() {}, add() {}, remove() {} };
  setAttribute() {}
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  querySelector() { return this.children[0] ||= new Element(); }
  get lastChild() { return this.children.at(-1) || this.querySelector(); }
  get options() { return this.children; }
  get childElementCount() { return this.children.length; }
}
function harness() {
  const elements = new Map();
  const document = Object.assign(new Events(), {
    hidden: false,
    getElementById(id) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); },
    querySelectorAll() { return []; },
    createElement() { return new Element(); },
    createTextNode(textContent) { return { textContent }; },
  });
  const contexts = [], requests = [], timers = new Set();
  class AudioContext extends Events {
    state = 'suspended'; sampleRate = 48000; resumeCount = 0; closeCount = 0; sources = [];
    constructor() { super(); contexts.push(this); }
    resume() { this.resumeCount++; this.state = 'running'; return Promise.resolve(); }
    close() { this.closeCount++; this.state = 'closed'; return this.closeWait?.promise || Promise.resolve(); }
    createMediaStreamSource(stream) {
      const source = { stream, disconnectCount: 0, connect() {}, disconnect() { this.disconnectCount++; } };
      this.sources.push(source); return source;
    }
    createAnalyser() { return { fftSize: 2048 }; }
  }
  const window = Object.assign(new Events(), { isSecureContext: true, AudioContext });
  const mediaDevices = Object.assign(new Events(), {
    getUserMedia(constraints) { const request = { ...deferred(), constraints }; requests.push(request); return request.promise; },
    async enumerateDevices() { return []; },
  });
  const sandbox = vm.createContext({
    ...pitch, ...tunings, ...library, document, window, navigator: { mediaDevices },
    localStorage: { getItem() { return null; }, setItem() {} },
    setupTuningReorder() { return { cancel() {} }; }, bindStringInteraction() {},
    Option: class extends Element { constructor(label, value) { super(); this.textContent = label; this.value = value; } },
    performance: { now() { return 1000; } }, location: { protocol: 'https:' },
    setInterval() { const timer = {}; timers.add(timer); return timer; }, clearInterval(timer) { timers.delete(timer); },
    setTimeout() { return {}; }, clearTimeout() {}, Float32Array, console,
  });
  vm.runInContext(appSource, sandbox, { filename: 'dist/app.mjs' });
  const stream = ({ muted = false } = {}) => {
    const track = Object.assign(new Events(), { muted, stopCount: 0, stop() { this.stopCount++; } });
    return { track, getTracks() { return [track]; }, getAudioTracks() { return [track]; } };
  };
  const start = async (input = stream()) => {
    const promise = sandbox.appTest.startListening(); await flush();
    requests.at(-1).resolve(input); await promise; return input;
  };
  return { ...sandbox.appTest, document, window, contexts, requests, timers, elements, stream, start };
}

test('microphone Start creates and resumes the context synchronously before requesting input', async () => {
  const h = harness();
  const starting = h.startListening();
  assert.equal(h.contexts.length, 1);
  assert.equal(h.contexts[0].resumeCount, 1, 'resume must stay inside the initial user gesture');
  assert.equal(h.requests.length, 0);
  await flush();
  h.requests[0].resolve(h.stream()); await starting;
  assert.equal(h.state.running, true); assert.equal(h.state.pending, false);
  assert.equal(h.timers.size, 1);
  await h.stopListening();
});

test('cancelling a pending permission request stops a stream that arrives later', async () => {
  const h = harness();
  const starting = h.startListening(); await flush();
  await h.stopListening();
  const input = h.stream(); h.requests[0].resolve(input); await starting;
  assert.equal(input.track.stopCount, 1);
  assert.equal(h.contexts[0].closeCount, 1);
  assert.equal(h.state.stream, null); assert.equal(h.state.context, null);
  assert.equal(h.state.running, false); assert.equal(h.state.pending, false); assert.equal(h.timers.size, 0);
});

test('opening input can interrupt the mobile audio session and is resumed before sampling', async () => {
  const h = harness(); const starting = h.startListening(); await flush();
  h.contexts[0].state = 'interrupted'; h.requests[0].resolve(h.stream()); await starting;
  assert.equal(h.contexts[0].resumeCount, 2); assert.equal(h.contexts[0].state, 'running');
  assert.equal(h.state.running, true); assert.equal(h.timers.size, 1); await h.stopListening();
});

test('a cancelled old permission request cannot release a newer microphone session', async () => {
  const h = harness();
  const oldStart = h.startListening(); await flush(); await h.stopListening();
  const current = await h.start();
  const stale = h.stream(); h.requests[0].resolve(stale); await oldStart;
  assert.equal(stale.track.stopCount, 1); assert.equal(current.track.stopCount, 0);
  assert.equal(h.state.stream, current); assert.equal(h.state.context, h.contexts[1]);
  assert.equal(h.state.running, true); assert.equal(h.timers.size, 1);
  await h.stopListening();
});

test('mobile mute and interrupted/suspended contexts pause and release their graph', async () => {
  for (const interruption of ['mute', 'interrupted', 'suspended', 'closed']) {
    const h = harness(); const input = await h.start(); const context = h.contexts[0];
    if (interruption === 'mute') { input.track.muted = true; input.track.emit('mute'); }
    else { context.state = interruption; context.emit('statechange'); }
    await flush();
    assert.equal(h.state.running, false, interruption); assert.equal(h.state.paused, true, interruption);
    assert.equal(input.track.stopCount, 1, interruption); assert.equal(context.sources[0].disconnectCount, 1, interruption);
    assert.equal(h.state.context, null, interruption); assert.equal(h.timers.size, 0, interruption);
    assert.equal(h.elements.get('listening-status').lastChild.textContent, 'Microphone paused', interruption);
  }
});

test('an already muted input never starts sampling', async () => {
  const h = harness(); const input = await h.start(h.stream({ muted: true }));
  assert.equal(input.track.stopCount, 1); assert.equal(h.state.running, false);
  assert.equal(h.state.paused, true); assert.equal(h.timers.size, 0);
});

test('background pauses capture and foreground waits for a fresh user Start', async () => {
  const h = harness(); const original = await h.start();
  h.document.hidden = true; h.document.emit('visibilitychange'); await flush();
  assert.equal(original.track.stopCount, 1); assert.equal(h.state.paused, true);
  h.document.hidden = false; h.document.emit('visibilitychange'); await flush();
  assert.equal(h.requests.length, 1, 'foreground must not request microphone without a user gesture');
  assert.equal(h.state.running, false);
  const resumed = await h.start();
  assert.equal(h.requests.length, 2); assert.equal(h.state.running, true); assert.equal(h.state.paused, false);
  assert.equal(resumed.track.stopCount, 0); await h.stopListening();
});

test('an old close resolving after restart does not reset the new graph or UI', async () => {
  const h = harness(); await h.start();
  h.contexts[0].closeWait = deferred();
  const stopping = h.stopListening(); const current = await h.start();
  h.contexts[0].closeWait.resolve(); await stopping;
  assert.equal(h.state.stream, current); assert.equal(h.state.running, true);
  assert.equal(h.state.context, h.contexts[1]); assert.equal(h.timers.size, 1);
  assert.equal(h.elements.get('mic-toggle').querySelector('span').textContent, 'Stop');
  assert.equal(h.elements.get('guidance').textContent, 'Waiting for input');
  await h.stopListening();
});

test('an old failed Start cannot show an error over a successful quick restart', async () => {
  const h = harness();
  const failedStart = h.startListening(); await flush();
  h.contexts[0].closeWait = deferred();
  h.requests[0].reject({ name: 'NotAllowedError' }); await flush();
  await h.start();
  h.contexts[0].closeWait.resolve(); await failedStart;
  assert.equal(h.state.running, true);
  assert.equal(h.elements.get('error-box').hidden, true, 'stale failure must not overwrite the new session');
  await h.stopListening();
});

test('changing an active audio input resumes its new context within the input gesture', async () => {
  const h = harness(); const original = await h.start();
  h.contexts[0].closeWait = deferred();
  const inputSelect = h.elements.get('audio-device'); inputSelect.value = 'usb-interface';
  inputSelect.onchange();
  assert.equal(original.track.stopCount, 1);
  assert.equal(h.contexts.length, 2, 'new context must not wait for the previous asynchronous close');
  assert.equal(h.contexts[1].resumeCount, 1, 'resume must remain in the select input gesture');
  await flush();
  assert.equal(h.requests[1].constraints.audio.deviceId.exact, 'usb-interface');
  const replacement = h.stream(); h.requests[1].resolve(replacement); await flush();
  assert.equal(h.state.running, true); assert.equal(h.state.stream, replacement);
  h.contexts[0].closeWait.resolve(); await flush();
  assert.equal(h.state.context, h.contexts[1]); assert.equal(h.timers.size, 1);
  await h.stopListening();
});
