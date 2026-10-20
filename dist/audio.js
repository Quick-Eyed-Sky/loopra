// LOOPRA · thirty-two independent tape phrases and a local audio transport.
// Event times are anchored to each tape's own period: no common chord clock,
// no accumulated interval drift, and no hundreds-of-seconds audio buffers.

import { hashSeed, mulberry32, unit } from './rng.js';
import { LANE_DEPTH, SpaceRack, planeFor } from './space.js';
import { HAMMER, TIMBRES } from './timbre.js';

const KEYS = { C: 36, 'C#': 37, D: 38, 'D#': 39, E: 40, F: 41, 'F#': 42, G: 31, 'G#': 32, A: 33, 'A#': 34, B: 35 };

const MODES = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  // Map seven diatonic degrees onto a minor pentatonic collection. Repeated
  // degrees deliberately replace absent seconds/sixths with consonant tones.
  pentatonic: [0, 0, 3, 5, 7, 7, 10],
};

const TAPES = [
  { id: 'pad', name: 'Harmonic pad', description: 'Wide, overlapping chords; the continuous warm foundation.', reference: 50, range: [47, 97], phaseRatio: 0.14, minimum: 35 },
  { id: 'bass', name: 'Bowed bass', description: 'A rounded low note that slowly bows into the next.', reference: 80, range: [73, 137], phaseRatio: 0.2125, minimum: 35 },
  { id: 'glass', name: 'Glass & piano', description: 'Widely spaced notes with a long, clear decay.', reference: 174, range: [131, 221], phaseRatio: 20 / 174, minimum: 35 },
  { id: 'shimmer', name: 'Insect', description: 'A gentle one-second ripple, arriving only rarely.', reference: 190, range: [131, 211], early: 3, minimum: 35 },
  { id: 'felt', name: 'Felt piano', description: 'One muted piano-like note on its own short cycle.', reference: 23, range: [17, 41], phaseRatio: 0.71, minimum: 12 },
  { id: 'silk', name: 'Silk & light', description: 'A fine sustained veil of high, soft harmonics.', reference: 29, range: [19, 43], phaseRatio: 0.3, minimum: 12 },
  { id: 'calls', name: 'Distant calls', description: 'Short modal glides that rise or fall in the distance.', reference: 127, range: [83, 181], early: 13, minimum: 35 },
  { id: 'breath', name: 'Low wail', description: 'A rare low arrival with a slow four-and-a-half-second attack.', reference: 159, range: [127, 191], early: 20, minimum: 35 },
  { id: 'bell', name: 'Dawn bell', description: 'Two quiet, rounded chimes separated by open space.', reference: 53, range: [31, 79], early: 8, minimum: 20, trim: 0.65 },
  { id: 'friselis', name: 'Fine ripples', description: 'Small, soft waves within a delicate upper tone.', reference: 89, range: [43, 113], early: 14, minimum: 20, trim: 0.58 },
  { id: 'parabola', name: 'Parabola', description: 'A smooth arc rises to the fifth and returns to its root.', reference: 139, range: [79, 173], early: 11, minimum: 35, trim: 0.65 },
  { id: 'air', name: 'High air', description: 'Filtered breath suspended around a quiet tonal center.', reference: 197, range: [107, 251], early: 25, minimum: 35, trim: 0.65 },
  { id: 'warmglass', name: 'Amber glass', description: 'A low glass chord with soft, slowly fading overtones.', reference: 109, range: [67, 149], early: 18, minimum: 35, trim: 0.65 },
  { id: 'whistle', name: 'Distant whistle', description: 'A faint, breathlike high note with a little pitch drift.', reference: 229, range: [139, 293], early: 31, minimum: 35, trim: 0.5 },
  { id: 'velvet', name: 'Velvet pluck', description: 'A small, padded two-note pluck that leaves a long echo.', reference: 43, range: [23, 61], early: 6, minimum: 20, trim: 0.65 },
  { id: 'reverse', name: 'Reverse tide', description: 'A chord emerges slowly, then gently folds away.', reference: 181, range: [97, 277], early: 37, minimum: 35, trim: 0.65 },
  { id: 'blink', name: 'Gentle beacon', description: 'A warm tone blinks softly a few times, then disappears.', reference: 67, range: [41, 97], early: 5, minimum: 20, trim: 0.52 },
  { id: 'tinkle', name: 'Silver droplets', description: 'Two small bell droplets, softened at the edges.', reference: 83, range: [53, 127], early: 17, minimum: 20, trim: 0.5 },
  { id: 'arpeggio', name: 'Modal steps', description: 'Three unhurried notes quietly outline the selected mode.', reference: 131, range: [79, 181], early: 23, minimum: 20, trim: 0.5 },
  { id: 'celesta', name: 'Muted celesta', description: 'A soft wooden sparkle in the middle register.', reference: 97, range: [61, 157], early: 12, minimum: 20, trim: 0.55 },
  { id: 'pendulum', name: 'Harmonic pendulum', description: 'A long, slow pitch arc swings between root and fifth.', reference: 211, range: [127, 277], early: 41, minimum: 35, trim: 0.55 },
  { id: 'pulse', name: 'Warm pulse', description: 'A low, rounded tone breathes in a loose pulse.', reference: 73, range: [37, 109], early: 9, minimum: 20, trim: 0.5 },
  { id: 'paper', name: 'Paper air', description: 'A brief, dry whisper of filtered air and low tone.', reference: 181, range: [113, 251], early: 29, minimum: 35, trim: 0.5 },
  { id: 'gamelan', name: 'Distant bronze', description: 'A very quiet bronze-like chord with rounded partials.', reference: 223, range: [131, 293], early: 47, minimum: 35, trim: 0.52 },
  { id: 'harmonica', name: 'Glass harmonica', description: 'Two glassy notes hover and gently beat against their echoes.', reference: 167, range: [97, 239], early: 33, minimum: 35, trim: 0.52 },
  { id: 'halo', name: 'Harmonic halo', description: 'A long, pale chord whose extensions follow harmonic richness.', reference: 251, range: [149, 299], early: 53, minimum: 35, trim: 0.5 },
  { id: 'rain', name: 'Soft rain', description: 'Three tiny, widely spaced drops in the upper register.', reference: 149, range: [83, 211], early: 19, minimum: 20, trim: 0.48 },
  { id: 'reed', name: 'Quiet reed', description: 'A warm, breathlike reed note with a slow beginning.', reference: 191, range: [107, 263], early: 37, minimum: 35, trim: 0.52 },
  { id: 'flicker', name: 'Firefly', description: 'A small, slow flicker of light in a single high note.', reference: 89, range: [43, 131], early: 15, minimum: 20, trim: 0.5 },
  { id: 'bowedchime', name: 'Bowed chime', description: 'A bell overtone gradually appears as if bowed.', reference: 239, range: [157, 299], early: 61, minimum: 35, trim: 0.55 },
  { id: 'bassbell', name: 'Low lantern', description: 'A deep, cushioned bell bloom with a gentle long tail.', reference: 211, range: [137, 283], early: 43, minimum: 35, trim: 0.5 },
  { id: 'afterglow', name: 'Afterglow', description: 'A final slow chord rises and recedes like a warm afterimage.', reference: 257, range: [173, 299], early: 67, minimum: 35, trim: 0.5 },
];

// In Stage a few layers start quieter than in 0.1.1. Silk & light is a sustained veil: each of its
// chords lasts longer than its loop, so it is almost always sounding, and its notes sit around 1 kHz,
// where the other layers have little energy. At full level it pierces through everything else.
const STAGE_TRIM = { silk: 0.12 };

export const LOOP_COUNT = TAPES.length;
const gcd = (a, b) => b ? gcd(b, a % b) : a;
function tapePeriods() {
  const chosen = [];
  for (const tape of TAPES) {
    const possible = Array.from({ length: tape.range[1] - tape.range[0] + 1 }, (_, index) => tape.range[0] + index);
    let candidates = possible.filter((period) => chosen.every((other) => gcd(period, other) === 1));
    // Thirty-two periods may exhaust a short range's coprime choices. Fall back
    // to distinct, nonmultiple periods instead of retrying without a bound.
    if (!candidates.length) candidates = possible.filter((period) => chosen.every((other) => period % other && other % period));
    if (!candidates.length) candidates = possible.filter((period) => !chosen.includes(period));
    const duration = candidates[Math.floor(Math.random() * candidates.length)];
    chosen.push(duration);
  }
  return chosen;
}

// All note targets are scale degrees of one tonic. Voicings put thirds and
// extensions in separate registers; complexity crossfades their live gains.
function makeMotifs(root, tapes, selectedMode = 'aeolian') {
  const scale = MODES[selectedMode];
  const tone = (degree, octave = 0) => root + octave * 12 + scale[degree];
  const event = (at, duration, notes, amplitude, kind, extra = {}) => ({ at, duration, notes, amplitude, kind, ...extra });
  const ranks = [0, 0, 0, 1, 2, 3, 4];
  const pad = (variant = false) => [tone(0, 1), tone(4, variant ? 2 : 1), tone(2, 2), tone(6, variant ? 1 : 2), tone(1, 3), tone(3, 3), tone(5, 3)];
  const motifs = [
    [
      event(0, 42, pad(), 0.083, 'pad', { ranks }),
      event(25, 42, pad(true), 0.076, 'pad', { ranks }),
    ],
    [
      event(0, 60, [tone(0)], 0.125, 'bass'),
      event(37, 44, [tone(4)], 0.105, 'bass'),
      event(65, 45, [tone(0)], 0.118, 'bass'),
    ],
    [
      event(0, 7.8, [tone(2, 3)], 0.027, 'glass'),
      event(7.4, 7.2, [tone(4, 3)], 0.021, 'glass'),
      event(24, 9.6, [tone(1, 3)], 0.025, 'glass'),
      event(52, 8.2, [tone(6, 3)], 0.018, 'glass'),
      event(67, 10.5, [tone(0, 3)], 0.027, 'glass'),
      event(100, 9.4, [tone(5, 3)], 0.019, 'glass'),
      event(126, 7.6, [tone(4, 3)], 0.025, 'glass'),
      event(132.5, 8.6, [tone(2, 3)], 0.019, 'glass'),
      event(157, 10.2, [tone(1, 3)], 0.022, 'glass'),
    ],
    // Short, rounded AM gesture: louder than the previous glass shimmer so
    // its one-second arrival remains audible through the continuous pad.
    [event(0, 1, [tone(4, 2)], 0.042, 'shimmer')],
    [event(0, 15.5, [tone(2, 2)], 0.035, 'felt')],
    [event(0, 34.2, [tone(0, 3), tone(4, 3), tone(2, 4), tone(6, 3), tone(1, 4)], 0.016, 'silk', { ranks: [0, 0, 0, 1, 2] })],
    [
      event(0, 4.6, [tone(0, 2), tone(4, 2)], 0.028, 'call', { direction: 'up' }),
      event(73, 4.1, [tone(4, 2), tone(2, 2)], 0.024, 'call', { direction: 'down' }),
    ],
    // One rare low arrival, at 84% of the continuous bass's nominal peak;
    // a 4.5-second bowing attack makes it perceptible without a loud transient.
    [event(0, 14.5, [tone(0)], 0.105, 'wail')],
    [
      event(0, 11.5, [tone(0, 3)], 0.027, 'bell'),
      event(32, 9.5, [tone(4, 3)], 0.022, 'bell'),
    ],
    [event(0, 7.8, [tone(4, 3), tone(1, 4)], 0.026, 'friselis', { ranks: [0, 2] })],
    [event(0, 5.8, [tone(0, 2), tone(4, 2), tone(0, 2)], 0.035, 'parabola')],
    [event(0, 18, [tone(0, 2)], 0.032, 'air')],
    [event(0, 14, [tone(0, 1), tone(2, 2), tone(6, 2)], 0.035, 'warmglass', { ranks: [0, 0, 1] })],
    [event(0, 9, [tone(4, 3)], 0.022, 'whistle')],
    [event(0, 6.5, [tone(4, 1), tone(2, 2)], 0.034, 'velvet', { ranks: [0, 0] })],
    [event(0, 17.5, [tone(0, 2), tone(4, 2), tone(1, 3)], 0.036, 'reverse', { ranks: [0, 0, 2] })],
    [event(0, 2.7, [tone(4, 2)], 0.026, 'blink')],
    [event(0, 6.2, [tone(2, 3)], 0.022, 'bell'), event(21, 5.6, [tone(4, 3)], 0.018, 'bell')],
    [event(0, 7.2, [tone(0, 2)], 0.019, 'felt'), event(1.6, 7.2, [tone(2, 2)], 0.018, 'felt'), event(3.9, 7.2, [tone(4, 2)], 0.017, 'felt')],
    [event(0, 8.8, [tone(4, 2), tone(0, 3)], 0.022, 'celesta', { ranks: [0, 0] })],
    [event(0, 18, [tone(0, 2), tone(4, 2), tone(0, 2)], 0.022, 'pendulum')],
    [event(0, 6.8, [tone(0, 1)], 0.04, 'pulse')],
    [event(0, 12, [tone(0, 2)], 0.027, 'paper')],
    [event(0, 12, [tone(0, 2), tone(4, 2), tone(6, 3)], 0.018, 'gamelan', { ranks: [0, 0, 1] })],
    [event(0, 11, [tone(0, 3), tone(2, 3), tone(6, 3)], 0.021, 'harmonica', { ranks: [0, 0, 1] })],
    [event(0, 22, [tone(0, 2), tone(4, 3), tone(6, 3), tone(1, 4)], 0.015, 'halo', { ranks: [0, 0, 1, 2] })],
    [event(0, 4.8, [tone(1, 3)], 0.013, 'bell'), event(2.8, 5.4, [tone(4, 3)], 0.012, 'bell'), event(6.3, 5.8, [tone(2, 3)], 0.011, 'bell')],
    [event(0, 13, [tone(4, 1)], 0.024, 'reed')],
    [event(0, 3.4, [tone(2, 3)], 0.022, 'flicker')],
    [event(0, 19, [tone(0, 3)], 0.026, 'bowedchime')],
    [event(0, 11, [tone(0, 1)], 0.036, 'bassbell')],
    [event(0, 20, [tone(0, 2), tone(2, 3), tone(4, 3), tone(6, 3)], 0.019, 'reverse', { ranks: [0, 0, 0, 1] })],
  ];
  return motifs.map((events, lane) => {
    const stretch = tapes[lane].duration / TAPES[lane].reference;
    return events.map((item) => ({
      ...item,
      at: item.at * stretch,
      duration: lane < 2 || lane === 5 ? item.duration * stretch : item.duration,
    }));
  });
}

const modulo = (value, period) => ((value % period) + period) % period;
const seeded = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, Number(value) || 0));
const frequency = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
const random = (min, max) => min + Math.random() * (max - min);
const AUDIO_EXTENSION = /\.(mp3|wav|wave|ogg|oga|opus|m4a|aac|flac|aif|aiff|webm|weba|mp4)$/i;
const MOTION = {
  shimmer: { rate: 7.6, depth: 0.22, center: 0.76, cents: 3.2 },
  friselis: { rate: 3.1, depth: 0.12, center: 0.84, cents: 1.4 },
  blink: { rate: 1.6, depth: 0.18, center: 0.82, cents: 0.8 },
  pulse: { rate: 0.85, depth: 0.12, center: 0.88, cents: 0.8 },
  flicker: { rate: 1.35, depth: 0.16, center: 0.84, cents: 1.2 },
};

export class LoopraAudio extends EventTarget {
  // options.features switches the Stage additions on one by one (all off = Loopra 0.1.1).
  constructor(options = {}) {
    super();
    this._seed = (Number.isInteger(options.seed) ? options.seed : 1) >>> 0;
    this._features = { stage: false, timbre: false, variation: false, ...(options.features || {}) };
    this._stage = { amount: 1, walk: 0.4, size: 0.5, variation: 0.5, listening: 'headphones', ...(options.stage || {}) };
    this._rack = null;
    this._rackNext = 0;
    this._whiteNoise = null;
    this.playing = false;
    this.sourceName = 'Loopra composition';
    this.isFile = false;
    this._ctx = null;
    this._key = 'D';
    this._intensity = 0.5;
    this._musicalMode = 'aeolian';
    this._harmonyComplexity = 0.5;
    this._callEnabled = true;
    this._callCounter = 0;
    this._volume = 0.32;
    this._voices = new Set();
    this._fileBuffer = null;
    this._fileSource = null;
    this._fileOffset = 0;
    this._fileStartedAt = 0;
    this._transportVersion = 0;
    this._loadVersion = 0;
    this._scheduler = null;
    this._compositionPosition = 0;
    this._compositionAnchor = null;
    const periods = tapePeriods();
    this._tapes = TAPES.map((tape, index) => ({
      ...tape,
      trim: this._features.stage && STAGE_TRIM[tape.id] !== undefined ? STAGE_TRIM[tape.id] : (tape.trim ?? 1),
      duration: periods[index],
      phase: tape.early ? periods[index] - tape.early : periods[index] * tape.phaseRatio,
      // In Stage the harmonic pad, the foundation, starts at 50 % so that it does not mask the others.
      level: index === 0 && this._features.stage ? 0.5 : index < 16 ? 1 : 0, scheduled: new Map(), gain: null,
    }));
    this._motifs = makeMotifs(KEYS[this._key], this._tapes, this._musicalMode);
    this._levels = { bass: 0, mid: 0, high: 0, energy: 0 };
    this._lastLevelAt = 0;
    this._destroyed = false;
    this._suspendPromise = null;
    this._suspending = false;
    this._soloLoopIndex = null;
    this._soloVersion = 0;
    this._soloAuditionUntil = 0;
  }

  _emit(reason, error = null) {
    this.dispatchEvent(new CustomEvent('statechange', {
      detail: { playing: this.playing, sourceName: this.sourceName, isFile: this.isFile, currentKey: this.currentKey, soloLoopIndex: this._soloLoopIndex, reason, error },
    }));
  }

  _ensureContext() {
    if (this._destroyed) throw new Error('The audio engine is closed. Reload Loopra.');
    if (this._ctx) return this._ctx;
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextClass) throw new Error('This browser does not support Web Audio.');
    const ctx = this._ctx = new AudioContextClass({ latencyHint: 'playback' });

    this._mix = ctx.createGain();
    this._compositionMix = ctx.createGain();
    this._compositionMix.gain.value = this._tapes.some((_, index) => this._effectiveLevel(index) > 0) ? 1 : 0;
    this._compositionMix.connect(this._mix);
    this._compressor = ctx.createDynamicsCompressor();
    this._compressor.threshold.value = -18;
    this._compressor.knee.value = 22;
    this._compressor.ratio.value = 3.5;
    this._compressor.attack.value = 0.018;
    this._compressor.release.value = 0.4;
    this._transportGain = ctx.createGain();
    this._transportGain.gain.value = 0;
    this._master = ctx.createGain();
    this._master.gain.value = this._volume;
    this._analyser = ctx.createAnalyser();
    this._analyser.fftSize = 2048;
    this._analyser.smoothingTimeConstant = 0.78;
    this._analyser.minDecibels = -92;
    this._analyser.maxDecibels = -22;
    this._frequencyData = new Uint8Array(this._analyser.frequencyBinCount);
    this._waveData = new Float32Array(this._analyser.fftSize);
    this._recordingDestination = ctx.createMediaStreamDestination();
    this._mix.connect(this._compressor);
    this._compressor.connect(this._transportGain);
    this._transportGain.connect(this._master);
    this._master.connect(this._analyser);
    this._analyser.connect(ctx.destination);
    this._analyser.connect(this._recordingDestination);

    this._synthBus = ctx.createGain();
    this._synthBus.gain.value = 0.78 + this._intensity * 0.28;
    for (const [index, tape] of this._tapes.entries()) {
      tape.gain = ctx.createGain();
      tape.gain.gain.value = this._effectiveLevel(index) * tape.trim;
      if (!this._features.stage) tape.gain.connect(this._synthBus);
    }
    this._tone = ctx.createBiquadFilter();
    this._tone.type = 'lowpass';
    this._tone.Q.value = 0.35;
    this._synthBus.connect(this._tone);
    const dry = ctx.createGain();
    dry.gain.value = this._features.stage ? 1 : 0.76;
    this._tone.connect(dry);
    dry.connect(this._compositionMix);

    this._effectsSend = ctx.createGain();
    if (!this._features.stage) this._tone.connect(this._effectsSend);
    this._wetReturnGate = ctx.createGain();
    this._wetReturnGate.gain.value = this._soloLoopIndex === null ? 1 : 0;
    this._wetReturnGate.connect(this._compositionMix);
    this._impulseBuffer = this._makeImpulse(5.6);
    this._buildEffects();
    if (this._features.stage) this._buildStage();

    this._fileGain = ctx.createGain();
    this._fileGain.gain.value = 1;
    this._fileGain.connect(this._mix);
    this._createAir();
    this._configureSound();

    this._onContextStateChange = () => {
      if (ctx.state === 'closed' || (ctx.state !== 'running' && this.playing && !this._suspending)) {
        ++this._soloVersion;
        this._freezeComposition();
        this._pauseFile();
        this.playing = false;
        this._clearScheduler();
        this._emit('interruption');
      }
    };
    ctx.addEventListener('statechange', this._onContextStateChange);
    return ctx;
  }

  _buildStage() {
    this._rack = new SpaceRack(this._ctx, {
      dryOutput: this._synthBus, wetOutput: this._wetReturnGate, seed: this._seed,
      baseDepths: LANE_DEPTH, laneCount: this._tapes.length, settings: this._stage, trim: 1.13,
    });
    this._tapes.forEach((tape, index) => {
      tape.gain.disconnect();
      tape.gain.connect(this._rack.lanes[index].input);
    });
    // The single dark filter of 0.1.1 is opened: each layer now has its own distance.
    this._tone.frequency.value = 20000;
    this._rack.update({ elapsed: this._compositionElapsed(), soloIndex: this._soloLoopIndex, immediate: true });
  }

  _noiseBuffer() {
    if (!this._whiteNoise) {
      const ctx = this._ctx;
      const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
      const random = mulberry32(hashSeed(this._seed, 'noise'));
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = random() * 2 - 1;
      this._whiteNoise = buffer;
    }
    return this._whiteNoise;
  }

  _partials(kind, hz) {
    const table = this._features.timbre ? TIMBRES[kind] : null;
    if (!table) return [{ hz }, { hz: hz * 2.002 }, { hz: hz * 3 }];
    return table.ratios.map((ratio, i) => ({ hz: hz * ratio, level: table.gains[i], life: table.life[i] }));
  }

  // Each pass of a loop is a new take: the whole phrase leans a little earlier or
  // later, and each note nudges a little on its own. Same seed, same takes.
  _eventShift(lane, cycle, index, tape) {
    if (!this._features.variation || this._stage.variation <= 0) return 0;
    const wander = Math.min(3, tape.duration * 0.04) * this._stage.variation;
    const phrase = (unit(this._seed, 'shift', lane, cycle) * 2 - 1) * wander;
    const note = (unit(this._seed, 'nudge', lane, cycle, index) * 2 - 1) * Math.min(0.18, wander * 0.08);
    return phrase + note;
  }

  // Where a layer sits now; before the first sound, at home, squeezed by the staging amount.
  _depthOf(index, elapsed) {
    if (this._rack) return this._rack.depthAt(index, elapsed);
    return Math.min(1, Math.max(0, 0.5 + (LANE_DEPTH[index] - 0.5) * this._stage.amount));
  }

  _buildEffects() {
    const ctx = this._ctx;
    // Reuse the impulse samples, but discard all delay/convolution history.
    // A dry solo can never expose tails from a previously selected instrument.
    this._effectsSend.disconnect();
    for (const node of this._effectsNodes || []) { try { node.disconnect(); } catch {} }
    this._reverb = ctx.createConvolver();
    this._reverb.buffer = this._impulseBuffer;
    this._reverbWet = ctx.createGain();
    this._reverbWet.gain.value = 0.32;
    this._effectsSend.connect(this._reverb);
    this._reverb.connect(this._reverbWet);
    this._reverbWet.connect(this._wetReturnGate);

    this._delay = ctx.createDelay(2);
    this._delay.delayTime.value = 0.73;
    this._delayFeedback = ctx.createGain();
    this._delayFeedback.gain.value = 0.28;
    const delayFilter = ctx.createBiquadFilter();
    delayFilter.type = 'lowpass';
    delayFilter.frequency.value = 1700;
    this._delayWet = ctx.createGain();
    this._delayWet.gain.value = 0.12;
    this._effectsSend.connect(this._delay);
    this._delay.connect(delayFilter);
    delayFilter.connect(this._delayFeedback);
    this._delayFeedback.connect(this._delay);
    delayFilter.connect(this._delayWet);
    this._delayWet.connect(this._wetReturnGate);
    this._effectsNodes = [this._reverb, this._reverbWet, this._delay, this._delayFeedback, delayFilter, this._delayWet];
  }

  _makeImpulse(seconds) {
    const ctx = this._ctx;
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      let smooth = 0;
      for (let i = 0; i < length; i++) {
        smooth = smooth * 0.56 + (Math.random() * 2 - 1) * 0.44;
        const time = i / length;
        data[i] = smooth * Math.pow(1 - time, 2.8) * Math.min(1, i / (ctx.sampleRate * 0.018));
      }
    }
    return buffer;
  }

  _createAir() {
    const ctx = this._ctx;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 7, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < data.length; i++) {
      brown = (brown + random(-0.026, 0.026)) / 1.022;
      data[i] = brown * 2.9;
    }
    this._air = ctx.createBufferSource();
    this._air.buffer = buffer;
    this._air.loop = true;
    this._airFilter = ctx.createBiquadFilter();
    this._airFilter.type = 'bandpass';
    this._airFilter.Q.value = 0.45;
    this._airGain = ctx.createGain();
    this._airGain.gain.value = 0.005;
    this._air.connect(this._airFilter);
    this._airFilter.connect(this._airGain);
    this._airGain.connect(this._tapes[0].gain);
    this._air.start();
  }

  _configureSound() {
    if (!this._ctx) return;
    const now = this._ctx.currentTime;
    this._compositionMix.gain.setTargetAtTime(this._tapes.some((_, index) => this._effectiveLevel(index) > 0) ? 1 : 0, now, 0.06);
    this._tone.frequency.setTargetAtTime(this._features.stage ? 20000 : 2100 * (0.72 + this._intensity * 0.6), now, 1.8);
    this._delay.delayTime.setTargetAtTime(0.73, now, 0.9);
    this._airFilter.frequency.setTargetAtTime(1050, now, 3);
    if (this.isFile || this._soloLoopIndex !== null) this._ramp(this._airGain.gain, 0, 0.035);
    else this._airGain.gain.setTargetAtTime(0.003 + this._intensity * 0.004, now, 1.2);
    this._synthBus.gain.setTargetAtTime(this.isFile ? 0 : 0.78 + this._intensity * 0.28, now, 0.75);
  }

  _holdAndFade(param, when, duration) {
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(when);
    else {
      const current = param.value;
      param.cancelScheduledValues(when);
      param.setValueAtTime(current, when);
    }
    param.linearRampToValueAtTime(0, when + duration);
  }

  _ramp(param, value, duration = 0.045) {
    const now = this._ctx.currentTime;
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now);
    else {
      const current = param.value;
      param.cancelScheduledValues(now);
      param.setValueAtTime(current, now);
    }
    param.linearRampToValueAtTime(value, now + duration);
  }

  _effectiveLevel(index) {
    const tape = this._tapes[index];
    if (!tape) return 0;
    if (this._soloLoopIndex === null) return tape.level;
    return index === this._soloLoopIndex ? (tape.level > 0 ? tape.level : 1) : 0;
  }

  _compositionElapsed() {
    if (this._compositionAnchor === null || !this._ctx) return this._compositionPosition;
    return this._compositionPosition + Math.max(0, this._ctx.currentTime - this._compositionAnchor);
  }

  _freezeComposition() {
    this._compositionPosition = this._compositionElapsed();
    this._compositionAnchor = null;
  }

  _clearTapeSchedule() {
    for (const tape of this._tapes) tape.scheduled.clear();
    this._soloAuditionUntil = 0;
  }

  _envelopePoints(kind, duration, amplitude) {
    if (kind === 'shimmer') return [
      { time: 0, value: 0 }, { time: 0.12, value: amplitude },
      { time: 0.62, value: amplitude * 0.82 }, { time: duration, value: 0 },
    ];
    if (kind === 'wail') return [
      { time: 0, value: 0 }, { time: 4.5, value: amplitude },
      { time: 8.5, value: amplitude * 0.9 }, { time: duration, value: 0 },
    ];
    if (kind === 'reverse') return [
      { time: 0, value: 0 }, { time: duration * 0.82, value: amplitude },
      { time: duration * 0.9, value: amplitude * 0.96 }, { time: duration, value: 0 },
    ];
    if (kind === 'parabola' || kind === 'pendulum') return [
      { time: 0, value: 0 }, { time: kind === 'pendulum' ? 2.5 : 0.45, value: amplitude },
      { time: duration * 0.75, value: amplitude * 0.75 }, { time: duration, value: 0 },
    ];
    if (['blink', 'pulse', 'flicker'].includes(kind)) return [
      { time: 0, value: 0 }, { time: kind === 'pulse' ? 0.85 : 0.4, value: amplitude },
      { time: duration * 0.64, value: amplitude * 0.8 }, { time: duration, value: 0 },
    ];
    if (kind === 'bowedchime') return [
      { time: 0, value: 0 }, { time: 5.5, value: amplitude },
      { time: 11, value: amplitude * 0.8 }, { time: duration, value: 0 },
    ];
    if (kind === 'air' || kind === 'friselis' || kind === 'paper') return [
      { time: 0, value: 0 }, { time: kind === 'air' ? 3.8 : kind === 'paper' ? 2.5 : 1.2, value: amplitude },
      { time: duration * 0.64, value: amplitude * 0.72 }, { time: duration, value: 0 },
    ];
    const attack = kind === 'pad' ? 7 : kind === 'bass' ? 5.8
      : kind === 'silk' ? Math.min(7, duration * 0.25) : kind === 'breath' ? 3
      : kind === 'halo' ? 6 : kind === 'harmonica' ? 2.4 : kind === 'reed' ? 2.3
      : kind === 'celesta' ? 0.045 : kind === 'gamelan' ? 0.075 : kind === 'bassbell' ? 0.18
      : kind === 'call' || kind === 'parabola' ? 0.35 : kind === 'whistle' ? 1.2
      : kind === 'velvet' ? 0.025 : kind === 'bell' ? 0.055 : kind === 'warmglass' ? 0.18
      : kind === 'shimmer' ? 0.7 : kind === 'felt' ? 0.035 : 0.065;
    const struck = ['glass', 'felt', 'bell', 'velvet', 'warmglass', 'celesta', 'gamelan', 'bassbell'].includes(kind);
    const hold = kind === 'bell' || kind === 'velvet' ? 0.38 : kind === 'warmglass' ? 2.2
      : kind === 'celesta' ? 0.52 : kind === 'gamelan' || kind === 'bassbell' ? 1.1
      : kind === 'glass' || kind === 'felt' ? 0.85
      : kind === 'shimmer' ? 1.35 : kind === 'call' ? 1.45 : duration * 0.6;
    return [
      { time: 0, value: 0 },
      { time: attack, value: amplitude },
      { time: hold, value: amplitude * (struck ? 0.32 : 0.78) },
      { time: duration, value: 0.00001, exponential: true },
      { time: duration + 0.03, value: 0 },
    ];
  }

  _envelopeValue(points, position) {
    for (let i = 1; i < points.length; i++) {
      const end = points[i];
      const start = points[i - 1];
      if (position <= end.time) {
        const fraction = clamp((position - start.time) / (end.time - start.time));
        return end.exponential && start.value > 0
          ? start.value * Math.pow(end.value / start.value, fraction)
          : start.value + (end.value - start.value) * fraction;
      }
    }
    return 0;
  }

  _disposeVoice(voice) {
    if (voice.disposed) return;
    voice.disposed = true;
    for (const node of voice.nodes) { try { node.disconnect(); } catch {} }
    this._voices.delete(voice);
  }

  _harmonyWeight(rank) {
    const amount = this._harmonyComplexity;
    if (!rank) return 1;
    if (rank === 1) return clamp(amount / 0.5);
    if (rank === 2) return clamp((amount - 0.18) / 0.45);
    if (rank === 3) return clamp((amount - 0.48) / 0.4);
    return clamp((amount - 0.68) / 0.32);
  }

  _voice(notes, at, duration, amplitude, kind, lane, seed, seek = 0, harmonyRank = 0) {
    if (seek >= duration || this._effectiveLevel(lane) <= 0) return;
    const ctx = this._ctx;
    const variation = seeded(seed);
    const envelope = ctx.createGain();
    const harmonyGain = ctx.createGain();
    harmonyGain.gain.value = this._harmonyWeight(harmonyRank);
    const motion = MOTION[kind];
    const insectGain = motion ? ctx.createGain() : null;
    if (insectGain) {
      insectGain.gain.value = motion.center;
      envelope.connect(insectGain);
      insectGain.connect(harmonyGain);
    } else envelope.connect(harmonyGain);
    let panner;
    const placementNodes = [];
    if (this._rack) {
      panner = this._rack.placeVoice(harmonyGain, this._tapes[lane].gain, lane, variation() * 2 - 1,
        kind === 'bass' ? 0.1 / 0.6 : 1, this._compositionElapsed(), placementNodes);
    } else {
      panner = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
      if (panner.pan) panner.pan.value = (variation() * 2 - 1) * (kind === 'bass' ? 0.1 : 0.6);
      harmonyGain.connect(panner);
      panner.connect(this._tapes[lane].gain);
    }
    const points = this._envelopePoints(kind, duration, amplitude);
    envelope.gain.setValueAtTime(0, at);
    // At the initial tape phase, or after an imported track, enter an already
    // sounding note with a short fade instead of replaying its attack.
    const fade = seek > 0 ? Math.min(0.55, (duration - seek) * 0.4) : 0;
    if (fade) envelope.gain.linearRampToValueAtTime(this._envelopeValue(points, seek + fade), at + fade);
    for (const point of points) {
      if (point.time <= seek + fade) continue;
      const when = at + point.time - seek;
      if (point.exponential) envelope.gain.exponentialRampToValueAtTime(point.value, when);
      else envelope.gain.linearRampToValueAtTime(point.value, when);
    }

    const endAt = at + duration - seek + (kind === 'shimmer' || kind === 'wail' ? 0 : 0.05);
    const nodes = [envelope, harmonyGain, panner, ...placementNodes];
    if (insectGain) nodes.push(insectGain);
    const oscillators = [];
    for (let index = 0; index < notes.length; index++) {
      const note = notes[index];
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = ['pad', 'bass', 'breath', 'wail', 'reed'].includes(kind) && index === 1 ? 'triangle' : 'sine';
      oscillator.frequency.value = typeof note === 'number' ? frequency(note) : note.hz;
      if ((kind === 'parabola' || kind === 'pendulum') && typeof note === 'object' && note.apexHz) {
        const points = [
          { time: 0, value: note.hz }, { time: 0.3, value: note.hz },
          { time: duration * 0.42, value: note.apexHz },
          { time: duration * 0.83, value: note.targetHz },
        ];
        let current = note.targetHz;
        for (let part = 1; part < points.length; part++) {
          if (seek <= points[part].time) {
            const from = points[part - 1], to = points[part];
            current = from.value * Math.pow(to.value / from.value, clamp((seek - from.time) / (to.time - from.time)));
            break;
          }
        }
        oscillator.frequency.setValueAtTime(current, at);
        for (const point of points) {
          if (point.time > seek) oscillator.frequency.exponentialRampToValueAtTime(point.value, at + point.time - seek);
        }
      }
      if ((kind === 'call' || kind === 'wail') && typeof note === 'object' && note.targetHz) {
        const glideStart = kind === 'wail' ? 0.6 : 0.45;
        const glideEnd = kind === 'wail' ? 8.8 : 1.75;
        const fraction = clamp((seek - glideStart) / (glideEnd - glideStart));
        oscillator.frequency.setValueAtTime(note.hz * Math.pow(note.targetHz / note.hz, fraction), at);
        if (seek < glideStart) oscillator.frequency.setValueAtTime(note.hz, at + glideStart - seek);
        if (seek < glideEnd) oscillator.frequency.exponentialRampToValueAtTime(note.targetHz, at + glideEnd - seek);
      }
      const driftStart = (variation() * 2 - 1) * 2.1;
      const driftEnd = (variation() * 2 - 1) * 2.8;
      oscillator.detune.setValueAtTime(driftStart + (driftEnd - driftStart) * (seek / duration), at);
      oscillator.detune.linearRampToValueAtTime(driftEnd, at + duration - seek);
      gain.gain.value = kind === 'pad' ? (index === 0 ? 0.78 : 0.22)
        : ['bass', 'breath', 'wail', 'reed'].includes(kind) ? (index === 0 ? 0.9 : 0.1)
        : index === 0 ? (kind === 'paper' ? 0.35 : 1)
        : index === 1 ? (kind === 'bell' || kind === 'gamelan' ? 0.28 : ['felt', 'velvet', 'celesta'].includes(kind) ? 0.1 : 0.15)
        : kind === 'bell' || kind === 'gamelan' ? 0.07 : 0.025;
      if (typeof note === 'object' && note.level !== undefined) {
        gain.gain.value = note.level;
        if (note.life < 1) {
          const life = Math.max(0.12, (duration - seek) * note.life);
          gain.gain.setValueAtTime(note.level, at);
          gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, note.level * 0.03), at + life);
        }
      }
      oscillator.connect(gain);
      gain.connect(envelope);
      oscillator.start(at);
      oscillator.stop(endAt);
      oscillators.push(oscillator);
      nodes.push(oscillator, gain);
    }
    if (this._features.timbre && seek === 0 && HAMMER[kind]) {
      const touch = HAMMER[kind];
      const f0 = typeof notes[0] === 'number' ? frequency(notes[0]) : notes[0].hz;
      const noise = ctx.createBufferSource();
      const band = ctx.createBiquadFilter();
      const thump = ctx.createGain();
      noise.buffer = this._noiseBuffer();
      band.type = 'bandpass';
      band.frequency.value = Math.min(5200, f0 * touch.center);
      band.Q.value = touch.q;
      thump.gain.setValueAtTime(0, at);
      thump.gain.linearRampToValueAtTime(amplitude * touch.level, at + 0.004);
      thump.gain.exponentialRampToValueAtTime(0.00001, at + touch.seconds);
      noise.connect(band);
      band.connect(thump);
      thump.connect(harmonyGain);
      noise.start(at, variation() * (noise.buffer.duration - 0.5));
      noise.stop(at + touch.seconds + 0.02);
      oscillators.push(noise);
      nodes.push(noise, band, thump);
    }
    if (motion) {
      const vibrato = ctx.createOscillator();
      const depth = ctx.createGain();
      const pitchDepth = ctx.createGain();
      vibrato.frequency.value = motion.rate;
      depth.gain.value = motion.depth;
      pitchDepth.gain.value = motion.cents;
      vibrato.connect(depth);
      depth.connect(insectGain.gain);
      vibrato.connect(pitchDepth);
      for (const oscillator of oscillators) pitchDepth.connect(oscillator.detune);
      vibrato.start(at);
      vibrato.stop(endAt);
      oscillators.push(vibrato);
      nodes.push(vibrato, depth, pitchDepth);
    }
    if (kind === 'wail' || kind === 'whistle' || kind === 'reed') {
      const wander = ctx.createOscillator();
      const depth = ctx.createGain();
      wander.frequency.value = kind === 'wail' ? 0.17 : 0.37;
      depth.gain.value = kind === 'wail' ? 3 : 2;
      wander.connect(depth);
      for (const oscillator of oscillators) depth.connect(oscillator.detune);
      wander.start(at);
      wander.stop(endAt);
      oscillators.push(wander);
      nodes.push(wander, depth);
    }
    if (kind === 'air' || kind === 'paper') {
      const air = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      const breathGain = ctx.createGain();
      air.buffer = this._air.buffer;
      air.loop = true;
      filter.type = 'bandpass';
      filter.frequency.value = (typeof notes[0] === 'number' ? frequency(notes[0]) : notes[0].hz) * 3;
      filter.Q.value = 0.6;
      breathGain.gain.value = kind === 'paper' ? 2.4 : 1.1;
      air.connect(filter);
      filter.connect(breathGain);
      breathGain.connect(envelope);
      air.start(at, ((seed % 1000) / 1000) * air.buffer.duration);
      air.stop(endAt);
      oscillators.push(air);
      nodes.push(air, filter, breathGain);
    }
    if (this._features.timbre && (kind === 'air' || kind === 'paper')) {
      // 0.1.1 had only a low rumble here. Real breath lives between 1 and 6 kHz.
      const breath = ctx.createBufferSource();
      const sheen = ctx.createBiquadFilter();
      const sheenGain = ctx.createGain();
      breath.buffer = this._noiseBuffer();
      breath.loop = true;
      sheen.type = 'bandpass';
      sheen.frequency.value = kind === 'paper' ? 3400 : 2300;
      sheen.Q.value = 0.7;
      // Breath, not hiss: a soft ceiling keeps the noise out of the very top.
      const ceiling = ctx.createBiquadFilter();
      ceiling.type = 'lowpass';
      ceiling.frequency.value = 7500;
      ceiling.Q.value = 0.5;
      sheenGain.gain.value = kind === 'paper' ? 0.9 : 0.6;
      breath.connect(sheen);
      sheen.connect(ceiling);
      ceiling.connect(sheenGain);
      sheenGain.connect(envelope);
      breath.start(at, variation() * (breath.buffer.duration - 0.5));
      breath.stop(endAt);
      oscillators.push(breath);
      nodes.push(breath, sheen, ceiling, sheenGain);
    }
    const voice = { envelope, harmonyGain, harmonyRank, lane, kind, nodes, oscillators, startAt: at, endAt, disposed: false, stopping: false };
    this._voices.add(voice);
    let ended = 0;
    for (const oscillator of oscillators) {
      oscillator.onended = () => {
        if (++ended === oscillators.length) this._disposeVoice(voice);
      };
    }
  }

  _fadeVoices(duration = 1.4, onlyLane = null, force = false) {
    if (!this._ctx) return;
    const now = this._ctx.currentTime;
    for (const voice of this._voices) {
      if (onlyLane !== null && voice.lane !== onlyLane) continue;
      // Never move an already fading voice's stop time farther into the future.
      if (voice.stopping && !force) continue;
      voice.stopping = true;
      if (voice.startAt > now) {
        for (const oscillator of voice.oscillators) { try { oscillator.stop(now); } catch {} }
        this._disposeVoice(voice);
        continue;
      }
      const release = Math.max(0.01, Math.min(duration, voice.endAt - now - 0.01));
      this._holdAndFade(voice.envelope.gain, now, release);
      voice.endAt = Math.min(voice.endAt, now + release + 0.01);
      for (const oscillator of voice.oscillators) {
        try { oscillator.stop(voice.endAt); } catch {}
      }
    }
  }

  _scheduleTapeEvent(lane, event, index, startPosition, elapsed, now, cycle = null) {
    const seek = Math.max(0, elapsed - startPosition);
    const at = now + Math.max(0.025, startPosition - elapsed);
    let seed = KEYS[this._key] * 100003 + lane * 1009 + index * 97;
    if (this._features.variation && cycle !== null && this._stage.variation > 0) {
      seed = (seed + hashSeed(this._seed, lane, cycle, index) % 1000003) >>> 0;
      const swing = (unit(this._seed, 'level', lane, cycle, index) * 2 - 1) * 1.6 * this._stage.variation;
      event = { ...event, amplitude: event.amplitude * 10 ** (swing / 20) };
    }
    if (['pad', 'silk', 'bell', 'friselis', 'warmglass', 'velvet', 'reverse', 'celesta', 'gamelan', 'harmonica', 'halo', 'bassbell'].includes(event.kind)) {
      event.notes.forEach((note, noteIndex) => {
        const stagger = event.kind === 'bell' || event.kind === 'velvet' ? 0.055 : event.kind === 'warmglass' ? 0.09 : 0.21;
        const offset = noteIndex * stagger;
        const noteSeek = Math.max(0, seek - offset);
        const noteAt = at + Math.max(0, offset - seek);
        const rank = event.ranks?.[noteIndex] || 0;
        const attenuation = [1, 0.55, 0.38, 0.24, 0.2][rank];
        const hz = frequency(note);
        const partials = ['bell', 'warmglass', 'velvet', 'celesta', 'gamelan', 'bassbell'].includes(event.kind)
          ? this._partials(event.kind, hz)
          : event.kind === 'friselis' ? [note, note + 12] : [note, note];
        this._voice(partials, noteAt, event.duration - offset,
          event.amplitude * (noteIndex === 0 ? 0.88 : 1) * attenuation,
          event.kind, lane, seed + noteIndex * 13, noteSeek, rank);
      });
    } else if (event.kind === 'bass' || event.kind === 'breath' || event.kind === 'reed') {
      this._voice([event.notes[0], event.notes[0] + 12], at, event.duration, event.amplitude, event.kind, lane, seed, seek);
    } else if (event.kind === 'wail') {
      const target = frequency(event.notes[0]);
      this._voice([
        { hz: target * 0.985, targetHz: target },
        { hz: target * 2 * 0.985, targetHz: target * 2 },
      ], at, event.duration, event.amplitude, 'wail', lane, seed, seek);
    } else if (event.kind === 'parabola' || event.kind === 'pendulum') {
      this._voice([
        { hz: frequency(event.notes[0]), apexHz: frequency(event.notes[1]), targetHz: frequency(event.notes[2]) },
        { hz: frequency(event.notes[0]) * 2, apexHz: frequency(event.notes[1]) * 2, targetHz: frequency(event.notes[2]) * 2 },
      ], at, event.duration, event.amplitude, event.kind, lane, seed, seek);
    } else if (event.kind === 'call') {
      this._voice([
        { hz: frequency(event.notes[0]), targetHz: frequency(event.notes[1]) },
        { hz: frequency(event.notes[0]) * 2.002, targetHz: frequency(event.notes[1]) * 2.002 },
      ], at, event.duration, event.amplitude, 'call', lane, seed, seek);
    } else {
      const hz = frequency(event.notes[0]);
      this._voice(this._partials(event.kind, hz), at, event.duration, event.amplitude, event.kind, lane, seed, seek);
    }
  }

  _tick() {
    if (!this.playing || this.isFile || !this._ctx || this._ctx.state !== 'running') return;
    const now = this._ctx.currentTime;
    const elapsed = this._compositionElapsed();
    const ahead = elapsed + 1.5;
    if (this._rack && now >= this._rackNext) {
      this._rackNext = now + 1;
      this._rack.update({ elapsed, soloIndex: this._soloLoopIndex });
    }
    this._tapes.forEach((tape, lane) => {
      if (this._effectiveLevel(lane) <= 0) return;
      if (lane === this._soloLoopIndex && elapsed < this._soloAuditionUntil) return;
      if (lane === 6 && !this._callEnabled) return;
      const events = this._motifs[lane];
      const longest = Math.max(...events.map((event) => event.duration));
      // A short rescan also reconstructs a sustained note after a throttled tab,
      // while the bounded map prevents any event from being scheduled twice.
      for (const [key, end] of tape.scheduled) if (end < elapsed - 1) tape.scheduled.delete(key);
      const firstCycle = Math.floor((elapsed + tape.phase - longest) / tape.duration);
      const lastCycle = Math.floor((ahead + tape.phase) / tape.duration);
      for (let cycle = firstCycle; cycle <= lastCycle; cycle++) {
        events.forEach((event, index) => {
          const start = cycle * tape.duration + event.at - tape.phase + this._eventShift(lane, cycle, index, tape);
          const end = start + event.duration;
          if (start > ahead || end <= elapsed || tape.scheduled.has(`${cycle}:${index}`)) return;
          tape.scheduled.set(`${cycle}:${index}`, end);
          this._scheduleTapeEvent(lane, event, index, start, elapsed, now, cycle);
        });
      }
    });
  }

  _clearScheduler() {
    if (this._scheduler !== null) clearInterval(this._scheduler);
    this._scheduler = null;
  }

  _startFile() {
    if (!this._fileBuffer || this._fileSource) return;
    const ctx = this._ctx;
    const source = ctx.createBufferSource();
    source.buffer = this._fileBuffer;
    source.loop = true;
    source.connect(this._fileGain);
    const offset = this._fileOffset % this._fileBuffer.duration;
    this._fileStartedAt = ctx.currentTime - offset;
    this._fileSource = source;
    source.onended = () => {
      source.disconnect();
      if (this._fileSource === source) {
        this._fileSource = null;
        this.playing = false;
        this._clearScheduler();
        this._emit('error', 'Audio playback was interrupted. Start the sound again.');
      }
    };
    this._fileGain.gain.cancelScheduledValues(ctx.currentTime);
    this._fileGain.gain.setValueAtTime(0, ctx.currentTime);
    this._fileGain.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.15);
    source.start(0, offset);
  }

  _pauseFile() {
    const source = this._fileSource;
    if (!source) return;
    if (this._fileBuffer?.duration) this._fileOffset = Math.max(0, this._ctx.currentTime - this._fileStartedAt) % this._fileBuffer.duration;
    this._fileSource = null;
    try { source.stop(); } catch {}
    try { source.disconnect(); } catch {}
  }

  async start() {
    const version = ++this._transportVersion;
    try {
      const ctx = this._ensureContext();
      if (this._suspendPromise) await this._suspendPromise;
      if (version !== this._transportVersion) return false;
      await ctx.resume();
      if (version !== this._transportVersion) return false;
      if (ctx.state !== 'running') throw new Error('Click again to enable sound.');
      if (this.playing) return true;
      this.playing = true;
      this._transportGain.gain.cancelScheduledValues(ctx.currentTime);
      this._transportGain.gain.setTargetAtTime(1, ctx.currentTime, 0.12);
      this._configureSound();
      if (this.isFile) this._startFile();
      else {
        this._compositionAnchor = ctx.currentTime;
        this._tick();
        this._clearScheduler();
        this._scheduler = setInterval(() => this._tick(), 240);
      }
      this._emit('play');
      return true;
    } catch (cause) {
      if (version !== this._transportVersion) return false;
      this._freezeComposition();
      this.playing = false;
      this._clearScheduler();
      const error = cause instanceof Error ? cause : new Error('Sound could not start.');
      this._emit('error', error.message);
      throw error;
    }
  }

  async toggle() {
    if (this.playing) {
      await this.stop();
      return false;
    }
    return this.start();
  }

  stop() {
    ++this._transportVersion;
    ++this._soloVersion;
    const wasPlaying = this.playing;
    this._freezeComposition();
    this._pauseFile();
    this.playing = false;
    this._clearScheduler();
    if (wasPlaying) this._emit('pause');
    if (this._ctx) {
      this._transportGain.gain.cancelScheduledValues(this._ctx.currentTime);
      this._transportGain.gain.setValueAtTime(0, this._ctx.currentTime);
    }
    if (!this._ctx || this._ctx.state === 'closed' || this._ctx.state === 'suspended') return Promise.resolve();
    this._suspending = true;
    const pending = this._ctx.suspend().catch(() => {}).finally(() => {
      if (this._suspendPromise === pending) this._suspendPromise = null;
      this._suspending = false;
    });
    this._suspendPromise = pending;
    return pending;
  }

  async loadFile(file) {
    const version = ++this._loadVersion;
    try {
      if (!file || typeof file.arrayBuffer !== 'function') throw new Error('Choose an audio file.');
      const mime = String(file.type || '').toLowerCase();
      if (!mime.startsWith('audio/') && !AUDIO_EXTENSION.test(file.name || '')) {
        throw new Error('Choose an audio file: MP3, WAV, M4A, OGG, or FLAC.');
      }
      if (file.size > 256 * 1024 * 1024) throw new Error('This file is too large. Choose audio smaller than 256 MB.');
      const ctx = this._ensureContext();
      const bytes = await file.arrayBuffer();
      if (version !== this._loadVersion || this._destroyed) return false;
      let buffer;
      try { buffer = await ctx.decodeAudioData(bytes); }
      catch { throw new Error('This audio could not be decoded. Try MP3, WAV, or M4A.'); }
      if (version !== this._loadVersion || this._destroyed) return false;
      if (!buffer.duration || !Number.isFinite(buffer.duration)) throw new Error('This audio file is empty.');
      this._freezeComposition();
      this._pauseFile();
      this._clearScheduler();
      this._fadeVoices(0.8);
      this._clearTapeSchedule();
      this._fileBuffer = buffer;
      this._fileOffset = 0;
      this.sourceName = String(file.name || 'Imported audio').replace(/\.[^.]+$/, '');
      this.isFile = true;
      this.setSoloLoop(null);
      this._configureSound();
      if (this.playing) this._startFile();
      this._emit('import');
      return true;
    } catch (cause) {
      if (version !== this._loadVersion) return false;
      const error = cause instanceof Error ? cause : new Error('This audio could not be decoded.');
      this._emit('error', error.message);
      throw error;
    }
  }

  // Return to Loopra's generated score, preserving play/pause and tape phases.
  useComposition() {
    ++this._loadVersion;
    if (!this.isFile) return;
    this.setSoloLoop(null);
    this._pauseFile();
    this._fileBuffer = null;
    this._fileOffset = 0;
    this.isFile = false;
    this.sourceName = 'Loopra composition';
    this._configureSound();
    this._clearTapeSchedule();
    if (this.playing) {
      this._compositionAnchor = this._ctx.currentTime;
      this._tick();
      this._clearScheduler();
      this._scheduler = setInterval(() => this._tick(), 240);
    }
    this._emit('composition');
  }

  get soloLoopIndex() {
    return this._soloLoopIndex;
  }

  setSoloLoop(index) {
    if (this._destroyed || (index !== null && (!Number.isInteger(index) || !this._tapes[index] || this.isFile))) return false;
    // Even an already-cleared solo invalidates any audition awaiting resume().
    ++this._soloVersion;
    if (index === this._soloLoopIndex) return true;
    this._soloLoopIndex = index;
    this._fadeVoices(0.055, null, true);
    this._clearTapeSchedule();
    if (this._ctx) {
      const now = this._ctx.currentTime;
      if (index === null) {
        this._wetReturnGate.gain.cancelScheduledValues(now);
        this._wetReturnGate.gain.setValueAtTime(0, now);
        this._buildEffects();
        this._rack?.resetTails();
        this._ramp(this._wetReturnGate.gain, 1, 0.24);
      } else this._ramp(this._wetReturnGate.gain, 0, 0.035);
      this._rack?.update({ elapsed: this._compositionElapsed(), soloIndex: index, fast: true });
      this._tapes.forEach((tape, lane) => this._ramp(tape.gain.gain, this._effectiveLevel(lane) * tape.trim));
      this._configureSound();
      this._tick();
    }
    this._emit('solo');
    return true;
  }

  async auditionLoop(index) {
    if (this._destroyed || this.isFile || !Number.isInteger(index) || !this._tapes[index]) return false;
    // Select synchronously, before a browser may defer AudioContext.resume().
    this.setSoloLoop(index);
    const version = this._soloVersion;
    if (!this.playing) await this.start();
    if (this._destroyed || this.isFile || !this.playing || version !== this._soloVersion || this._soloLoopIndex !== index) return false;
    this._fadeVoices(0.055, index, true);
    this._tapes[index].scheduled.clear();
    const elapsed = this._compositionElapsed();
    const now = this._ctx.currentTime;
    const events = this._motifs[index];
    const firstAt = events[0].at;
    const preview = events.map((event, eventIndex) => ({ event, eventIndex })).filter(({ event }) => event.at - firstAt <= 12);
    this._soloAuditionUntil = elapsed;
    for (const { event, eventIndex } of preview) {
      const attack = this._envelopePoints(event.kind, event.duration, event.amplitude)[1].time;
      // Enter long bowed/reversed attacks gently partway through, so a rare
      // instrument can be heard now without moving its actual tape clock.
      const seek = attack > 1.2 ? Math.min(attack * 0.65, event.duration * 0.42) : 0;
      const offset = event.at - firstAt;
      this._soloAuditionUntil = Math.max(this._soloAuditionUntil, elapsed + offset + event.duration - seek + 0.04);
      this._scheduleTapeEvent(index, event, eventIndex, elapsed + offset - seek, elapsed, now);
    }
    this._emit('audition');
    return true;
  }

  setKey(note) {
    const value = String(note || '').trim().replace('♯', '#').replace('♭', 'b');
    const aliases = { DB: 'C#', EB: 'D#', GB: 'F#', AB: 'G#', BB: 'A#' };
    const selected = aliases[value.toUpperCase()] || value.toUpperCase();
    if (!Object.hasOwn(KEYS, selected)) return false;
    if (selected === this._key) return true;
    this._key = selected;
    this._motifs = makeMotifs(KEYS[selected], this._tapes, this._musicalMode);
    this._fadeVoices(1.8);
    this._clearTapeSchedule();
    this._tick();
    this._emit('key');
    return true;
  }

  get currentKey() {
    const label = this._musicalMode === 'aeolian' ? 'minor'
      : this._musicalMode[0].toUpperCase() + this._musicalMode.slice(1);
    return `${this._key} ${label}`;
  }

  get musicalMode() {
    return this._musicalMode;
  }

  setMusicalMode(mode) {
    const requested = String(mode || 'aeolian').toLowerCase();
    const selected = requested === 'auto' ? 'aeolian' : requested;
    if (!Object.hasOwn(MODES, selected)) return false;
    if (selected === this._musicalMode) return true;
    this._musicalMode = selected;
    this._motifs = makeMotifs(KEYS[this._key], this._tapes, selected);
    this._fadeVoices(1.8);
    this._clearTapeSchedule();
    // Keep tape positions: only the sounding pitches crossfade to the new mode.
    this._tick();
    this._emit('mode');
    return true;
  }

  setHarmonyComplexity(value) {
    const next = clamp(value);
    if (next === this._harmonyComplexity) return;
    this._harmonyComplexity = next;
    if (!this._ctx) return;
    for (const voice of this._voices) {
      if (voice.harmonyRank) voice.harmonyGain.gain.setTargetAtTime(this._harmonyWeight(voice.harmonyRank), this._ctx.currentTime, 0.3);
    }
  }

  setCallEnabled(enabled) {
    const next = Boolean(enabled);
    if (next === this._callEnabled) return;
    this._callEnabled = next;
    this._tapes[6].scheduled.clear();
    if (!next) this._fadeVoices(0.6, 6);
    else this._tick();
  }

  async triggerCall(direction = 'random') {
    if (this._destroyed || this.isFile || this._effectiveLevel(6) <= 0) return false;
    if (!this.playing) await this.start();
    if (!this.playing || this.isFile) return false;
    const upward = direction === 'up' || (direction !== 'down' && Math.random() < 0.5);
    const event = this._motifs[6][upward ? 0 : 1];
    if ([...this._voices].filter((voice) => voice.lane === 6 && !voice.stopping).length >= 4) this._fadeVoices(0.4, 6);
    const elapsed = this._compositionElapsed();
    this._scheduleTapeEvent(6, { ...event, amplitude: event.amplitude * 1.15 }, 10 + (++this._callCounter % 1024), elapsed, elapsed, this._ctx.currentTime);
    return true;
  }

  getLoopState() {
    const elapsed = this._compositionElapsed();
    const liveLanes = new Set(this._ctx ? [...this._voices].filter((voice) => !voice.stopping
      && voice.startAt <= this._ctx.currentTime && voice.endAt > this._ctx.currentTime).map((voice) => voice.lane) : []);
    return this._tapes.map((tape, index) => {
      const position = modulo(elapsed + tape.phase, tape.duration);
      const inPhrase = this._motifs[index].some((event) => modulo(position - event.at, tape.duration) < event.duration);
      const manualCall = index === 6 && this._ctx && [...this._voices].some((voice) => voice.lane === 6
        && !voice.stopping && voice.startAt <= this._ctx.currentTime && voice.endAt > this._ctx.currentTime);
      const sounding = this._soloLoopIndex === null ? (inPhrase && (index !== 6 || this._callEnabled)) || manualCall
        : index === this._soloLoopIndex && liveLanes.has(index);
      return {
        id: tape.id,
        name: tape.name,
        description: tape.description,
        duration: tape.duration,
        position,
        active: this.playing && !this.isFile && this._effectiveLevel(index) > 0 && sounding,
        level: tape.level,
        effectiveLevel: this._effectiveLevel(index),
        solo: index === this._soloLoopIndex,
        depth: this._features.stage ? this._depthOf(index, elapsed) : 0.5,
        plane: this._features.stage ? planeFor(this._depthOf(index, elapsed)).label : '',
      };
    });
  }

  setLoopLevel(index, value) {
    if (!Number.isInteger(index) || !this._tapes[index]) return false;
    const tape = this._tapes[index];
    const next = clamp(value);
    if (next === tape.level) return true;
    const wasMuted = this._effectiveLevel(index) <= 0;
    tape.level = next;
    const effective = this._effectiveLevel(index);
    if (tape.gain && this._ctx) tape.gain.gain.setTargetAtTime(effective * tape.trim, this._ctx.currentTime, 0.09);
    if (effective === 0) {
      this._fadeVoices(0.07, index, true);
      tape.scheduled.clear();
    } else if (wasMuted) {
      tape.scheduled.clear();
      this._tick();
    }
    this._configureSound();
    return true;
  }

  setLoopDurations(values) {
    if (!Array.isArray(values) || (![4, 8, 16, LOOP_COUNT].includes(values.length))
      || values.some((value) => value === null || !Number.isFinite(Number(value)))) return false;
    const durations = this._tapes.map((tape, index) => index < values.length
      ? clamp(Number(values[index]), tape.minimum, 600) : tape.duration);
    if (durations.every((duration, index) => duration === this._tapes[index].duration)) return durations;
    this._fadeVoices(1.6);
    this._tapes.forEach((tape, index) => {
      tape.duration = durations[index];
      tape.phase = tape.early ? tape.duration - tape.early : tape.duration * tape.phaseRatio;
      tape.scheduled.clear();
    });
    this._motifs = makeMotifs(KEYS[this._key], this._tapes, this._musicalMode);
    this._compositionPosition = 0;
    this._compositionAnchor = this.playing && !this.isFile && this._ctx ? this._ctx.currentTime : null;
    this._tick();
    this._emit('loops');
    return this._tapes.map((tape) => tape.duration);
  }

  rerollLoops() {
    return this.setLoopDurations(tapePeriods());
  }

  setIntensity(value) {
    this._intensity = clamp(value);
    this._configureSound();
  }

  setVolume(value) {
    this._volume = clamp(value);
    if (this._ctx) this._master.gain.setTargetAtTime(this._volume, this._ctx.currentTime, 0.08);
  }

  get seed() {
    return this._seed;
  }

  get stage() {
    return { ...this._stage, timbre: this._features.timbre };
  }

  setSeed(seed) {
    const next = (Number.isInteger(seed) ? seed : this._seed) >>> 0;
    if (next === this._seed) return;
    this._seed = next;
    this._whiteNoise = null;
    if (this._rack) {
      this._rack.dispose();
      this._buildStage();
    }
  }

  setStage(changes = {}) {
    const next = { ...this._stage };
    for (const name of ['amount', 'walk', 'size', 'variation']) if (name in changes) next[name] = clamp(changes[name]);
    if ('listening' in changes) next.listening = changes.listening === 'speakers' ? 'speakers' : 'headphones';
    this._stage = next;
    if ('timbre' in changes) this._features.timbre = Boolean(changes.timbre);
    if (this._rack) {
      this._rack.configure(next);
      this._rack.update({ elapsed: this._compositionElapsed(), soloIndex: this._soloLoopIndex, fast: true });
    }
  }

  getLevels() {
    const time = globalThis.performance ? performance.now() : Date.now();
    const dt = this._lastLevelAt ? Math.min(0.15, (time - this._lastLevelAt) / 1000) : 1 / 60;
    this._lastLevelAt = time;
    const target = { bass: 0, mid: 0, high: 0, energy: 0 };
    if (this.playing && this._analyser && this._ctx.state === 'running') {
      this._analyser.getByteFrequencyData(this._frequencyData);
      this._analyser.getFloatTimeDomainData(this._waveData);
      const binHz = this._ctx.sampleRate / this._analyser.fftSize;
      const band = (low, high) => {
        const start = Math.max(1, Math.floor(low / binHz));
        const end = Math.min(this._frequencyData.length, Math.ceil(high / binHz));
        let sum = 0;
        for (let i = start; i < end; i++) sum += (this._frequencyData[i] / 255) ** 2;
        return clamp(Math.sqrt(sum / Math.max(1, end - start)) * 1.35);
      };
      target.bass = band(30, 220);
      target.mid = band(220, 2400);
      target.high = band(2400, 11000);
      let power = 0;
      for (const value of this._waveData) power += value * value;
      const rms = Math.sqrt(power / this._waveData.length);
      target.energy = clamp(Math.sqrt(rms) * 2.0);
    }
    for (const name of Object.keys(target)) {
      const smoothing = 1 - Math.exp(-dt / (target[name] > this._levels[name] ? 0.085 : 0.42));
      this._levels[name] += (target[name] - this._levels[name]) * smoothing;
      if (this._levels[name] < 0.0001) this._levels[name] = 0;
    }
    return { ...this._levels };
  }

  getOutputStream() {
    this._ensureContext();
    // The caller owns these cloned tracks and may stop them after recording.
    return this._recordingDestination.stream.clone();
  }

  destroy() {
    if (this._destroyed) return;
    ++this._transportVersion;
    ++this._loadVersion;
    ++this._soloVersion;
    this._freezeComposition();
    this.playing = false;
    this._clearScheduler();
    this._pauseFile();
    this._destroyed = true;
    if (this._ctx) {
      this._ctx.removeEventListener('statechange', this._onContextStateChange);
      for (const voice of this._voices) {
        for (const oscillator of voice.oscillators) { try { oscillator.stop(); } catch {} }
        for (const node of voice.nodes) { try { node.disconnect(); } catch {} }
      }
      this._voices.clear();
      try { this._air.stop(); } catch {}
      this._rack?.dispose();
      for (const track of this._recordingDestination.stream.getTracks()) track.stop();
      this._ctx.close().catch(() => {});
      this._fileBuffer = null;
    }
    this._emit('destroy');
  }
}
