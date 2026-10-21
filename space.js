// LOOPRA STAGE · the place.
//
// Every layer sits somewhere between "at your ears" and "beyond the walls".
// Distance is built from the cues a listener really uses:
//   - the direct sound gets quieter and darker (air absorbs the highs),
//   - the reverberation stays about as loud, so its share grows,
//   - a near sound is heard before its reflections (a longer pre-delay),
//   - a very near sound sits to one side: it reaches the nearer ear a fraction
//     of a millisecond earlier, louder and brighter (headphones only).
// Three shared reverbs (room, hall, vast) and one tape echo are fed by sends.

import { mulberry32, hashSeed, unit } from './rng.js';

const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, Number.isFinite(value) ? value : low));
const dbToGain = (db) => (db <= -58 ? 0 : 10 ** (db / 20));

export const PLANES = [
  { id: 'ear', label: 'EAR', depth: 0 },
  { id: 'near', label: 'NEAR', depth: 0.25 },
  { id: 'room', label: 'ROOM', depth: 0.5 },
  { id: 'hall', label: 'HALL', depth: 0.75 },
  { id: 'far', label: 'FAR', depth: 1 },
];
export const planeFor = (depth) => PLANES[Math.round(clamp(depth) * (PLANES.length - 1))];

// Where each of the 32 layers lives (0 = at the ears, 1 = on the horizon), in the
// order of the layers in audio.js. Breath, drops and fireflies come close; bronze,
// calls and the long chords stay far away.
export const LANE_DEPTH = [
  0.62, 0.35, 0.70, 0.10, 0.20, 0.95, 1.00, 0.70,
  0.80, 0.15, 0.55, 0.05, 0.60, 1.00, 0.20, 0.85,
  0.50, 0.30, 0.45, 0.25, 0.75, 0.40, 0.00, 0.95,
  0.65, 0.90, 0.12, 0.40, 0.10, 0.85, 0.60, 1.00,
];

// What each depth means, at the five planes (ear, near, room, hall, far).
// Values between planes are interpolated. These are starting points to tune by ear.
const DRY_DB = [0, -1.5, -4, -8, -13];
const LOWPASS_HZ = [17000, 12000, 7500, 4300, 2300];
const PRE_DELAY_S = [0.045, 0.032, 0.020, 0.008, 0];
const ROOM_DB = [-60, -22, -13, -11, -16];
const HALL_DB = [-60, -30, -17, -9, -7];
const VAST_DB = [-60, -60, -28, -15, -8];
const ECHO_DB = [-60, -34, -24, -20, -18];
const WIDTH = [0.95, 0.7, 0.5, 0.3, 0.12];

function anchor(table, depth, logarithmic = false) {
  const x = clamp(depth) * (table.length - 1);
  const i = Math.min(table.length - 2, Math.floor(x));
  const f = x - i;
  const a = table[i];
  const b = table[i + 1];
  return logarithmic ? a * (b / a) ** f : a + (b - a) * f;
}

// Shapes of the three rooms. rt60 is the time the tail takes to fall by 60 dB;
// bright is the sparkle of the tail at its start and at its end (it darkens as it
// dies, as real rooms do); early reflections come first, the dense tail follows.
const SPACES = {
  room: { seconds: 1.8, rt60: 1.0, bright: [11000, 3500], early: 18, span: 0.045, predelay: 0, build: 0.012, earlyGain: 1.0 },
  hall: { seconds: 8.0, rt60: 4.6, bright: [8000, 1600], early: 10, span: 0.09, predelay: 0.012, build: 0.05, earlyGain: 0.7 },
  vast: { seconds: 18.0, rt60: 12.5, bright: [5500, 900], early: 4, span: 0.12, predelay: 0.02, build: 0.12, earlyGain: 0.4 },
};

export function makeSpaceImpulse(ctx, spec, seed, name) {
  const rate = ctx.sampleRate;
  const length = Math.max(64, Math.floor(rate * spec.seconds));
  const buffer = ctx.createBuffer(2, length, rate);
  const decay = 6.907755 / spec.rt60;
  const start = Math.floor(spec.predelay * rate);
  const lowCut = 1 - Math.exp(-2 * Math.PI * 90 / rate);
  for (let channel = 0; channel < 2; channel++) {
    const random = mulberry32(hashSeed(seed, 'space', name, channel));
    const data = buffer.getChannelData(channel);
    let smooth = 0;
    let floor = 0;
    let coefficient = 0;
    for (let i = start; i < length; i++) {
      const t = (i - start) / rate;
      if (((i - start) & 63) === 0) {
        const cutoff = spec.bright[1] + (spec.bright[0] - spec.bright[1]) * Math.exp(-t / (spec.rt60 * 0.3));
        coefficient = 1 - Math.exp(-2 * Math.PI * cutoff / rate);
      }
      const noise = (random() + random() + random() - 1.5) * 2;
      smooth += coefficient * (noise - smooth);
      floor += lowCut * (smooth - floor);
      const body = Math.min(1, t / spec.build);
      data[i] = (smooth - floor) * Math.exp(-decay * t) * body * body;
    }
    for (let k = 0; k < spec.early; k++) {
      const tau = spec.predelay + 0.003 + random() * spec.span;
      const index = Math.floor(tau * rate);
      if (index + 2 >= length) continue;
      const amount = (random() < 0.5 ? -1 : 1) * (0.5 + 0.5 * random()) * Math.exp(-tau * 24) * spec.earlyGain * 1.4;
      data[index] += amount * 0.5;
      data[index + 1] += amount;
      data[index + 2] += amount * 0.5;
    }
    // Unit energy: a send of -13 dB returns about -13 dB of sound, whatever the room.
    let energy = 0;
    for (let i = 0; i < length; i++) energy += data[i] * data[i];
    const scale = energy > 0 ? 1 / Math.sqrt(energy) : 1;
    for (let i = 0; i < length; i++) data[i] *= scale;
  }
  return buffer;
}

export class SpaceRack {
  constructor(ctx, { dryOutput, wetOutput, seed = 1, baseDepths = LANE_DEPTH, laneCount = 32, settings = {}, trim = 1 }) {
    this.ctx = ctx;
    this.dryOutput = dryOutput;
    this.wetOutput = wetOutput;
    this.seed = seed;
    this.settings = { amount: 1, walk: 0.4, size: 0.5, listening: 'headphones', ...settings };
    this.reverbs = {
      room: this._reverb('room', 140, 9500),
      hall: this._reverb('hall', 160, 7000),
      vast: this._reverb('vast', 180, 4600),
    };
    this.echo = { input: ctx.createGain() };
    this.echo.input.channelCount = 1;
    this.echo.input.channelCountMode = 'explicit';
    this._buildEcho();
    this.lanes = Array.from({ length: laneCount }, (_, index) => this._lane(index, baseDepths[index] ?? 0.5, trim));
  }

  _reverb(name, highpass, lowpass) {
    const ctx = this.ctx;
    const input = ctx.createGain();
    input.channelCount = 1;
    input.channelCountMode = 'explicit';
    const high = ctx.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = highpass;
    high.Q.value = 0.5;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = lowpass;
    low.Q.value = 0.5;
    const out = ctx.createGain();
    out.gain.value = 1;
    high.connect(low);
    low.connect(out);
    out.connect(this.wetOutput);
    const chain = { name, input, high, low, out, buffer: makeSpaceImpulse(ctx, SPACES[name], this.seed, name), convolver: null };
    this._attach(chain);
    return chain;
  }

  _attach(chain) {
    const convolver = this.ctx.createConvolver();
    // The impulse already has unit energy; the browser's own scaling would make
    // long rooms louder than short ones.
    convolver.normalize = false;
    convolver.buffer = chain.buffer;
    chain.input.connect(convolver);
    convolver.connect(chain.high);
    chain.convolver = convolver;
  }

  _buildEcho() {
    const ctx = this.ctx;
    for (const node of this.echo.nodes || []) { try { node.disconnect(); } catch {} }
    const delay = ctx.createDelay(2);
    delay.delayTime.value = 0.73;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.3;
    const soften = ctx.createBiquadFilter();
    soften.type = 'lowpass';
    soften.frequency.value = 1700;
    const out = ctx.createGain();
    out.gain.value = 0.5;
    this.echo.input.connect(delay);
    delay.connect(soften);
    soften.connect(feedback);
    feedback.connect(delay);
    soften.connect(out);
    out.connect(this.wetOutput);
    this.echo.nodes = [delay, feedback, soften, out];
  }

  _lane(index, base, trim) {
    const ctx = this.ctx;
    const input = ctx.createGain();
    input.gain.value = trim;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.Q.value = 0.4;
    low.frequency.value = LOWPASS_HZ[0];
    const dry = ctx.createGain();
    const pre = ctx.createDelay(0.12);
    const sends = { room: ctx.createGain(), hall: ctx.createGain(), vast: ctx.createGain(), echo: ctx.createGain() };
    input.connect(low);
    low.connect(dry);
    dry.connect(this.dryOutput);
    low.connect(pre);
    for (const [name, send] of Object.entries(sends)) {
      pre.connect(send);
      send.connect(name === 'echo' ? this.echo.input : this.reverbs[name].input);
    }
    return {
      input, low, dry, pre, sends, base, depth: base,
      periodA: 210 + 420 * unit(this.seed, 'walk-a', index), phaseA: 6.2832 * unit(this.seed, 'walk-pa', index),
      periodB: 330 + 570 * unit(this.seed, 'walk-b', index), phaseB: 6.2832 * unit(this.seed, 'walk-pb', index),
    };
  }

  configure(settings) {
    this.settings = { ...this.settings, ...settings };
  }

  // Current distance of a layer (0 near, 1 far): its home, plus a slow walk,
  // squeezed toward the middle when staging is turned down.
  depthAt(index, elapsed) {
    const lane = this.lanes[index];
    if (!lane) return 0.5;
    const swing = this.settings.walk * 0.28;
    const drift = swing * (0.55 * Math.sin(6.2832 * elapsed / lane.periodA + lane.phaseA)
      + 0.45 * Math.sin(6.2832 * elapsed / lane.periodB + lane.phaseB));
    const raw = clamp(lane.base + drift);
    return clamp(0.5 + (raw - 0.5) * this.settings.amount);
  }

  placement(index, elapsed) {
    const depth = this.depthAt(index, elapsed);
    const headphones = this.settings.listening !== 'speakers';
    const closeness = headphones ? clamp(1 - depth / 0.4) : 0;
    return {
      depth,
      width: anchor(WIDTH, depth) * (headphones ? 1 : 0.8),
      closeness,
      itd: 0.00055 * closeness,
      ild: 5 * closeness,
    };
  }

  // Puts one note in the room. position is -1..1 (left to right); nodes collects
  // everything created so the note can clean up after itself.
  placeVoice(source, destination, laneIndex, position, widthScale, elapsed, nodes) {
    const ctx = this.ctx;
    const place = this.placement(laneIndex, elapsed);
    const pan = clamp(position * place.width * widthScale, -1, 1);
    if (!ctx.createStereoPanner) {
      const plain = ctx.createGain();
      source.connect(plain);
      plain.connect(destination);
      return plain;
    }
    if (place.closeness < 0.08) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      source.connect(panner);
      panner.connect(destination);
      return panner;
    }
    // Close to the ears: each ear gets its own level, arrival time and brightness.
    const side = Math.abs(pan);
    const theta = (pan + 1) * Math.PI / 4;
    const gains = [Math.cos(theta), Math.sin(theta)];
    const nearer = pan >= 0 ? 1 : 0;
    let last = null;
    for (let ear = 0; ear < 2; ear++) {
      const isNearer = ear === nearer;
      const path = ctx.createGain();
      path.gain.value = gains[ear] * dbToGain(isNearer ? place.ild * side * 0.25 : -place.ild * side * 0.75);
      const delay = ctx.createDelay(0.003);
      delay.delayTime.value = isNearer ? 0 : place.itd * side;
      const shade = ctx.createBiquadFilter();
      shade.type = 'lowpass';
      shade.Q.value = 0.5;
      shade.frequency.value = isNearer ? 19000 : 19000 * (2600 / 19000) ** (side * place.closeness);
      const panner = ctx.createStereoPanner();
      panner.pan.value = ear === 0 ? -1 : 1;
      source.connect(path);
      path.connect(delay);
      delay.connect(shade);
      shade.connect(panner);
      panner.connect(destination);
      nodes.push(path, delay, shade, panner);
      last = panner;
    }
    return last;
  }

  // Sets every layer's filters and sends from its current distance.
  update({ elapsed = 0, soloIndex = null, immediate = false, fast = false } = {}) {
    const now = this.ctx.currentTime;
    const tc = fast ? 0.35 : 2.4;
    const size = clamp(this.settings.size);
    const roomScale = 1.35 - 0.7 * size;
    const hallScale = 0.7 + 0.6 * size;
    const vastScale = 0.3 + 1.3 * size;
    const set = (param, value) => {
      if (immediate) param.value = value;
      else param.setTargetAtTime(value, now, tc);
    };
    this.lanes.forEach((lane, index) => {
      const depth = soloIndex === index ? 0.28 : this.depthAt(index, elapsed);
      lane.depth = depth;
      set(lane.low.frequency, anchor(LOWPASS_HZ, depth, true));
      set(lane.dry.gain, dbToGain(anchor(DRY_DB, depth)));
      set(lane.pre.delayTime, anchor(PRE_DELAY_S, depth));
      set(lane.sends.room.gain, dbToGain(anchor(ROOM_DB, depth)) * roomScale);
      set(lane.sends.hall.gain, dbToGain(anchor(HALL_DB, depth)) * hallScale);
      set(lane.sends.vast.gain, dbToGain(anchor(VAST_DB, depth)) * vastScale);
      set(lane.sends.echo.gain, dbToGain(anchor(ECHO_DB, depth)));
    });
  }

  // A fresh start for every tail (used when a solo ends, so nothing old leaks out).
  resetTails() {
    for (const chain of Object.values(this.reverbs)) {
      try { chain.input.disconnect(chain.convolver); } catch {}
      try { chain.convolver.disconnect(); } catch {}
      this._attach(chain);
    }
    this._buildEcho();
  }

  dispose() {
    for (const lane of this.lanes) {
      for (const node of [lane.input, lane.low, lane.dry, lane.pre, ...Object.values(lane.sends)]) { try { node.disconnect(); } catch {} }
    }
    for (const chain of Object.values(this.reverbs)) {
      for (const node of [chain.input, chain.convolver, chain.high, chain.low, chain.out]) { try { node.disconnect(); } catch {} }
    }
    for (const node of [this.echo.input, ...(this.echo.nodes || [])]) { try { node.disconnect(); } catch {} }
  }
}
