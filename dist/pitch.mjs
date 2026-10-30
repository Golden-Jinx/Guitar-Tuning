/** MIDI uses A4 = 69. Fractional results retain detuning in semitones. */
export function frequencyToMidi(frequency, reference = 440) {
  return 69 + 12 * Math.log2(frequency / reference);
}

export function midiToFrequency(midi, reference = 440) {
  return reference * 2 ** ((midi - 69) / 12);
}

/** Positive cents mean that frequency is sharper than the target. */
export function centsBetween(frequency, targetFrequency) {
  return 1200 * Math.log2(frequency / targetFrequency);
}

const filterCache = new Map();

function decimationFilter(factor) {
  if (filterCache.has(factor)) return filterCache.get(factor);
  // Windowed-sinc anti-alias filter. The useful passband includes the highest
  // requested note because decimation always leaves >= 8 samples per cycle.
  const half = 4 * factor;
  const coefficients = new Float64Array(half * 2 + 1);
  const cutoff = 0.45 / factor;
  let total = 0;
  for (let k = -half; k <= half; k++) {
    const sinc = k === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * k) / (Math.PI * k);
    const window = 0.42 + 0.5 * Math.cos(Math.PI * k / half) + 0.08 * Math.cos(2 * Math.PI * k / half);
    coefficients[k + half] = sinc * window;
    total += coefficients[k + half];
  }
  for (let k = 0; k < coefficients.length; k++) coefficients[k] /= total;
  filterCache.set(factor, coefficients);
  return coefficients;
}

function downsample(samples, factor, mean) {
  if (factor === 1) {
    const output = new Float32Array(samples.length);
    for (let i = 0; i < output.length; i++) output[i] = samples[i] - mean;
    return output;
  }
  const filter = decimationFilter(factor);
  const length = Math.floor((samples.length - filter.length) / factor) + 1;
  if (length < 1) return new Float32Array(0);
  const output = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    const start = i * factor;
    for (let j = 0; j < filter.length; j++) sum += samples[start + j] * filter[j];
    output[i] = sum - mean;
  }
  return output;
}

function interpolatedMinimum(values, index) {
  if (index < 1 || index >= values.length - 1) return index;
  const left = values[index - 1];
  const center = values[index];
  const right = values[index + 1];
  const denominator = left - 2 * center + right;
  if (denominator <= 0) return index;
  return index + Math.max(-0.5, Math.min(0.5, (left - right) / (2 * denominator)));
}

function minimumValue(values, index) {
  if (index < 1 || index >= values.length - 1) return values[index];
  const left = values[index - 1];
  const center = values[index];
  const right = values[index + 1];
  const denominator = left - 2 * center + right;
  if (denominator <= 0) return center;
  // Compare fitted troughs: integer-lag values alone can make a high pure sine
  // appear less periodic than its octave-down multiple through quantization.
  return Math.max(0, center - (left - right) ** 2 / (8 * denominator));
}

/**
 * Estimate one monophonic fundamental using fixed-window YIN / CMNDF.
 *
 * samples: one unwindowed PCM frame, normally an AnalyserNode Float32Array.
 * sampleRate: actual AudioContext rate (44.1 or 48 kHz both work).
 * minFrequency / maxFrequency: inclusive Hz search bounds; no tuning target is
 * used. An 8192-sample frame is recommended for low B0 and dropped bass notes.
 * rmsThreshold: gate for PCM amplitudes in [-1, 1], after removing DC offset.
 * threshold: YIN aperiodicity threshold; smaller values require cleaner tones.
 *
 * Returns { frequency, confidence, rms }, or null for silence / insufficient
 * periodicity. Confidence is a periodicity measure, not a calibrated probability.
 * Pluck one string at a time: chords and severely distorted signals are ambiguous.
 */
export function detectPitch(samples, sampleRate, {
  minFrequency = 24,
  maxFrequency = 1400,
  rmsThreshold = 0.003,
  threshold = 0.13,
} = {}) {
  if (!samples || samples.length < 64 || !Number.isFinite(sampleRate) || sampleRate <= 0 ||
      !Number.isFinite(minFrequency) || minFrequency <= 0 ||
      !Number.isFinite(maxFrequency) || maxFrequency <= minFrequency ||
      !Number.isFinite(rmsThreshold) || rmsThreshold < 0 ||
      !Number.isFinite(threshold) || threshold <= 0 || threshold >= 1) return null;

  let mean = 0;
  let squareSum = 0;
  for (let i = 0; i < samples.length; i++) {
    const value = samples[i];
    if (!Number.isFinite(value)) return null;
    mean += value;
    squareSum += value * value;
  }
  mean /= samples.length;
  const rms = Math.sqrt(Math.max(0, squareSum / samples.length - mean * mean));
  if (rms < rmsThreshold || rms < 1e-9) return null;

  // About 12 kHz is sufficient for normal guitar/bass. Wider configured ranges
  // automatically retain a higher rate, avoiding poor high-note resolution.
  const factor = Math.max(1, Math.floor(sampleRate / Math.max(12000, maxFrequency * 8)));
  const rate = sampleRate / factor;
  const signal = downsample(samples, factor, mean);
  const minLag = Math.max(2, Math.floor(rate / maxFrequency));
  const maxLag = Math.min(Math.ceil(rate / minFrequency), Math.floor((signal.length - 1) / 2));
  if (maxLag <= minLag + 2) return null;
  const windowLength = signal.length - maxLag - 1;
  if (windowLength < 32) return null;

  const difference = new Float64Array(maxLag + 2);
  const normalized = new Float64Array(maxLag + 2);
  normalized[0] = 1;
  let cumulative = 0;
  for (let lag = 1; lag <= maxLag + 1; lag++) {
    let sum = 0;
    for (let i = 0; i < windowLength; i++) {
      const delta = signal[i] - signal[i + lag];
      sum += delta * delta;
    }
    difference[lag] = sum;
    cumulative += sum;
    normalized[lag] = cumulative > 0 ? sum * lag / cumulative : 1;
  }

  let candidate = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (normalized[lag] < threshold) {
      while (lag < maxLag && normalized[lag + 1] < normalized[lag]) lag++;
      candidate = lag;
      break;
    }
  }
  if (candidate < 0) return null;

  // A strong second/third harmonic can create an early YIN minimum. Prefer a
  // longer integer-multiple period only when it measurably explains MORE of the
  // waveform. Absolute and relative improvements keep clean sines from being
  // reported one octave too low due merely to sample quantization.
  const firstPeriod = interpolatedMinimum(difference, candidate);
  let bestAperiodicity = minimumValue(normalized, candidate);
  for (let multiple = 2; multiple <= 4; multiple++) {
    const expected = firstPeriod * multiple;
    if (expected > maxLag + 0.5) break;
    const radius = Math.max(2, Math.round(expected * 0.025));
    const start = Math.max(minLag, Math.floor(expected - radius));
    const end = Math.min(maxLag, Math.ceil(expected + radius));
    let longer = start;
    for (let lag = start + 1; lag <= end; lag++) {
      if (normalized[lag] < normalized[longer]) longer = lag;
    }
    const aperiodicity = minimumValue(normalized, longer);
    if (aperiodicity < bestAperiodicity * 0.45 && bestAperiodicity - aperiodicity > 0.012) {
      candidate = longer;
      bestAperiodicity = aperiodicity;
    }
  }

  const period = interpolatedMinimum(difference, candidate);
  const frequency = rate / period;
  if (!Number.isFinite(frequency) || frequency < minFrequency || frequency > maxFrequency) return null;
  return { frequency, confidence: Math.max(0, Math.min(1, 1 - bestAperiodicity)), rms };
}
