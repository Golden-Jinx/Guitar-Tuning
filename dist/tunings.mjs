// Every notes array is ordered from the lowest/thickest string to the highest.
// Guitar note names and scientific octave numbers checked against Peterson:
// https://www.petersontuners.com/media/pdf/Guided%20Tuning%20Manual.pdf
// Additional manufacturer cross-check for Drop D, Double Drop D, DADGAD, Open D/G:
// https://www.earthquakerdevices.com/blog-posts/a-crash-course-in-alternate-tunings
// Four-, five- and six-string bass note order checked against Fender's manual:
// https://www.fmicassets.com/Damroot/Original/10001/OM_leg_bass_2013_Fender_Bass_Guitars_Owners_Manual_English.pdf

const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const NATURALS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// A0 is useful for a five-string bass dropped a whole step. At A4 = 440 Hz,
// this supported target range is 27.50–1975.53 Hz (A0–B6).
export const MIN_TARGET_MIDI = 21;
export const MAX_TARGET_MIDI = 95;

const presets = [
  { id: 'guitar-standard', name: 'Standard', subtitle: 'E A D G B E', instrument: 'guitar', notes: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
  { id: 'guitar-drop-d', name: 'Drop D', subtitle: 'D A D G B E', instrument: 'guitar', notes: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
  { id: 'guitar-double-drop-d', name: 'Double Drop D', subtitle: 'D A D G B D', instrument: 'guitar', notes: ['D2', 'A2', 'D3', 'G3', 'B3', 'D4'] },
  { id: 'guitar-dadgad', name: 'DADGAD', subtitle: 'D A D G A D', instrument: 'guitar', notes: ['D2', 'A2', 'D3', 'G3', 'A3', 'D4'] },
  { id: 'guitar-open-c', name: 'Open C', subtitle: 'C G C G C E', instrument: 'guitar', notes: ['C2', 'G2', 'C3', 'G3', 'C4', 'E4'] },
  { id: 'guitar-open-d', name: 'Open D', subtitle: 'D A D F# A D', instrument: 'guitar', notes: ['D2', 'A2', 'D3', 'F#3', 'A3', 'D4'] },
  { id: 'guitar-open-g', name: 'Open G', subtitle: 'D G D G B D', instrument: 'guitar', notes: ['D2', 'G2', 'D3', 'G3', 'B3', 'D4'] },
  { id: 'guitar-drop-c', name: 'Drop C', subtitle: 'C G C F A D', instrument: 'guitar', notes: ['C2', 'G2', 'C3', 'F3', 'A3', 'D4'] },
  { id: 'guitar-half-step-down', name: 'Eb Standard', subtitle: 'Eb Ab Db Gb Bb Eb', instrument: 'guitar', notes: ['Eb2', 'Ab2', 'Db3', 'Gb3', 'Bb3', 'Eb4'] },
  { id: 'guitar-whole-step-down', name: 'D Standard', subtitle: 'D G C F A D', instrument: 'guitar', notes: ['D2', 'G2', 'C3', 'F3', 'A3', 'D4'] },
  { id: 'guitar-7-standard', name: '7-string standard', subtitle: 'B E A D G B E', instrument: 'guitar', notes: ['B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
  { id: 'bass-standard', name: '4-string standard', subtitle: 'E A D G', instrument: 'bass', notes: ['E1', 'A1', 'D2', 'G2'] },
  { id: 'bass-drop-d', name: 'Drop D', subtitle: 'D A D G', instrument: 'bass', notes: ['D1', 'A1', 'D2', 'G2'] },
  { id: 'bass-5-standard', name: '5-string standard', subtitle: 'B E A D G', instrument: 'bass', notes: ['B0', 'E1', 'A1', 'D2', 'G2'] },
  { id: 'bass-6-standard', name: '6-string standard', subtitle: 'B E A D G C', instrument: 'bass', notes: ['B0', 'E1', 'A1', 'D2', 'G2', 'C3'] },
];

export const PRESETS = Object.freeze(presets.map(preset => Object.freeze({ ...preset, notes: Object.freeze(preset.notes) })));

/** Parse scientific pitch notation, e.g. E2, f#3, B♭0. Octaves 0–8. */
export function parseNote(input) {
  if (typeof input !== 'string') return null;
  const match = /^([A-G])([#b♯♭]?)([0-8])$/i.exec(input.trim());
  if (!match) return null;
  const accidental = match[2];
  const offset = accidental === '#' || accidental === '♯' ? 1 : accidental === 'b' || accidental === 'B' || accidental === '♭' ? -1 : 0;
  // Do not reduce the pitch class modulo 12: B#3 is C4, and Cb4 is B3.
  return (Number(match[3]) + 1) * 12 + NATURALS[match[1].toUpperCase()] + offset;
}

/** Format an integer MIDI note in the MIDI range 0–127; otherwise return null. */
export function midiToNote(midi, preferFlats = false) {
  if (!Number.isInteger(midi) || midi < 0 || midi > 127) return null;
  const names = preferFlats ? FLATS : SHARPS;
  return `${names[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

/** Equal-temperament frequency from a note name or integer MIDI note. */
export function noteFrequency(note, a4 = 440) {
  const midi = typeof note === 'number' ? (midiToNote(note) === null ? null : note) : parseNote(note);
  if (midi === null || !Number.isFinite(a4) || a4 <= 0) return null;
  return a4 * 2 ** ((midi - 69) / 12);
}

/** Validate 1–12 strings. Text may use spaces, commas or semicolons. */
export function validateNotes(input) {
  const fail = error => ({ notes: [], error });
  let tokens;
  if (typeof input === 'string') {
    tokens = input.trim().split(/[\s,，、;；]+/u).filter(Boolean);
  } else if (Array.isArray(input)) {
    tokens = input;
  } else {
    return fail('Enter the notes for each string, e.g. E2 A2 D3 G3 B3 E4.');
  }
  if (tokens.length < 1 || tokens.length > 12) return fail('Enter 1–12 notes, separated by spaces or commas.');
  const notes = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const midi = parseNote(token);
    if (midi === null) return fail(`Invalid note for string ${index + 1}. Use E2, F#3 or Bb1; the number is the octave.`);
    if (midi < MIN_TARGET_MIDI || midi > MAX_TARGET_MIDI) return fail(`String ${index + 1} is out of range. Choose a note from A0–B6.`);
    // Preserve a user's flat spelling, while normalizing letter case, Unicode
    // accidentals and uncommon enharmonics such as B#3 -> C4 or Cb4 -> B3.
    const preferFlats = /^[A-G][b♭]/i.test(token.trim());
    notes.push(midiToNote(midi, preferFlats));
  }
  // Re-entrant/custom tunings can repeat notes or be unordered; preserve order.
  return { notes, error: null };
}
