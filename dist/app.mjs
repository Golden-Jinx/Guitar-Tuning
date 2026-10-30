import { detectPitch, frequencyToMidi, centsBetween } from './pitch.mjs';
import { PRESETS, parseNote, midiToNote, noteFrequency, validateNotes } from './tunings.mjs';
import { orderedTunings, reorderTuningIds, filterTunings } from './library.mjs';
import { setupTuningReorder } from './reorder.mjs';
import { bindStringInteraction } from './interaction.mjs';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'stringroom-v1';
const defaults = { instrument: 'guitar', presetId: 'guitar-standard', a4: 440, tolerance: 5, sensitivity: .003, customs: [] };
const cleanSavedIds = value => Array.isArray(value) ? [...new Set(value.filter(id => typeof id === 'string' && id.length <= 128))].slice(0, 256) : [];
let storageOK = true;
function readSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    return {
      ...defaults,
      instrument: ['guitar', 'bass', 'chromatic'].includes(saved.instrument) ? saved.instrument : 'guitar',
      presetId: typeof saved.presetId === 'string' ? saved.presetId : defaults.presetId,
      a4: Number.isFinite(saved.a4) && saved.a4 >= 415 && saved.a4 <= 466 ? saved.a4 : 440,
      tolerance: [3, 5, 10].includes(saved.tolerance) ? saved.tolerance : 5,
      sensitivity: [.0015, .003, .008].includes(saved.sensitivity) ? saved.sensitivity : .003,
      deviceId: typeof saved.deviceId === 'string' && saved.deviceId.length <= 512 ? saved.deviceId : '',
      tuningOrder: { guitar: cleanSavedIds(saved.tuningOrder?.guitar), bass: cleanSavedIds(saved.tuningOrder?.bass) },
      customs: Array.isArray(saved.customs) ? saved.customs.filter(p => p && typeof p.name === 'string' && p.name.trim() && p.name.length <= 48 && typeof p.id === 'string' && p.id.startsWith('custom-') && ['guitar', 'bass'].includes(p.instrument) && !validateNotes(p.notes).error).map(p => ({ id: p.id, name: p.name, instrument: p.instrument, notes: validateNotes(p.notes).notes, custom: true })) : []
    };
  } catch { return { ...defaults, customs: [], tuningOrder: { guitar: [], bass: [] } }; }
}
const state = { deviceId: '', ...readSaved(), query: '', auto: true, selected: 0, matched: null, running: false, pending: false, paused: false, generation: 0, stream: null, context: null, source: null, analyser: null, timer: null, buffer: null, samples: [], lastSignal: 0, lastAnnouncement: '', lastAnnounceTime: 0, toneUntil: 0, toneContext: null, toneOscillators: [], completed: new Set() };
let tuningReorder;
const allPresets = () => [...PRESETS, ...state.customs];
const instrumentPresets = () => allPresets().filter(preset => preset.instrument === state.instrument);
function normalizeTuningOrders() {
  for (const instrument of ['guitar', 'bass']) state.tuningOrder[instrument] = orderedTunings(allPresets().filter(preset => preset.instrument === instrument), state.tuningOrder[instrument]).map(preset => preset.id);
}
function getPreset() { return allPresets().find(p => p.id === state.presetId && p.instrument === state.instrument) || allPresets().find(p => p.instrument === state.instrument) || PRESETS[0]; }
function save() {
  normalizeTuningOrders();
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ instrument: state.instrument, presetId: state.presetId, a4: state.a4, tolerance: state.tolerance, sensitivity: state.sensitivity, deviceId: state.deviceId, customs: state.customs, tuningOrder: state.tuningOrder })); }
  catch { if (storageOK) toast('Storage unavailable. Export your custom tunings to keep a backup.'); storageOK = false; }
}
let toastTimer;
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3600); }
function splitNote(note) { const m = /^([A-G][#b]?)(-?\d+)$/.exec(note); return m ? [m[1], m[2]] : [note, '']; }
function readable(note) { return note.replace('#', '♯').replace('b', '♭'); }
function make(tag, className, content) { const el = document.createElement(tag); if (className) el.className = className; if (content !== undefined) el.textContent = content; return el; }
function openDialog(id) { $(id).showModal(); }
document.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => el.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); } }));
$('help-open').onclick = () => openDialog('help-dialog');
$('settings-open').onclick = $('calibration-open').onclick = () => { syncSettings(); void refreshDevices(); openDialog('settings-dialog'); };
function renderLibrary({ resetScroll = false } = {}) {
  tuningReorder?.cancel();
  const scrollTop = resetScroll ? 0 : $('preset-list').scrollTop;
  document.querySelectorAll('[data-instrument]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.instrument === state.instrument)));
  const chromatic = state.instrument === 'chromatic';
  $('custom-open').hidden = chromatic;
  $('preset-list').hidden = chromatic;
  $('tuning-search-wrap').hidden = chromatic;
  $('preset-list').replaceChildren();
  if (chromatic) return;
  const presets = filterTunings(orderedTunings(instrumentPresets(), state.tuningOrder[state.instrument]), state.query);
  for (const preset of presets) {
    const row = make('div', `preset-item${preset.id === getPreset().id ? ' selected' : ''}`);
    row.dataset.tuningId = preset.id;
    const handle = make('button', 'reorder-handle', '⠿');
    handle.type = 'button'; handle.dataset.reorderHandle = '';
    handle.setAttribute('aria-label', `Reorder ${preset.name}`);
    handle.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown Home End');
    handle.title = 'Drag to reorder. Arrow keys move; Home moves to top.';
    row.append(handle);
    const button = make('button', 'preset-select');
    button.style.cssText = 'background:transparent;padding:0;text-align:left;flex:1;min-width:0;align-self:stretch';
    button.setAttribute('aria-pressed', String(preset.id === getPreset().id));
    button.append(make('span', 'preset-name', preset.name), make('span', 'preset-notes', preset.notes.map(readable).join('  ')));
    button.title = `${preset.subtitle || preset.name} : ${preset.notes.join(' ')}`;
    button.onclick = () => selectPreset(preset.id);
    row.append(button);
    const actions = make('span', 'preset-actions');
    if (!preset.custom && preset.notes.length !== (state.instrument === 'guitar' ? 6 : 4)) actions.append(make('span', 'preset-tag', `${preset.notes.length} strings`));
    if (preset.custom) {
      const edit = make('button', 'edit-preset', 'Edit');
      edit.setAttribute('aria-label', `Edit custom tuning ${preset.name}`);
      edit.onclick = () => openCustomTuning(preset.id);
      actions.append(edit);
      const del = make('button', 'delete-preset', '×'); del.setAttribute('aria-label', `Delete custom tuning ${preset.name}`); del.title = 'Delete custom tuning'; del.onclick = () => { state.customs = state.customs.filter(p => p.id !== preset.id); if (state.presetId === preset.id) selectPreset(PRESETS.find(p => p.instrument === state.instrument).id); else { save(); renderLibrary(); } toast('Custom tuning deleted'); }; actions.append(del);
    }
    if (actions.childElementCount) row.append(actions);
    $('preset-list').append(row);
  }
  if (!presets.length) $('preset-list').append(make('p', 'library-empty', 'No matching tunings.'));
  $('preset-list').scrollTop = scrollTop;
}
function moveTuning(sourceId, targetId, placement) {
  if (!['guitar', 'bass'].includes(state.instrument)) return;
  const full = instrumentPresets();
  const previous = orderedTunings(full, state.tuningOrder[state.instrument]).map(preset => preset.id);
  const next = reorderTuningIds(full, previous, sourceId, targetId, placement);
  if (next.join('\n') === previous.join('\n')) return;
  state.tuningOrder[state.instrument] = next;
  save(); renderLibrary();
  const row = [...$('preset-list').querySelectorAll('.preset-item')].find(element => element.dataset.tuningId === sourceId);
  row?.querySelector('[data-reorder-handle]')?.focus({ preventScroll: true });
  row?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const name = full.find(preset => preset.id === sourceId)?.name;
  $('tuning-order-status').textContent = `${name} moved to position ${next.indexOf(sourceId) + 1}.`;
}
function moveTuningWithKeyboard(sourceId, key) {
  const full = orderedTunings(instrumentPresets(), state.tuningOrder[state.instrument]);
  const visible = filterTunings(full, state.query);
  const index = visible.findIndex(preset => preset.id === sourceId);
  if (index < 0) return;
  if (key === 'Home' && full.length) moveTuning(sourceId, full[0].id, 'before');
  else if (key === 'End' && full.length) moveTuning(sourceId, full.at(-1).id, 'after');
  else if (key === 'ArrowUp' && index > 0) moveTuning(sourceId, visible[index - 1].id, 'before');
  else if (key === 'ArrowDown' && index < visible.length - 1) moveTuning(sourceId, visible[index + 1].id, 'after');
}
$('tuning-search').addEventListener('input', () => { state.query = $('tuning-search').value; renderLibrary({ resetScroll: true }); });
$('tuning-search').addEventListener('keydown', event => { if (event.key === 'Escape') { state.query = ''; $('tuning-search').value = ''; renderLibrary({ resetScroll: true }); } });
function renderStrings() {
  const chromatic = state.instrument === 'chromatic';
  const preset = getPreset();
  $('current-tuning').textContent = preset.name;
  $('strings').replaceChildren(); $('strings').className = `strings${preset.notes.length > 7 ? ' many' : ''}`;
  $('strings-section').hidden = chromatic;
  if (chromatic) return;
  $('auto-toggle').setAttribute('aria-pressed', String(state.auto));
  $('auto-toggle').textContent = state.auto ? 'Auto' : 'Locked';
  $('strings').style.setProperty('--strings', preset.notes.length);
  $('strings').dataset.count = String(preset.notes.length);
  preset.notes.forEach((note, i) => {
    const button = make('button', 'string');
    const parts = splitNote(note);
    button.setAttribute('aria-label', `String ${preset.notes.length - i}, ${note}, ${noteFrequency(note, state.a4).toFixed(2)} Hz. Tap to lock; double-tap or double-click to play.`);
    button.append(make('span', 'string-number', `${preset.notes.length - i}`));
    const label = make('span', 'string-note', readable(parts[0])); label.append(make('small', '', parts[1])); button.append(label, make('span', 'string-hz', `${noteFrequency(note, state.a4).toFixed(1)} Hz`));
    // Keep this node mounted between taps and clicks for reference playback.
    bindStringInteraction(button, { select: () => selectString(i), play: () => { void playReferenceTone(i); } });
    button.title = 'Double-tap or double-click to play reference';
    button.setAttribute('aria-keyshortcuts', 'Shift+Enter');
    $('strings').append(button);
  });
  updateActiveString();
}
function selectString(index) {
  stopTone(); state.selected = index; state.matched = index; state.auto = false; state.samples = [];
  $('auto-toggle').setAttribute('aria-pressed', 'false'); $('auto-toggle').textContent = 'Locked';
  updateActiveString(); resetReading();
}
function updateActiveString() {
  [...$('strings').children].forEach((el, i) => { const active = i === (state.auto ? state.matched : state.selected); el.classList.toggle('active', active); el.classList.toggle('tuned', state.completed.has(i)); el.setAttribute('aria-pressed', String(active)); });
}
function resetReading() {
  $('reading').dataset.state = 'idle'; $('detected-note').textContent = '—'; $('detected-octave').textContent = '';
  $('detected-frequency').textContent = '— Hz';
  $('needle').style.left = '50%'; $('needle').style.opacity = '.15'; $('needle').style.background = 'var(--ink)';
  $('gauge').setAttribute('aria-valuenow', '0'); $('gauge').setAttribute('aria-valuetext', 'No stable pitch detected');
  $('cents-value').replaceChildren(document.createTextNode('— '), make('small', '', 'cents'));
  if (!state.auto && state.instrument !== 'chromatic') { const p = getPreset(); const note = p.notes[state.selected]; $('target-label').textContent = `String ${p.notes.length - state.selected} · ${readable(note)}`; $('target-frequency').textContent = `Target ${noteFrequency(note, state.a4).toFixed(2)} Hz`; }
  else { $('target-label').textContent = state.instrument === 'chromatic' ? 'Chromatic' : 'Auto string detection'; $('target-frequency').textContent = 'Target — Hz'; }
  announce(state.running ? 'Waiting for input' : state.paused ? 'Microphone paused. Tap Start microphone to resume.' : '', true);
}
function announce(message, force = false) {
  if (force || (message !== state.lastAnnouncement && performance.now() - state.lastAnnounceTime > 550)) { $('guidance').textContent = message; state.lastAnnouncement = message; state.lastAnnounceTime = performance.now(); }
}
function selectPreset(id) {
  stopTone(); state.presetId = id; state.selected = 0; state.matched = null; state.auto = true; state.samples = []; state.completed.clear();
  save(); renderLibrary(); renderStrings(); resetReading();
}
document.querySelectorAll('[data-instrument]').forEach(el => el.onclick = () => {
  if (state.instrument === el.dataset.instrument) return;
  stopTone(); state.instrument = el.dataset.instrument;
  state.query = ''; $('tuning-search').value = '';
  $('preset-list').scrollTop = 0;
  selectPreset(state.instrument === 'chromatic' ? state.presetId : PRESETS.find(p => p.instrument === state.instrument).id);
});
$('auto-toggle').onclick = () => { state.auto = !state.auto; if (!state.auto && state.matched !== null) state.selected = state.matched; state.samples = []; renderStrings(); resetReading(); };

function updatePitch(frequency) {
  let targetMidi, targetNote, targetHz;
  if (state.instrument === 'chromatic') { targetMidi = Math.round(frequencyToMidi(frequency, state.a4)); targetNote = midiToNote(targetMidi); targetHz = noteFrequency(targetNote, state.a4); }
  else {
    const p = getPreset();
    if (state.auto) {
      const distances = p.notes.map(n => Math.abs(centsBetween(frequency, noteFrequency(n, state.a4))));
      let index = distances.indexOf(Math.min(...distances));
      if (state.matched !== null && distances[state.matched] <= distances[index] + 25) index = state.matched;
      state.matched = index;
    } else state.matched = state.selected;
    targetNote = p.notes[state.matched]; targetMidi = parseNote(targetNote); targetHz = noteFrequency(targetNote, state.a4);
  }
  const cents = centsBetween(frequency, targetHz);
  const detectedNote = midiToNote(Math.round(frequencyToMidi(frequency, state.a4)));
  const [name, octave] = splitNote(detectedNote);
  $('detected-note').textContent = readable(name); $('detected-octave').textContent = octave;
  $('detected-frequency').textContent = `${frequency.toFixed(2)} Hz`; $('target-frequency').textContent = `Target ${targetHz.toFixed(2)} Hz`;
  $('target-label').textContent = state.instrument === 'chromatic' ? `Nearest note · ${readable(targetNote)}` : `${state.auto ? 'Auto' : 'Locked'} · String ${getPreset().notes.length - state.matched} · ${readable(targetNote)}`;
  const rounded = Math.round(cents); const inTune = Math.abs(cents) <= state.tolerance;
  $('cents-value').replaceChildren(document.createTextNode(`${rounded > 0 ? '+' : ''}${rounded === 0 ? '0' : rounded} `), make('small', '', 'cents'));
  $('reading').dataset.state = inTune ? 'tuned' : cents < 0 ? 'low' : 'high';
  $('needle').style.left = `${50 + Math.max(-50, Math.min(50, cents))}%`; $('needle').style.opacity = '1'; $('needle').style.background = inTune ? 'var(--green)' : 'var(--ink)';
  $('gauge').setAttribute('aria-valuenow', String(Math.max(-50, Math.min(50, cents)).toFixed(1))); $('gauge').setAttribute('aria-valuetext', `${cents.toFixed(1)} cents, ${inTune ? 'In tune' : cents < 0 ? 'Flat' : 'Sharp'}`);
  if (inTune) { announce('In tune'); }
  else if (Math.abs(cents) > 650) announce(cents < 0 ? 'Flat · check string and octave' : 'Sharp · check string and octave');
  else announce(cents < 0 ? 'Flat · tighten' : 'Sharp · loosen');
  if (state.instrument !== 'chromatic') {
    // A visual check is a session hint, not a durable measurement of an untouched string.
    if (inTune && state.samples.length >= 3) state.completed.add(state.matched); else state.completed.delete(state.matched);
    updateActiveString();
  }
}
function sampleAudio() {
  if (!state.running || !state.analyser || state.context?.state !== 'running' || document.hidden) return;
  state.analyser.getFloatTimeDomainData(state.buffer);
  let energy = 0; for (const x of state.buffer) energy += x * x;
  const rms = Math.sqrt(energy / state.buffer.length);
  $('level-fill').style.width = `${Math.min(100, Math.max(0, (20 * Math.log10(Math.max(rms, 1e-6)) + 65) / 55 * 100))}%`;
  $('level-fill').style.background = rms > .65 ? 'var(--orange)' : 'var(--green)';
  if (performance.now() < state.toneUntil) return;
  const pitch = detectPitch(state.buffer, state.context.sampleRate, { minFrequency: 24, maxFrequency: 2300, rmsThreshold: state.sensitivity });
  if (!pitch || pitch.confidence < .8) {
    if (performance.now() - state.lastSignal > 1000) { if (state.samples.length || $('reading').dataset.state !== 'idle') { state.samples = []; resetReading(); } if (rms > state.sensitivity * 2) announce('Unstable signal'); }
    return;
  }
  state.lastSignal = performance.now();
  if (state.samples.length && Math.abs(centsBetween(pitch.frequency, state.samples.at(-1))) > 70) state.samples = [];
  state.samples.push(pitch.frequency); if (state.samples.length > 5) state.samples.shift();
  if (state.samples.length < 2) return;
  const sorted = [...state.samples].sort((a,b) => a-b); const frequency = sorted[Math.floor(sorted.length / 2)];
  updatePitch(frequency);
}
function audioError(error) {
  const name = error?.name;
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'Microphone access denied. In Windows microphone privacy settings, allow microphone access for desktop apps, then try again.';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'No audio input found. Connect a microphone or audio interface and check your system input settings.';
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'Audio input unavailable. Check the connection and close other apps using the device.';
  if (name === 'OverconstrainedError') return 'Selected input unavailable. Choose System default in Settings and try again.';
  return 'Could not start audio input. Check Windows microphone privacy settings, close other apps using this input and try again.';
}
function showError(message) { $('error-box').textContent = message; $('error-box').hidden = false; }
function updateMicUI() {
  const on = state.running;
  $('mic-toggle').disabled = false;
  $('mic-toggle').classList.toggle('running', on || state.pending);
  $('mic-toggle').querySelector('span').textContent = state.pending ? 'Cancel request' : on ? 'Stop' : 'Start microphone';
  $('listening-status').classList.toggle('active', on);
  $('listening-status').lastChild.textContent = state.pending ? 'Awaiting permission' : on ? 'Listening' : state.paused ? 'Microphone paused' : 'Microphone off';
}
async function releaseAudio() {
  clearInterval(state.timer); state.timer = null;
  state.stream?.getTracks().forEach(t => t.stop()); state.stream = null;
  try { state.source?.disconnect(); } catch {}
  state.source = null; state.analyser = null; state.buffer = null;
  const ctx = state.context; state.context = null;
  if (ctx && ctx.state !== 'closed') try { await ctx.close(); } catch {}
}
async function stopListening({ paused = false } = {}) {
  state.generation++; state.running = false; state.pending = false; state.paused = paused; state.samples = []; state.matched = null;
  // Update before closing the old context, so a quick restart cannot be reset by it.
  updateMicUI(); $('level-fill').style.width = '0%'; resetReading(); updateActiveString();
  await releaseAudio();
}
async function startListening() {
  if (state.running || state.pending) return;
  $('error-box').hidden = true;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { showError('Microphone unavailable. Open the published HTTPS link in Safari, Chrome or Edge and allow microphone access. In-app browsers may restrict recording.'); return; }
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) { showError('Audio analysis is not supported in this browser. Use a current version of Safari, Chrome or Edge.'); return; }
  const generation = ++state.generation; state.pending = true; state.paused = false; updateMicUI();
  let localContext, localStream;
  try {
    localContext = new AudioContextClass(); state.context = localContext;
    await localContext.resume();
    if (generation !== state.generation) { if (localContext.state !== 'closed') await localContext.close(); return; }
    localStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: { ideal: 1 }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, ...(state.deviceId ? { deviceId: { exact: state.deviceId } } : {}) }, video: false });
    if (generation !== state.generation) { localStream.getTracks().forEach(t => t.stop()); if (localContext.state !== 'closed') await localContext.close(); return; }
    state.stream = localStream;
    // Opening the microphone can change the audio session on mobile Safari.
    if (localContext.state !== 'running') await localContext.resume();
    if (generation !== state.generation) { localStream.getTracks().forEach(t => t.stop()); if (localContext.state !== 'closed') await localContext.close(); return; }
    state.source = localContext.createMediaStreamSource(localStream);
    state.analyser = localContext.createAnalyser(); state.analyser.fftSize = 8192; state.analyser.smoothingTimeConstant = 0;
    state.source.connect(state.analyser); // Deliberately no connection to speakers: no live monitoring or feedback.
    state.buffer = new Float32Array(state.analyser.fftSize);
    state.running = true; state.pending = false; state.lastSignal = performance.now(); state.samples = [];
    localStream.getAudioTracks().forEach(track => {
      track.addEventListener('ended', () => { if (generation === state.generation) { void stopListening(); showError('Input disconnected. Reconnect the device and start the microphone again.'); } });
      track.addEventListener('mute', () => { if (generation === state.generation && state.running) void stopListening({ paused: true }); });
    });
    localContext.addEventListener('statechange', () => {
      if (generation === state.generation && state.running && ['suspended', 'interrupted', 'closed'].includes(localContext.state)) void stopListening({ paused: true });
    });
    if (localContext.state !== 'running' || localStream.getAudioTracks().some(track => track.muted)) { await stopListening({ paused: true }); return; }
    state.timer = setInterval(sampleAudio, 65); updateMicUI(); resetReading(); await refreshDevices();
  } catch (error) {
    if (generation !== state.generation) { localStream?.getTracks().forEach(t => t.stop()); if (localContext && localContext.state !== 'closed') try { await localContext.close(); } catch {} return; }
    const stopping = stopListening(); const stoppedGeneration = state.generation;
    await stopping;
    if (stoppedGeneration === state.generation) showError(audioError(error));
  }
}
$('mic-toggle').onclick = () => { if (state.running || state.pending) void stopListening(); else void startListening(); };
async function refreshDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    $('audio-device').replaceChildren(new Option('System default', ''));
    devices.filter(d => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications').forEach((d, i) => $('audio-device').append(new Option(d.label || `Audio input ${i + 1}`, d.deviceId)));
    if ([...$('audio-device').options].some(o => o.value === state.deviceId)) $('audio-device').value = state.deviceId;
    else if (devices.some(d => d.kind === 'audioinput' && d.label)) { state.deviceId = ''; $('audio-device').value = ''; save(); }
    else if (state.deviceId) { $('audio-device').append(new Option('Saved input (enable microphone to verify)', state.deviceId)); $('audio-device').value = state.deviceId; }
  } catch { /* Device labels may be unavailable until the user grants permission. */ }
}
$('audio-device').onchange = () => {
  state.deviceId = $('audio-device').value; save();
  if (state.running || state.pending) {
    // releaseAudio detaches the previous stream before yielding. Start the new
    // context within this input gesture so mobile autoplay policy permits it.
    void stopListening(); void startListening();
  }
};
if (navigator.mediaDevices?.addEventListener) navigator.mediaDevices.addEventListener('devicechange', () => { void refreshDevices(); });
function syncSettings() { $('a4-input').value = state.a4; $('tolerance-input').value = state.tolerance; $('sensitivity-input').value = state.sensitivity; }
$('a4-input').onchange = () => { const a4 = Number($('a4-input').value); if (!Number.isFinite(a4) || a4 < 415 || a4 > 466 || !Number.isInteger(a4)) { $('a4-input').value = state.a4; toast('Enter a whole number from 415 to 466 Hz.'); return; } state.a4 = a4; $('a4-label').textContent = a4; state.samples = []; state.completed.clear(); save(); renderStrings(); resetReading(); };
$('tolerance-input').onchange = () => { state.tolerance = Number($('tolerance-input').value); state.completed.clear(); save(); updateActiveString(); };
$('sensitivity-input').onchange = () => { state.sensitivity = Number($('sensitivity-input').value); save(); };
let editingCustomId = null;
function openCustomTuning(id = null) {
  const existing = id === null ? null : state.customs.find(preset => preset.id === id);
  if (id !== null && !existing) { toast('This tuning is no longer available.'); return; }
  editingCustomId = existing?.id ?? null;
  $('custom-form').reset();
  $('custom-title').textContent = existing ? 'Edit tuning' : 'Custom tuning';
  $('custom-name').value = existing?.name ?? '';
  $('custom-notes').value = existing?.notes.join(' ') ?? '';
  $('custom-error').textContent = '';
  $('custom-preview').textContent = existing ? existing.notes.map(readable).join(' · ') : '';
  openDialog('custom-dialog');
}
$('custom-open').onclick = () => openCustomTuning();
$('custom-dialog').addEventListener('close', () => { if (!$('custom-dialog').open) editingCustomId = null; });
$('custom-notes').oninput = () => { const result = validateNotes($('custom-notes').value); $('custom-preview').textContent = result.error ? '' : result.notes.map(readable).join(' · '); $('custom-error').textContent = $('custom-notes').value.trim() && result.error ? result.error : ''; };
$('custom-form').onsubmit = e => {
  e.preventDefault(); const name = $('custom-name').value.trim(); const result = validateNotes($('custom-notes').value);
  if (!name || name.length > 48) { $('custom-error').textContent = 'Enter a name of 1–48 characters.'; return; }
  if (result.error) { $('custom-error').textContent = result.error; return; }
  const existing = editingCustomId === null ? null : state.customs.find(preset => preset.id === editingCustomId);
  if (editingCustomId !== null && !existing) { $('custom-error').textContent = 'This tuning is no longer available.'; return; }
  if (!existing && state.customs.length >= 100) { $('custom-error').textContent = 'Limit: 100 custom tunings. Export or delete unused tunings first.'; return; }
  const id = existing?.id ?? `custom-${crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)}`;
  if (existing) state.customs = state.customs.map(preset => preset.id === id ? { ...preset, name, notes: result.notes } : preset);
  else state.customs.push({ id, name, notes: result.notes, instrument: state.instrument === 'bass' ? 'bass' : 'guitar', custom: true });
  state.query = ''; $('tuning-search').value = '';
  selectPreset(id); $('custom-dialog').close(); toast(storageOK ? existing ? 'Updated' : 'Saved' : 'Storage unavailable. Export a backup.');
};
$('export-custom').onclick = () => {
  const blob = new Blob([JSON.stringify({ version: 1, tunings: state.customs.map(({ name, notes, instrument }) => ({ name, notes, instrument })) }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'stringroom-tunings.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Custom tunings exported');
};
$('import-custom').onclick = () => $('import-file').click();
$('import-file').onchange = async () => {
  const file = $('import-file').files[0]; if (!file) return;
  try {
    if (file.size > 100000) throw new Error('Backup too large. Use a JSON file exported by this tuner.');
    const data = JSON.parse(await file.text());
    if (data.version !== 1 || !Array.isArray(data.tunings) || data.tunings.length > 100) throw new Error('Unsupported backup format.');
    const restored = data.tunings.map(p => { const result = validateNotes(p?.notes); if (result.error || !['guitar','bass'].includes(p.instrument) || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 48) throw new Error('Backup contains invalid tunings. Nothing was imported.'); return { id: `custom-${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`, name: p.name.trim(), notes: result.notes, instrument: p.instrument, custom: true }; });
    const seen = new Set(state.customs.map(p => JSON.stringify([p.name, p.instrument, p.notes])));
    const additions = restored.filter(p => { const key = JSON.stringify([p.name, p.instrument, p.notes]); if (seen.has(key)) return false; seen.add(key); return true; });
    if (state.customs.length + additions.length > 100) throw new Error('Import would exceed 100 custom tunings. Delete unused tunings first.');
    state.customs.push(...additions); save(); renderLibrary(); $('settings-message').textContent = `Imported ${additions.length} tuning(s). Duplicates skipped.`; toast($('settings-message').textContent);
  } catch (error) { $('settings-message').textContent = error instanceof SyntaxError ? 'Not a valid JSON backup.' : error.message; }
  finally { $('import-file').value = ''; }
};
let toneGeneration = 0;
function stopTone() { toneGeneration++; for (const oscillator of state.toneOscillators) { try { oscillator.stop(); } catch {} } state.toneOscillators = []; state.toneUntil = performance.now() + 450; }
async function playReferenceTone(index) {
  try {
    const p = getPreset(); const note = p.notes[index];
    if (state.instrument === 'chromatic' || !note) return;
    stopTone(); const generation = toneGeneration; const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!state.toneContext || state.toneContext.state === 'closed') state.toneContext = new AudioContextClass();
    await state.toneContext.resume(); if (generation !== toneGeneration) return;
    const context = state.toneContext;
    const frequency = noteFrequency(note, state.a4); const now = context.currentTime;
    const gain = context.createGain(); gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(.15, now + .025); gain.gain.exponentialRampToValueAtTime(.001, now + 1.8); gain.connect(context.destination);
    for (const [harmonic, volume] of [[1, 1], [2, .25], [3, .08]]) { const osc = context.createOscillator(); const amp = context.createGain(); osc.type = 'sine'; osc.frequency.value = frequency * harmonic; amp.gain.value = volume; osc.connect(amp); amp.connect(gain); osc.start(now); osc.stop(now + 1.9); state.toneOscillators.push(osc); }
    state.samples = []; state.toneUntil = performance.now() + 2400;
    announce(`Reference ${readable(note)} · ${frequency.toFixed(2)} Hz`, true);
    setTimeout(() => { if (generation === toneGeneration && !state.running) announce('', true); }, 2400);
  } catch { toast('Could not play reference. Check your system audio output and try again.'); }
}
window.addEventListener('pagehide', () => {
  void stopListening({ paused: state.running || state.pending || state.paused }); stopTone();
  const context = state.toneContext; state.toneContext = null;
  if (context && context.state !== 'closed') void context.close().catch(() => {});
});
// Mobile browsers may interrupt audio when locked or backgrounded. Restart on a
// fresh user gesture, rather than leaving a silent graph labelled "Listening".
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (state.running || state.pending) void stopListening({ paused: true });
    stopTone();
  } else if (state.paused) resetReading();
});
tuningReorder = setupTuningReorder($('preset-list'), { onMove: moveTuning, onKeyboardMove: moveTuningWithKeyboard });
normalizeTuningOrders();
$('a4-label').textContent = state.a4; syncSettings(); renderLibrary(); renderStrings(); resetReading(); if (navigator.mediaDevices?.enumerateDevices) void refreshDevices();
if ('serviceWorker' in navigator && ['https:', 'http:'].includes(location.protocol)) navigator.serviceWorker.register('./sw.js').catch(() => {});
