import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPitch, frequencyToMidi, midiToFrequency, centsBetween } from '../dist/pitch.mjs';

function tone(frequency, sampleRate, { harmonics = [1], decay = 0, phase = 0.37, noise = 0, dc = 0, length = 8192 } = {}) {
  let seed = 0x164ab12;
  const samples = new Float32Array(length);
  const normalization = harmonics.reduce((sum, amplitude) => sum + Math.abs(amplitude), 0) || 1;
  for (let i = 0; i < length; i++) {
    const time = i / sampleRate;
    let value = 0;
    for (let harmonic = 0; harmonic < harmonics.length; harmonic++) {
      value += harmonics[harmonic] * Math.sin(2 * Math.PI * frequency * (harmonic + 1) * time + phase * (harmonic + 1));
    }
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    samples[i] = dc + 0.65 * value / normalization * Math.exp(-decay * time) + noise * (seed / 2 ** 31 - 1);
  }
  return samples;
}

function assertPitch(frequency, rate, options = {}, maxCents = 2) {
  const result = detectPitch(tone(frequency, rate, options), rate, { minFrequency: 26, maxFrequency: 2100 });
  assert.ok(result, `No pitch for ${frequency} Hz at ${rate} Hz`);
  const cents = centsBetween(result.frequency, frequency);
  assert.ok(Math.abs(cents) <= maxCents,
    `Expected ${frequency.toFixed(3)} Hz, got ${result.frequency.toFixed(3)} Hz (${cents.toFixed(2)} cents) at ${rate}`);
  assert.ok(result.confidence > 0.85, `Unexpected confidence ${result.confidence}`);
  assert.ok(result.rms > 0.003);
}

test('MIDI, reference pitch, and cent conversions', () => {
  assert.equal(frequencyToMidi(440), 69);
  assert.equal(midiToFrequency(69), 440);
  assert.equal(midiToFrequency(69, 442), 442);
  assert.equal(frequencyToMidi(442, 442), 69);
  assert.ok(Math.abs(centsBetween(880, 440) - 1200) < 1e-9);
  assert.ok(Math.abs(centsBetween(440, 880) + 1200) < 1e-9);
  for (const midi of [23, 28, 40, 45, 64, 69, 95]) {
    assert.ok(Math.abs(frequencyToMidi(midiToFrequency(midi)) - midi) < 1e-10);
  }
});

for (const rate of [44100, 48000]) {
  test(`8192-sample pure tones from B0 to B6 at ${rate} Hz`, () => {
    for (const midi of [23, 28, 40, 45, 64, 69, 83, 95]) assertPitch(midiToFrequency(midi), rate);
  });

  test(`fractional sample periods do not cause octave-down errors at ${rate} Hz`, () => {
    for (const frequency of [1193.1224345, 1415.5951874, 1644.0362336, 1752.8980565, 1909.3418524]) {
      assertPitch(frequency, rate, {}, 3);
    }
  });

  test(`sharp and flat tones at ${rate} Hz`, () => {
    for (const [midi, cents] of [[23, -23], [28, 31], [40, -46], [45, 17], [69, -35]]) {
      assertPitch(midiToFrequency(midi) * 2 ** (cents / 1200), rate);
    }
  });

  test(`harmonic-rich guitar and bass plucks at ${rate} Hz`, () => {
    for (const midi of [23, 28, 36, 40, 45, 52, 64]) {
      assertPitch(midiToFrequency(midi), rate, {
        harmonics: [0.55, 1, 0.72, 0.4, 0.23, 0.1], decay: 4.5, noise: 0.002,
      }, 3);
    }
  });

  test(`dominant harmonics do not hide a measurable fundamental at ${rate} Hz`, () => {
    for (const midi of [23, 28, 40, 45]) {
      assertPitch(midiToFrequency(midi), rate, { harmonics: [0.2, 1, 0.05, 0.2], decay: 1.5 }, 3);
      assertPitch(midiToFrequency(midi), rate, { harmonics: [0.2, 0.05, 1, 0.1], decay: 1.5 }, 3);
    }
  });
}

test('default 12 kHz analysis works for bass and guitar', () => {
  for (const frequency of [30.8677063, 41.2034446, 82.4068892, 110, 329.6275569, 440, 1318.51023]) {
    const result = detectPitch(tone(frequency, 48000), 48000);
    assert.ok(result);
    assert.ok(Math.abs(centsBetween(result.frequency, frequency)) < 3);
  }
});

test('removes DC offset, rejects silence, quiet input, seeded white noise, and invalid input', () => {
  assertPitch(110, 48000, { dc: 0.25 });
  assert.equal(detectPitch(new Float32Array(8192), 48000), null);
  assert.equal(detectPitch(new Float32Array(8192).fill(0.5), 48000), null);
  const quiet = tone(110, 48000);
  for (let i = 0; i < quiet.length; i++) quiet[i] *= 0.001;
  assert.equal(detectPitch(quiet, 48000), null);
  const noise = tone(110, 48000, { harmonics: [], noise: 0.5 });
  assert.equal(detectPitch(noise, 48000), null);
  assert.equal(detectPitch(tone(110, 48000), 0), null);
  assert.equal(detectPitch(tone(110, 48000), 48000, { minFrequency: -1 }), null);
  assert.equal(detectPitch(new Float32Array(20), 48000), null);
  const invalid = tone(110, 48000);
  invalid[27] = NaN;
  assert.equal(detectPitch(invalid, 48000), null);
});

test('search range is respected and can extend above default maximum', () => {
  assert.equal(detectPitch(tone(30.8677063, 48000), 48000, { minFrequency: 50 }), null);
  assertPitch(2050, 48000, {}, 3);
});
