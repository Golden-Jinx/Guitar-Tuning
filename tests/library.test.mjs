import test from 'node:test';
import assert from 'node:assert/strict';
import { orderedTunings, reorderTuningIds, filterTunings } from '../dist/library.mjs';
import { PRESETS } from '../dist/tunings.mjs';

const ids = presets => presets.map(preset => preset.id);
const guitar = PRESETS.filter(preset => preset.instrument === 'guitar');
const simple = Object.freeze(['a', 'b', 'c', 'd', 'e'].map(id => Object.freeze({ id, name: id, notes: Object.freeze(['E2']) })));

test('saved order restores valid tunings once and appends new presets and custom tunings', () => {
  const custom = Object.freeze({ id: 'custom-new', name: 'New tuning', notes: Object.freeze(['C2', 'G2']) });
  const source = Object.freeze([...guitar, custom]);
  const saved = Object.freeze(['guitar-open-c', 'removed-custom', null, 5, 'guitar-open-c', 'guitar-standard']);
  const result = orderedTunings(source, saved);
  assert.deepEqual(ids(result), ['guitar-open-c', 'guitar-standard', ...ids(guitar).filter(id => !['guitar-open-c', 'guitar-standard'].includes(id)), 'custom-new']);
  assert.equal(result[0], source.find(preset => preset.id === 'guitar-open-c'));
  assert.deepEqual(ids(source), [...ids(guitar), 'custom-new']);
  assert.deepEqual(saved, ['guitar-open-c', 'removed-custom', null, 5, 'guitar-open-c', 'guitar-standard']);
});

test('missing or malformed saved order keeps the original instrument order', () => {
  for (const saved of [undefined, null, '', {}, 12]) assert.deepEqual(orderedTunings(guitar, saved), guitar);
  assert.deepEqual(orderedTunings([], ['deleted']), []);
  assert.deepEqual(orderedTunings(null, ['deleted']), []);
  assert.deepEqual(ids(orderedTunings([simple[0], simple[0], null, { name: 'Invalid' }, { id: 42 }, simple[1]], ['b'])), ['b', 'a']);
});

test('dragging up or down places a tuning on the requested side without moving the other rows', () => {
  assert.deepEqual(reorderTuningIds(simple, [], 'b', 'd'), ['a', 'c', 'b', 'd', 'e']);
  assert.deepEqual(reorderTuningIds(simple, [], 'b', 'd', 'after'), ['a', 'c', 'd', 'b', 'e']);
  assert.deepEqual(reorderTuningIds(simple, [], 'd', 'b', 'before'), ['a', 'd', 'b', 'c', 'e']);
  assert.deepEqual(reorderTuningIds(simple, [], 'd', 'b', 'after'), ['a', 'b', 'd', 'c', 'e']);
  assert.deepEqual(reorderTuningIds(simple, [], 'e', 'a'), ['e', 'a', 'b', 'c', 'd']);
  assert.deepEqual(reorderTuningIds(simple, [], 'a', 'e', 'after'), ['b', 'c', 'd', 'e', 'a']);
});

test('reordering search matches retains hidden tunings and their relative order', () => {
  const saved = Object.freeze(['d', 'a', 'e', 'b', 'c']);
  // Only d and b are visible in the search results. The complete library is
  // passed to the move operation so a, e and c remain present and in order.
  assert.deepEqual(reorderTuningIds(simple, saved, 'b', 'd'), ['b', 'd', 'a', 'e', 'c']);
  assert.deepEqual(reorderTuningIds(simple, saved, 'd', 'b', 'after'), ['a', 'e', 'b', 'd', 'c']);
  assert.deepEqual(saved, ['d', 'a', 'e', 'b', 'c']);
});

test('unavailable, identical or invalid drop targets leave the normalized order intact', () => {
  const saved = Object.freeze(['c', 'stale', 'c', 'a']);
  const expected = ['c', 'a', 'b', 'd', 'e'];
  for (const [source, target, placement] of [
    ['missing', 'a', 'before'], ['a', 'missing', 'after'], ['a', 'a', 'before'],
    ['a', 'c', 'inside'], [null, 'a', 'before'], ['a', 4, 'before'],
  ]) assert.deepEqual(reorderTuningIds(simple, saved, source, target, placement), expected);
});

test('search matches names, subtitles and notes without regard to case or query spacing', () => {
  assert.deepEqual(ids(filterTunings(guitar, ' OPEN   c ')), ['guitar-open-c']);
  assert.deepEqual(ids(filterTunings(guitar, 'open F#3')), ['guitar-open-d']);
  assert.deepEqual(ids(filterTunings(guitar, '7-string B1')), ['guitar-7-standard']);
  assert.deepEqual(ids(filterTunings(guitar, 'open z9')), []);
  const subtitleOnly = [{ id: 'custom', name: 'My tuning', subtitle: 'Alternate picking', notes: ['C2'] }];
  assert.deepEqual(filterTunings(subtitleOnly, 'PICKING c2'), subtitleOnly);
});

test('search treats Unicode and ASCII accidentals identically in the query and tuning', () => {
  assert.deepEqual(ids(filterTunings(guitar, 'OPEN f♯3')), ['guitar-open-d']);
  assert.deepEqual(ids(filterTunings(guitar, 'e♭ ab2')), ['guitar-half-step-down']);
  const unicode = [{ id: 'unicode', name: 'Flat and sharp', notes: ['B♭1', 'F♯2'] }];
  assert.deepEqual(filterTunings(unicode, 'bb1 f#2'), unicode);
});

test('custom names remain searchable in multiple languages and notes do not require a subtitle', () => {
  const customs = Object.freeze([
    Object.freeze({ id: 'cn', name: '指弹 开放调弦', notes: Object.freeze(['C2', 'G2']) }),
    Object.freeze({ id: 'jp', name: '変則 チューニング', notes: Object.freeze(['D2']) }),
    Object.freeze({ id: 'ru', name: 'Открытый строй', notes: Object.freeze(['E2']) }),
    Object.freeze({ id: 'fr', name: 'Accordage spécial', notes: Object.freeze(['F2']) }),
  ]);
  assert.deepEqual(ids(filterTunings(customs, '开放 c2')), ['cn']);
  assert.deepEqual(ids(filterTunings(customs, '変則 d2')), ['jp']);
  assert.deepEqual(ids(filterTunings(customs, 'ОТКРЫТЫЙ')), ['ru']);
  assert.deepEqual(ids(filterTunings(customs, 'SPÉCIAL')), ['fr']);
  assert.deepEqual(ids(customs), ['cn', 'jp', 'ru', 'fr']);
});

test('empty search preserves the current order and returns an independent array', () => {
  const ordered = orderedTunings(simple, ['c', 'a']);
  for (const query of ['', '  \n\t ', undefined, null]) {
    const result = filterTunings(ordered, query);
    assert.deepEqual(result, ordered);
    assert.notEqual(result, ordered);
    assert.equal(result[0], ordered[0]);
  }
});
