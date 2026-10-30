import test from 'node:test';
import assert from 'node:assert/strict';
import { bindStringInteraction } from '../dist/interaction.mjs';

function harness() {
  let clock = 0;
  const calls = [];
  const listeners = new Map();
  const button = {
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) { if (listeners.get(type) === handler) listeners.delete(type); },
    setPointerCapture() {},
  };
  const unbind = bindStringInteraction(button, { select: () => calls.push('select'), play: () => calls.push('play') }, () => clock);
  const send = (type, values = {}) => {
    const event = { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 50, clientY: 50,
      detail: 1, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...values };
    listeners.get(type)?.(event);
    return event;
  };
  const advance = ms => { clock += ms; };
  const tap = (values = {}, duration = 50) => { send('pointerdown', values); advance(duration); return send('pointerup', values); };
  return { calls, send, advance, tap, unbind };
}

test('touch taps select immediately and a second nearby tap plays synchronously after selecting', () => {
  const h = harness();
  assert.equal(h.tap().prevented, true);
  assert.deepEqual(h.calls, ['select']);
  h.advance(100);
  h.tap({ clientX: 66, clientY: 50 });
  assert.deepEqual(h.calls, ['select', 'select', 'play']);
  for (const type of ['click', 'dblclick']) {
    const event = h.send(type);
    assert.equal(event.prevented, true);
    assert.equal(event.stopped, true);
  }
  assert.deepEqual(h.calls, ['select', 'select', 'play']);
});

test('pen uses the same gesture and a third tap begins a fresh pair', () => {
  const h = harness();
  h.tap({ pointerType: 'pen' }); h.advance(70); h.tap({ pointerType: 'pen' });
  h.advance(70); h.tap({ pointerType: 'pen' });
  assert.deepEqual(h.calls, ['select', 'select', 'play', 'select']);
});

test('taps too far apart in time or space do not play', () => {
  const h = harness();
  h.tap(); h.advance(351); h.tap(); h.advance(70); h.tap({ clientX: 75 });
  assert.deepEqual(h.calls, ['select', 'select', 'select']);
});

test('scroll movement stays cancelled even when the pointer returns to the start', () => {
  const h = harness();
  h.tap(); h.advance(50); h.send('pointerdown');
  const move = h.send('pointermove', { clientY: 75 });
  assert.equal(move.prevented, false, 'normal panning must remain possible');
  h.send('pointermove'); h.advance(40); h.send('pointerup');
  h.send('click'); h.advance(50); h.tap();
  assert.deepEqual(h.calls, ['select', 'select']);
});

test('cancelled pointers, capture loss and long presses cannot complete a double tap', () => {
  for (const cancelType of ['pointercancel', 'lostpointercapture', 'long']) {
    const h = harness();
    h.tap(); h.advance(50); h.send('pointerdown');
    if (cancelType === 'long') { h.advance(501); h.send('pointerup'); }
    else { h.send(cancelType); h.send('pointerup'); }
    h.send('click'); h.advance(50); h.tap();
    assert.deepEqual(h.calls, ['select', 'select'], cancelType);
  }
});

test('genuine mouse use after touch is not blocked and preserves desktop double-click behavior', () => {
  const h = harness();
  h.tap();
  h.send('pointerdown', { pointerType: 'mouse' }); h.send('click', { pointerType: 'mouse' });
  h.send('pointerdown', { pointerType: 'mouse' }); h.send('click', { pointerType: 'mouse', detail: 2 });
  h.send('dblclick', { pointerType: 'mouse', detail: 2 });
  assert.deepEqual(h.calls, ['select', 'select', 'select', 'play']);
});

test('keyboard click and Shift+Enter remain usable immediately after touch', () => {
  const h = harness();
  h.tap(); h.send('click', { detail: 0 });
  assert.equal(h.send('keydown', { key: 'Enter', shiftKey: true }).prevented, true);
  assert.deepEqual(h.calls, ['select', 'select', 'select', 'play']);
});

test('unbinding removes interactions', () => {
  const h = harness();
  h.unbind(); h.tap(); h.send('click', { detail: 0 }); h.send('dblclick');
  assert.deepEqual(h.calls, []);
});
