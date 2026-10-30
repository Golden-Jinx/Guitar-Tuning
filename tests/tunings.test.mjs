import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, MIN_TARGET_MIDI, MAX_TARGET_MIDI, parseNote, midiToNote, noteFrequency, validateNotes } from '../dist/tunings.mjs';

test('scientific note notation and enharmonic octave crossings', () => {
  assert.equal(parseNote('C4'), 60);
  assert.equal(parseNote(' A4 '), 69);
  assert.equal(parseNote('B0'), 23);
  assert.equal(parseNote('f♯3'), 54);
  assert.equal(parseNote('b♭1'), 34);
  assert.equal(parseNote('Eb2'), 39);
  assert.equal(parseNote('B#3'), 60);
  assert.equal(parseNote('Cb4'), 59);
  assert.equal(parseNote('E#4'), 65);
  assert.equal(parseNote('Fb4'), 64);
  assert.equal(parseNote('C0'), 12);
  assert.equal(parseNote('B8'), 119);
  for (const invalid of [null, undefined, 60, '', 'E', 'H2', 'E22', 'C-1', 'A9', 'A4.0', 'C##4', 'E 2', '440']) {
    assert.equal(parseNote(invalid), null, String(invalid));
  }
});

test('MIDI formatting uses consistent octave boundaries and accidental preference', () => {
  assert.equal(midiToNote(60), 'C4');
  assert.equal(midiToNote(61), 'C#4');
  assert.equal(midiToNote(61, true), 'Db4');
  assert.equal(midiToNote(0), 'C-1');
  assert.equal(midiToNote(127), 'G9');
  for (const invalid of [null, undefined, '60', -1, 128, 60.5, NaN, Infinity]) assert.equal(midiToNote(invalid), null);
  for (let midi = MIN_TARGET_MIDI; midi <= MAX_TARGET_MIDI; midi += 1) {
    assert.equal(parseNote(midiToNote(midi)), midi);
    assert.equal(parseNote(midiToNote(midi, true)), midi);
  }
});

test('frequencies use equal temperament and configurable A4 calibration', () => {
  assert.equal(noteFrequency('A4'), 440);
  assert.equal(noteFrequency(69, 432), 432);
  assert.equal(noteFrequency('A0'), 27.5);
  assert.ok(Math.abs(noteFrequency('E2') - 82.4068892282) < 1e-8);
  assert.ok(Math.abs(noteFrequency('B0') - 30.8677063285) < 1e-8);
  assert.equal(noteFrequency('B#3'), noteFrequency('C4'));
  assert.equal(noteFrequency('Bb2'), noteFrequency('A#2'));
  assert.equal(noteFrequency('E2', 432) / noteFrequency('E2'), 432 / 440);
  for (const invalid of ['H2', '', null, -1, 128, 60.1]) assert.equal(noteFrequency(invalid), null);
  for (const a4 of [0, -440, NaN, Infinity, '440']) assert.equal(noteFrequency('E2', a4), null);
});

test('custom input accepts everyday separators and normalizes flat and sharp notation', () => {
  assert.deepEqual(validateNotes(' e2，a2;D3\nG3、b3 E4 '), { notes: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], error: null });
  assert.deepEqual(validateNotes(['f♯3', 'b♭1', 'B#3', 'Cb4']), { notes: ['F#3', 'Bb1', 'C4', 'B3'], error: null });
  assert.deepEqual(validateNotes('B0 E1 A1 D2 G2 C3').notes, ['B0', 'E1', 'A1', 'D2', 'G2', 'C3']);
  // Some custom string orders are deliberately re-entrant, and repeated notes
  // occur in unison/octave courses; validation must not reorder or reject them.
  assert.deepEqual(validateNotes('E4 E2 E2').notes, ['E4', 'E2', 'E2']);
  assert.equal(validateNotes(Array(12).fill('A2')).error, null);
});

test('invalid and out-of-range custom tunings fail with usable English feedback', () => {
  for (const input of [null, {}, [], '', '  , ; ', ['A2', 440], Array(13).fill('E2'), 'E A D G B E', 'A9', 'C0', 'G#0', 'C7']) {
    const result = validateNotes(input);
    assert.deepEqual(result.notes, [], JSON.stringify(input));
    assert.equal(typeof result.error, 'string');
    assert.match(result.error, /[A-Za-z]/);
    assert.doesNotMatch(result.error, /[\u3400-\u9fff]/u);
  }
  assert.match(validateNotes('E2 A').error, /string 2/);
  assert.equal(validateNotes('A0 B6').error, null);
  assert.equal(validateNotes('Cb7').error, null); // Cb7 sounds B6.
  assert.match(validateNotes('B#6').error, /A0–B6/);
});

test('presets preserve correct sounding octave and complete expected guitar/bass coverage', () => {
  const expected = {
    'guitar-standard': ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'],
    'guitar-drop-d': ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'],
    'guitar-double-drop-d': ['D2', 'A2', 'D3', 'G3', 'B3', 'D4'],
    'guitar-dadgad': ['D2', 'A2', 'D3', 'G3', 'A3', 'D4'],
    'guitar-open-c': ['C2', 'G2', 'C3', 'G3', 'C4', 'E4'],
    'guitar-open-d': ['D2', 'A2', 'D3', 'F#3', 'A3', 'D4'],
    'guitar-open-g': ['D2', 'G2', 'D3', 'G3', 'B3', 'D4'],
    'guitar-drop-c': ['C2', 'G2', 'C3', 'F3', 'A3', 'D4'],
    'guitar-half-step-down': ['Eb2', 'Ab2', 'Db3', 'Gb3', 'Bb3', 'Eb4'],
    'guitar-whole-step-down': ['D2', 'G2', 'C3', 'F3', 'A3', 'D4'],
    'guitar-7-standard': ['B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4'],
    'bass-standard': ['E1', 'A1', 'D2', 'G2'],
    'bass-drop-d': ['D1', 'A1', 'D2', 'G2'],
    'bass-5-standard': ['B0', 'E1', 'A1', 'D2', 'G2'],
    'bass-6-standard': ['B0', 'E1', 'A1', 'D2', 'G2', 'C3'],
  };
  assert.equal(new Set(PRESETS.map(preset => preset.id)).size, PRESETS.length);
  assert.equal(PRESETS.length, Object.keys(expected).length);
  for (const preset of PRESETS) {
    assert.deepEqual(preset.notes, expected[preset.id]);
    assert.deepEqual(validateNotes(preset.notes), { notes: [...preset.notes], error: null });
    assert.ok(['guitar', 'bass'].includes(preset.instrument));
    assert.ok(preset.name && preset.subtitle);
    const pitches = preset.notes.map(parseNote);
    assert.ok(pitches.every((midi, index) => index === 0 || midi > pitches[index - 1]));
  }
  const guitar = PRESETS.find(preset => preset.id === 'guitar-standard');
  const bass = PRESETS.find(preset => preset.id === 'bass-standard');
  bass.notes.forEach((note, index) => assert.equal(parseNote(guitar.notes[index]) - parseNote(note), 12));
});
