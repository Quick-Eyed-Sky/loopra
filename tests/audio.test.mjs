import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { LoopraAudio, LOOP_COUNT } from '../dist/audio.js';

// This clock checks Web Audio scheduling and resource ownership, not the sound
// of filters, oscillators or reverberation. Listen in a browser for DSP quality.
const intervals = new Map();
const contexts = [];
let nextInterval = 1;
let savedGlobals;

function finite(value, label) {
  assert.ok(Number.isFinite(value), `${label} must be finite; received ${value}`);
}

class AudioParamFake {
  constructor(context, value = 0) {
    this.context = context;
    this.initial = value;
    this.events = [];
  }
  get value() { return this.valueAt(this.context.currentTime); }
  set value(value) { finite(value, 'AudioParam.value'); this.initial = value; }
  event(type, value, time, constant) {
    finite(value, `${type} value`);
    finite(time, `${type} time`);
    assert.ok(time >= 0, 'AudioParam time must be non-negative');
    if (type === 'exponential') assert.ok(value > 0, 'Exponential ramp target must be positive');
    if (type === 'target') assert.ok(Number.isFinite(constant) && constant > 0, 'Target time constant must be positive');
    this.events.push({ type, value, time, constant });
    return this;
  }
  setValueAtTime(value, time) { return this.event('set', value, time); }
  linearRampToValueAtTime(value, time) { return this.event('linear', value, time); }
  exponentialRampToValueAtTime(value, time) { return this.event('exponential', value, time); }
  setTargetAtTime(value, time, constant) { return this.event('target', value, time, constant); }
  cancelScheduledValues(time) {
    finite(time, 'Cancellation time');
    this.events = this.events.filter((event) => event.time < time);
    return this;
  }
  cancelAndHoldAtTime(time) {
    const held = this.valueAt(time);
    this.cancelScheduledValues(time);
    return this.setValueAtTime(held, time);
  }
  valueAt(time) {
    let value = this.initial;
    let at = 0;
    let target = null;
    const targetValue = (until) => target
      ? target.value + (value - target.value) * Math.exp(-(until - at) / target.constant)
      : value;
    for (const event of this.events.toSorted((a, b) => a.time - b.time)) {
      if (event.time > time) {
        if ((event.type === 'linear' || event.type === 'exponential') && !target && event.time > at) {
          const ratio = Math.max(0, (time - at) / (event.time - at));
          return event.type === 'exponential' && value > 0
            ? value * (event.value / value) ** ratio
            : value + (event.value - value) * ratio;
        }
        return targetValue(time);
      }
      value = targetValue(event.time);
      at = event.time;
      if (event.type === 'target') target = event;
      else { value = event.value; target = null; }
    }
    return targetValue(time);
  }
}

class TrackFake {
  constructor() { this.kind = 'audio'; this.readyState = 'live'; this.stopCalls = 0; }
  stop() { this.readyState = 'ended'; this.stopCalls++; }
}

class StreamFake {
  constructor() { this.tracks = [new TrackFake()]; }
  getTracks() { return [...this.tracks]; }
  getAudioTracks() { return this.getTracks(); }
  clone() { return new StreamFake(); }
}

class AudioNodeFake {
  constructor(context, kind) {
    this.context = context;
    this.kind = kind;
    this.connections = new Set();
    this.disconnected = false;
    this.fftSize = 2048;
    for (const name of ['gain', 'frequency', 'detune', 'pan', 'Q', 'delayTime', 'threshold', 'knee', 'ratio', 'attack', 'release', 'playbackRate']) {
      this[name] = new AudioParamFake(context, name === 'gain' || name === 'playbackRate' ? 1 : name === 'frequency' ? 440 : 0);
    }
  }
  get frequencyBinCount() { return this.fftSize / 2; }
  connect(node) { assert.ok(node, 'Audio connection needs a destination'); this.connections.add(node); return node; }
  disconnect(destination) {
    if (destination === undefined) this.connections.clear(); else this.connections.delete(destination);
    this.disconnected = this.connections.size === 0;
  }
  start(time = 0, offset = 0) {
    finite(time, 'Source start time'); finite(offset, 'Source offset');
    assert.ok(time >= 0 && offset >= 0);
    assert.equal(this.started, undefined, 'A source must only start once');
    this.started = true;
    this.startAt = Math.max(time, this.context.currentTime);
    this.offset = offset;
    this.context.sources.add(this);
    if (this.kind === 'buffer' && this.buffer && !this.loop) this.naturalEnd = this.startAt + this.buffer.duration - offset;
  }
  stop(time = this.context.currentTime) {
    finite(time, 'Source stop time');
    assert.ok(time >= 0);
    this.stopAt = Math.max(time, this.context.currentTime);
  }
  getByteFrequencyData(data) { data.fill(0); }
  getFloatTimeDomainData(data) { data.fill(0); }
}

class AudioContextFake extends EventTarget {
  constructor() {
    super();
    this.currentTime = 0;
    this.sampleRate = 8000;
    this.state = 'suspended';
    this.sources = new Set();
    this.oscillatorsCreated = 0;
    this.destination = new AudioNodeFake(this, 'destination');
    this.resumeGate = AudioContextFake.nextResumeGate;
    AudioContextFake.nextResumeGate = null;
    contexts.push(this);
  }
  node(kind) { return new AudioNodeFake(this, kind); }
  createGain() { return this.node('gain'); }
  createDynamicsCompressor() { return this.node('compressor'); }
  createAnalyser() { return this.node('analyser'); }
  createBiquadFilter() { return this.node('filter'); }
  createConvolver() { return this.node('convolver'); }
  createDelay() { return this.node('delay'); }
  createStereoPanner() { return this.node('panner'); }
  createOscillator() { this.oscillatorsCreated++; return this.node('oscillator'); }
  createBufferSource() { return this.node('buffer'); }
  createMediaStreamDestination() { const node = this.node('media'); node.stream = new StreamFake(); return node; }
  createBuffer(channels, length, sampleRate = this.sampleRate) {
    assert.ok(Number.isInteger(length) && length > 0, 'Audio buffer length must be a positive integer');
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { duration: length / sampleRate, getChannelData: (channel) => data[channel] };
  }
  async decodeAudioData(bytes) {
    assert.ok(bytes instanceof ArrayBuffer);
    if (!bytes.byteLength) throw new Error('Invalid audio');
    return { duration: 40 };
  }
  async resume() {
    if (this.resumeGate) await this.resumeGate;
    this.state = 'running'; this.dispatchEvent(new Event('statechange'));
  }
  async suspend() { this.state = 'suspended'; this.dispatchEvent(new Event('statechange')); }
  async close() { this.state = 'closed'; this.dispatchEvent(new Event('statechange')); }
  finishSources() {
    for (const source of this.sources) {
      const end = Math.min(source.stopAt ?? Infinity, source.naturalEnd ?? Infinity);
      if (end <= this.currentTime) {
        this.sources.delete(source); source.ended = true; source.onended?.();
      }
    }
  }
  advance(seconds, step = 0.24) {
    const target = this.currentTime + seconds;
    while (this.currentTime < target - 1e-9 && this.state === 'running') {
      this.currentTime = Math.min(target, this.currentTime + step);
      this.finishSources();
      for (const [id, timer] of [...intervals]) {
        if (timer.context !== this || !intervals.has(id)) continue;
        if (timer.next <= this.currentTime + 1e-9) {
          timer.next = this.currentTime + timer.period;
          timer.callback();
        }
      }
    }
  }
}

before(() => {
  savedGlobals = Object.fromEntries(['AudioContext', 'setInterval', 'clearInterval', 'CustomEvent'].map((name) => [name, globalThis[name]]));
  globalThis.AudioContext = AudioContextFake;
  globalThis.setInterval = (callback, milliseconds) => {
    const id = nextInterval++;
    const context = contexts.at(-1);
    const period = milliseconds / 1000;
    intervals.set(id, { callback, period, context, next: context.currentTime + period });
    return id;
  };
  globalThis.clearInterval = (id) => intervals.delete(id);
  globalThis.CustomEvent ??= class extends Event { constructor(type, options = {}) { super(type); this.detail = options.detail; } };
});

after(() => {
  assert.equal(intervals.size, 0, 'Every engine must release its scheduling timer');
  for (const [name, value] of Object.entries(savedGlobals)) {
    if (value === undefined) delete globalThis[name]; else globalThis[name] = value;
  }
});

function engineFor(t) { const audio = new LoopraAudio(); t.after(() => audio.destroy()); return audio; }
async function playing(audio) { assert.equal(await audio.start(), true); return contexts.at(-1); }
function positions(audio) { return audio.getLoopState().map((loop) => loop.position); }
function durations(audio) { return audio.getLoopState().map((loop) => loop.duration); }
function near(actual, expected, message) { assert.ok(Math.abs(actual - expected) < 1e-7, `${message}: ${actual} != ${expected}`); }
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
const wav = (name = 'field-recording.wav') => ({ name, type: 'audio/wav', size: 64, arrayBuffer: async () => new ArrayBuffer(8) });

function reachesOutput(node, context, visited = new Set()) {
  if (node === context.destination) return true;
  if (!node || visited.has(node)) return false;
  if (node.kind === 'gain' && Math.abs(node.gain.valueAt(context.currentTime)) < 1e-8) return false;
  visited.add(node);
  return [...(node.connections || [])].some((next) => reachesOutput(next, context, visited));
}

function onlyLane(audio, lane) {
  const live = [...audio._voices].filter((voice) => !voice.stopping && !voice.disposed);
  assert.ok(live.length > 0, `Solo lane ${lane} needs an audible phrase now`);
  assert.ok(live.every((voice) => voice.lane === lane), `Other-lane voices leaked into solo ${lane}`);
}

test('32 independent loops expose usable English metadata before audio permission', (t) => {
  const audio = engineFor(t);
  const loops = audio.getLoopState();
  assert.equal(LOOP_COUNT, 32);
  assert.equal(loops.length, 32);
  assert.equal(new Set(loops.map((loop) => loop.id)).size, 32);
  assert.equal(new Set(loops.map((loop) => loop.name)).size, 32);
  for (const loop of loops) {
    assert.match(loop.id, /^[a-z][a-z0-9-]*$/);
    assert.ok(loop.name.length > 2 && loop.name.length < 60);
    assert.doesNotMatch(loop.name, /[àâçéèêëîïôùûüœ]|\b(nappe|basse|insecte|feutré|soie|appels|vagissement|cloche|souffle|verre|sifflement|pincement|marée)\b/i);
    assert.ok(Number.isFinite(loop.duration) && loop.duration >= 12 && loop.duration <= 600);
    assert.ok(Number.isFinite(loop.position) && loop.position >= 0 && loop.position < loop.duration);
    assert.equal(loop.active, false);
  }
});

test('all 32 phrases stay within the selected key and modal pitch collection', (t) => {
  const audio = engineFor(t);
  const keys = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const scales = {
    ionian: [0, 2, 4, 5, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10],
    phrygian: [0, 1, 3, 5, 7, 8, 10], lydian: [0, 2, 4, 6, 7, 9, 11],
    mixolydian: [0, 2, 4, 5, 7, 9, 10], aeolian: [0, 2, 3, 5, 7, 8, 10],
    pentatonic: [0, 3, 5, 7, 10],
  };
  for (const [tonic, key] of keys.entries()) {
    audio.setKey(key);
    for (const [mode, allowed] of Object.entries(scales)) {
      assert.notEqual(audio.setMusicalMode(mode), false);
      assert.ok(audio.currentKey.startsWith(`${key} `));
      assert.equal(audio._motifs.length, 32);
      for (const [lane, phrase] of audio._motifs.entries()) {
        assert.ok(phrase.length > 0, `${key}/${mode} lane ${lane} needs a phrase`);
        for (const event of phrase) {
          assert.ok(Number.isFinite(event.duration) && event.duration > 0);
          assert.ok(Number.isFinite(event.at) && event.at >= 0);
          assert.ok(Number.isFinite(event.amplitude) && event.amplitude > 0 && event.amplitude <= 0.2);
          for (const note of event.notes) {
            assert.ok(Number.isFinite(note), `${key}/${mode} lane ${lane}: invalid pitch`);
            assert.ok(allowed.includes(((note - tonic) % 12 + 12) % 12), `${key}/${mode} lane ${lane}: ${note} is outside the mode`);
          }
        }
      }
    }
  }
  const key = audio.currentKey;
  assert.equal(audio.setMusicalMode('unknown-mode'), false);
  assert.equal(audio.currentKey, key);
});

test('continuous foundation and bounded voice cleanup survive multiple full cycles', async (t) => {
  const audio = engineFor(t);
  for (let lane = 0; lane < LOOP_COUNT; lane++) audio.setLoopLevel(lane, 1);
  audio.setLoopDurations(Array.from({ length: LOOP_COUNT }, (_, index) => 53 + index * 4));
  const context = await playing(audio);
  const seenLanes = new Set();
  let maxVoices = 0;
  let maxSources = 0;
  let maxHistory = 0;
  let minimumFoundation = Infinity;
  const simulation = Math.max(...durations(audio)) * 4;
  for (let elapsed = 0.24; elapsed < simulation; elapsed += 0.24) {
    context.advance(0.24);
    const voices = [...audio._voices];
    for (const voice of voices) seenLanes.add(voice.lane);
    maxVoices = Math.max(maxVoices, voices.length);
    maxSources = Math.max(maxSources, context.sources.size);
    maxHistory = Math.max(maxHistory, ...audio._tapes.map((tape) => tape.scheduled.size));
    const foundation = voices.filter((voice) => voice.lane < 2 && !voice.stopping && voice.startAt <= context.currentTime && voice.endAt > context.currentTime)
      .reduce((sum, voice) => sum + Math.max(0, voice.envelope.gain.valueAt(context.currentTime)), 0);
    minimumFoundation = Math.min(minimumFoundation, foundation);
    assert.ok(foundation > 0.001, `The continuous foundation dropped out at ${context.currentTime.toFixed(2)} seconds`);
    for (const loop of audio.getLoopState()) {
      assert.ok(loop.position >= 0 && loop.position < loop.duration);
    }
    assert.ok(context.sources.size < 512, 'Ended sources must not accumulate');
    assert.ok(audio._tapes.every((tape) => tape.scheduled.size < 24), 'Scheduler history must remain bounded');
  }
  assert.equal(seenLanes.size, 32, 'Every lane, including the new instruments, must actually produce voices');
  assert.ok(maxVoices < 256, `Excess live voices: ${maxVoices}`);
  assert.ok(minimumFoundation > 0.001);
  t.diagnostic(`All 32 enabled for ${simulation}s: peak ${maxVoices} voices / ${maxSources} sources; max ${maxHistory} scheduler entries per lane; minimum foundation envelope ${minimumFoundation.toFixed(4)}.`);
  for (const value of Object.values(audio.getLevels())) assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
});

test('muted loops allocate no voices, and unmuting joins the existing phase', async (t) => {
  const audio = engineFor(t);
  for (let lane = 0; lane < LOOP_COUNT; lane++) audio.setLoopLevel(lane, 0);
  const context = await playing(audio);
  const initialAllocations = context.oscillatorsCreated;
  context.advance(700);
  assert.equal(audio._voices.size, 0);
  assert.equal(context.oscillatorsCreated, initialAllocations, 'Muted instruments must not keep building inaudible oscillators');
  assert.ok(audio._tapes.every((tape) => tape.gain.gain.valueAt(context.currentTime) < 1e-8));
  assert.ok(audio._compositionMix.gain.valueAt(context.currentTime) < 1e-8, 'All-muted composition must silence the effect returns too');
  assert.ok(audio.getLoopState().every((loop) => !loop.active));
  const before = positions(audio);
  audio.setLoopLevel(17, 1);
  assert.deepEqual(positions(audio), before, 'Unmuting must not restart the composition');
  let heardLane = false;
  for (let time = 0; time < durations(audio)[17] + 2; time += 0.24) {
    context.advance(0.24);
    for (const voice of audio._voices) {
      assert.equal(voice.lane, 17, 'Muted lanes must remain unallocated');
      heardLane = true;
    }
  }
  assert.ok(heardLane, 'Unmuted lane must play during its next phrase');
  audio.setLoopLevel(17, 0);
  context.advance(10);
  assert.equal(audio._voices.size, 0, 'Muting must release current lane voices');
  const allocations = context.oscillatorsCreated;
  context.advance(700);
  assert.equal(context.oscillatorsCreated, allocations, 'Muted cycles must not keep allocating nodes');
  assert.ok(audio.getLoopState().every((loop) => !loop.active));
  assert.ok(audio._compositionMix.gain.valueAt(context.currentTime) < 1e-8);
  await audio.loadFile(wav());
  context.advance(0.3);
  assert.ok(audio._fileGain.gain.valueAt(context.currentTime) > 0.9, 'Muted synth loops must not mute an imported recording');
});

test('rare insect and bowed-bass accents retain their short and gradual envelopes', async (t) => {
  const audio = engineFor(t);
  audio.setLoopDurations([50, 80, 174, 190, 23, 29, 127, 159]);
  for (let lane = 0; lane < LOOP_COUNT; lane++) audio.setLoopLevel(lane, lane === 3 || lane === 7 ? 1 : 0);
  const context = await playing(audio);
  const accents = new Map();
  for (let elapsed = 0; elapsed < 36; elapsed += 0.12) {
    context.advance(0.12);
    for (const voice of audio._voices) if (!accents.has(voice.kind)) accents.set(voice.kind, voice);
  }
  const insect = accents.get('shimmer');
  const wail = accents.get('wail');
  assert.ok(insect && wail, 'Both rare accents must actually be scheduled');
  near(insect.endAt - insect.startAt, 1, 'Insect duration');
  near(wail.endAt - wail.startAt, 14.5, 'Bowed-bass duration');
  const peak = wail.envelope.gain.events.reduce((largest, event) => event.value > largest.value ? event : largest, { value: -Infinity });
  near(peak.time - wail.startAt, 4.5, 'Bowed-bass attack');
  for (const voice of [insect, wail]) {
    const final = voice.envelope.gain.events.at(-1);
    assert.equal(final.value, 0, 'Accent envelope must return fully to silence');
    near(final.time, voice.endAt, 'Accent release endpoint');
  }
});

test('duration restoration is idempotent, validates input and preserves legacy subsets', async (t) => {
  const audio = engineFor(t);
  const context = await playing(audio);
  context.advance(11);
  const current = durations(audio);
  const phase = positions(audio);
  const voices = [...audio._voices];
  let resets = 0;
  audio.addEventListener('statechange', (event) => { if (event.detail.reason === 'loops') resets++; });
  assert.deepEqual(audio.setLoopDurations([...current]), current);
  assert.deepEqual(positions(audio), phase);
  assert.deepEqual([...audio._voices], voices, 'Restoring unchanged durations must not fade or duplicate voices');
  assert.equal(resets, 0);
  for (const bad of [[1, 2, 3], Array(32).fill(NaN), Array(32).fill(null), 'not-an-array']) {
    assert.equal(audio.setLoopDurations(bad), false);
    assert.deepEqual(durations(audio), current);
  }
  for (const length of [4, 8, 16]) {
    const before = durations(audio);
    const requested = Array.from({ length }, (_, index) => 61 + index * 2);
    const result = audio.setLoopDurations(requested);
    assert.equal(result.length, 32);
    assert.deepEqual(result.slice(0, length), requested);
    assert.deepEqual(result.slice(length), before.slice(length));
  }
  for (let run = 0; run < 20; run++) {
    const result = audio.rerollLoops();
    assert.equal(result.length, 32);
    assert.equal(new Set(result).size, 32, 'Independent loops need distinct periods');
    assert.ok(result.every((duration) => Number.isFinite(duration) && duration >= 12 && duration <= 600));
  }
});

test('harmony controls change voicings without restarting phase or replacing live voices', async (t) => {
  const audio = engineFor(t);
  const context = await playing(audio);
  context.advance(1);
  const phase = positions(audio);
  const voices = [...audio._voices];
  audio.setHarmonyComplexity(1);
  audio.setIntensity(0.8);
  audio.setVolume(0.4);
  assert.deepEqual(positions(audio), phase);
  assert.deepEqual([...audio._voices], voices);
  context.advance(2);
  for (const voice of voices.filter((voice) => voice.harmonyRank && !voice.disposed)) {
    assert.ok(voice.harmonyGain.gain.value > 0.9, 'Higher complexity should open upper chord tones');
  }
  audio.setHarmonyComplexity(0);
  context.advance(3);
  for (const voice of voices.filter((voice) => voice.harmonyRank && !voice.disposed)) {
    assert.ok(voice.harmonyGain.gain.value < 0.01, 'Lower complexity should soften upper chord tones');
  }
});

test('pause, resume, imported audio and return to composition preserve their own offsets', async (t) => {
  const audio = engineFor(t);
  const context = await playing(audio);
  context.advance(17.25);
  await audio.stop();
  const paused = positions(audio);
  assert.equal(audio.playing, false);
  assert.equal(context.state, 'suspended');
  assert.ok(![...intervals.values()].some((timer) => timer.context === context));
  await playing(audio);
  context.advance(2);
  audio.getLoopState().forEach((loop, index) => near(loop.position, (paused[index] + 2) % loop.duration, 'Resumed phase'));
  const composition = positions(audio);
  assert.equal(await audio.loadFile(wav()), true);
  assert.equal(audio.isFile, true);
  context.advance(12.5);
  assert.deepEqual(positions(audio), composition, 'An import must freeze the generative composition');
  await audio.stop();
  await playing(audio);
  near(audio._fileSource.offset, 12.5, 'Imported audio resume offset');
  const source = audio._fileSource;
  audio.useComposition();
  assert.equal(audio.isFile, false);
  assert.ok(source.disconnected);
  assert.ok(source.stopAt <= context.currentTime);
  assert.deepEqual(positions(audio), composition);
  context.advance(1);
  audio.getLoopState().forEach((loop, index) => near(loop.position, (composition[index] + 1) % loop.duration, 'Returned composition phase'));
});

test('invalid and stale imports cannot replace the current source', async (t) => {
  const audio = engineFor(t);
  await playing(audio);
  await audio.loadFile(wav('first.wav'));
  const current = audio._fileSource;
  await assert.rejects(audio.loadFile({ name: 'notes.txt', type: 'text/plain', size: 1, arrayBuffer: async () => new ArrayBuffer(1) }));
  await assert.rejects(audio.loadFile({ ...wav(), size: 300 * 1024 * 1024 }));
  assert.equal(audio._fileSource, current);
  const oldRead = deferred();
  const oldImport = audio.loadFile({ ...wav('old.wav'), arrayBuffer: () => oldRead.promise });
  assert.equal(await audio.loadFile(wav('new.wav')), true);
  const replacement = audio._fileSource;
  oldRead.resolve(new ArrayBuffer(8));
  assert.equal(await oldImport, false);
  assert.equal(audio._fileSource, replacement);
  assert.equal(audio.sourceName, 'new');
  const pendingRead = deferred();
  const pendingImport = audio.loadFile({ ...wav('late.wav'), arrayBuffer: () => pendingRead.promise });
  audio.useComposition();
  pendingRead.resolve(new ArrayBuffer(8));
  assert.equal(await pendingImport, false);
  assert.equal(audio.isFile, false);
});

test('stop cancels an in-flight start and repeated transport calls do not create duplicate clocks', async (t) => {
  const audio = engineFor(t);
  const gate = deferred();
  AudioContextFake.nextResumeGate = gate.promise;
  const pending = audio.start();
  await audio.stop();
  gate.resolve();
  assert.equal(await pending, false);
  assert.equal(audio.playing, false);
  const context = contexts.at(-1);
  assert.ok(![...intervals.values()].some((timer) => timer.context === context));
  await playing(audio);
  await audio.start();
  assert.equal([...intervals.values()].filter((timer) => timer.context === context).length, 1);
  await audio.toggle();
  assert.equal(audio.playing, false);
  await audio.toggle();
  assert.equal(audio.playing, true);
  assert.equal([...intervals.values()].filter((timer) => timer.context === context).length, 1);
});

test('recording tracks are isolated clones; destroy cleans engine-owned sources and timers', async (t) => {
  const audio = engineFor(t);
  const context = await playing(audio);
  context.advance(5);
  const first = audio.getOutputStream();
  const second = audio.getOutputStream();
  const original = audio._recordingDestination.stream.getTracks()[0];
  assert.notEqual(first.getTracks()[0], second.getTracks()[0]);
  assert.notEqual(first.getTracks()[0], original);
  first.getTracks().forEach((track) => track.stop());
  assert.equal(second.getTracks()[0].readyState, 'live');
  assert.equal(original.readyState, 'live');
  const read = deferred();
  const pending = audio.loadFile({ ...wav('after-close.wav'), arrayBuffer: () => read.promise });
  audio.destroy();
  audio.destroy();
  read.resolve(new ArrayBuffer(8));
  assert.equal(await pending, false);
  context.finishSources();
  assert.equal(audio._voices.size, 0);
  assert.equal(context.sources.size, 0);
  assert.equal(context.state, 'closed');
  assert.equal(original.readyState, 'ended');
  assert.ok(![...intervals.values()].some((timer) => timer.context === context));
  second.getTracks().forEach((track) => track.stop());
  assert.equal(second.getTracks()[0].readyState, 'ended');
  await assert.rejects(audio.start());
});

test('solo selection is exclusive, validates indices and leaves the stored mix intact', (t) => {
  const audio = engineFor(t);
  const mix = audio.getLoopState().map((loop) => loop.level);
  assert.equal(audio.soloLoopIndex, null);
  assert.equal(audio.setSoloLoop(17), true);
  assert.equal(audio.soloLoopIndex, 17);
  assert.equal(audio.setSoloLoop(17), true, 'Selecting the same solo twice must be idempotent');
  assert.equal(audio.playing, false, 'Selection alone must not start playback');
  for (const invalid of [-1, LOOP_COUNT, 1.5, NaN]) {
    assert.equal(audio.setSoloLoop(invalid), false);
    assert.equal(audio.soloLoopIndex, 17);
  }
  assert.equal(audio.setSoloLoop(31), true);
  assert.equal(audio.soloLoopIndex, 31);
  assert.deepEqual(audio.getLoopState().map((loop) => loop.level), mix);
  assert.equal(audio.setSoloLoop(null), true);
  assert.equal(audio.soloLoopIndex, null);
  assert.deepEqual(audio.getLoopState().map((loop) => loop.level), mix);
});

test('auditioning a muted sparse lane is prompt, dry and isolated; exit restores the advancing mix', async (t) => {
  const audio = engineFor(t);
  audio.setLoopLevel(0, 0.7);
  audio.setLoopLevel(2, 0);
  audio.setLoopLevel(16, 0.5);
  const mix = audio.getLoopState().map((loop) => loop.level);
  assert.equal(mix[17], 0, 'The test must audition a previously muted instrument');
  const context = await playing(audio);
  context.advance(17.37);
  const phase = positions(audio);
  const oldEffects = [audio._reverb, audio._delay];
  assert.equal(await audio.auditionLoop(17), true);
  assert.equal(audio.soloLoopIndex, 17);
  assert.deepEqual(positions(audio), phase, 'Preview must not seek or restart any tape');
  context.advance(0.2);
  onlyLane(audio, 17);
  const state = audio.getLoopState();
  assert.equal(state[17].level, 0, 'Solo must preserve the stored mute');
  assert.equal(state[17].active, true, 'An out-of-phase audition must be reported as active');
  assert.ok(state.every((loop, lane) => lane === 17 || !loop.active));
  assert.deepEqual(state.map((loop) => loop.level), mix);
  state.forEach((loop, lane) => near(loop.position, (phase[lane] + 0.2) % loop.duration, 'Solo phase'));
  assert.ok(!reachesOutput(audio._air, context), 'Global atmospheric noise must not leak into any solo');
  for (const effect of oldEffects) assert.ok(!reachesOutput(effect, context), 'Previous mix reverberation and delay tails must be blocked');
  audio._tapes.forEach((tape, lane) => {
    if (lane !== 17) near(tape.gain.gain.valueAt(context.currentTime), 0, 'Non-solo effective gain');
  });
  assert.ok(audio._tapes[17].gain.gain.valueAt(context.currentTime) > 0, 'Muted solo needs a temporary effective gain');
  const exitPhase = positions(audio);
  audio.setSoloLoop(null);
  assert.deepEqual(positions(audio), exitPhase);
  context.advance(0.3);
  assert.equal(audio.soloLoopIndex, null);
  assert.deepEqual(audio.getLoopState().map((loop) => loop.level), mix);
  audio._tapes.forEach((tape, lane) => near(tape.gain.gain.valueAt(context.currentTime), mix[lane] * tape.trim, 'Restored mix gain'));
  audio.getLoopState().forEach((loop, lane) => near(loop.position, (exitPhase[lane] + 0.3) % loop.duration, 'Returned mix phase'));
});

test('switching through every audition releases previous voices and keeps one scheduler', async (t) => {
  const audio = engineFor(t);
  const mix = audio.getLoopState().map((loop) => loop.level);
  const context = await playing(audio);
  let peakSources = 0;
  for (let lane = 0; lane < LOOP_COUNT; lane++) {
    assert.equal(await audio.auditionLoop(lane), true);
    context.advance(0.12);
    assert.equal(audio.soloLoopIndex, lane);
    onlyLane(audio, lane);
    assert.equal(audio.getLoopState()[lane].active, true);
    assert.ok(!reachesOutput(audio._air, context), 'Ambient air must stay out of pad solo too');
    peakSources = Math.max(peakSources, context.sources.size);
    assert.equal([...intervals.values()].filter((timer) => timer.context === context).length, 1);
    assert.deepEqual(audio.getLoopState().map((loop) => loop.level), mix);
  }
  assert.ok(peakSources < 160, `Rapid solo switches retained too many sources: ${peakSources}`);
  audio.setSoloLoop(null);
  context.advance(1);
  assert.equal(audio.soloLoopIndex, null);
  assert.ok(audio._voices.size < 96);
  t.diagnostic(`All 32 auditions switched: peak ${peakSources} sources, no ambient path or previous-lane voices.`);
});

test('only a committed audio import clears solo; failed or cancelled reads leave it alone', async (t) => {
  const audio = engineFor(t);
  assert.equal(await audio.auditionLoop(17), true);
  const context = contexts.at(-1);
  const mix = audio.getLoopState().map((loop) => loop.level);
  await assert.rejects(audio.loadFile({ name: 'notes.txt', type: 'text/plain', size: 1, arrayBuffer: async () => new ArrayBuffer(1) }));
  assert.equal(audio.soloLoopIndex, 17);
  const read = deferred();
  const pending = audio.loadFile({ ...wav(), arrayBuffer: () => read.promise });
  assert.equal(audio.soloLoopIndex, 17, 'Merely beginning a read must not clear solo');
  read.resolve(new ArrayBuffer(8));
  assert.equal(await pending, true);
  assert.equal(audio.soloLoopIndex, null);
  assert.equal(audio.isFile, true);
  context.advance(1);
  assert.equal(audio._voices.size, 0);
  assert.deepEqual(audio.getLoopState().map((loop) => loop.level), mix);
  audio.useComposition();
  const lateRead = deferred();
  const stale = audio.loadFile({ ...wav('late.wav'), arrayBuffer: () => lateRead.promise });
  audio.useComposition();
  assert.equal(await audio.auditionLoop(31), true);
  lateRead.resolve(new ArrayBuffer(8));
  assert.equal(await stale, false);
  assert.equal(audio.soloLoopIndex, 31, 'A cancelled import must not undo a newer solo');
});

test('changing or exiting solo during audio resume cannot play a stale audition', async (t) => {
  const audio = engineFor(t);
  const gate = deferred();
  AudioContextFake.nextResumeGate = gate.promise;
  const earlier = audio.auditionLoop(3);
  const latest = audio.auditionLoop(17);
  gate.resolve();
  assert.equal(await earlier, false);
  assert.equal(await latest, true);
  const context = contexts.at(-1);
  context.advance(0.12);
  assert.equal(audio.soloLoopIndex, 17);
  onlyLane(audio, 17);

  const cancelledAudio = engineFor(t);
  const exitGate = deferred();
  AudioContextFake.nextResumeGate = exitGate.promise;
  const cancelled = cancelledAudio.auditionLoop(3);
  cancelledAudio.setSoloLoop(null);
  exitGate.resolve();
  assert.equal(await cancelled, false);
  const exitContext = contexts.at(-1);
  exitContext.advance(0.12);
  assert.equal(cancelledAudio.soloLoopIndex, null);
  assert.ok([...cancelledAudio._voices].every((voice) => voice.lane !== 3), 'Exiting solo must suppress the delayed insect preview');
});

test('pause and destroy cancel pending auditions without reactivating transport or leaking sources', async (t) => {
  for (const action of ['stop', 'destroy']) {
    const audio = engineFor(t);
    const gate = deferred();
    AudioContextFake.nextResumeGate = gate.promise;
    const pending = audio.auditionLoop(31);
    const context = contexts.at(-1);
    await audio[action]();
    gate.resolve();
    assert.equal(await pending, false, `${action} must cancel the pending preview`);
    context.finishSources();
    assert.equal(audio.playing, false);
    assert.equal(audio._voices.size, 0);
    assert.ok(![...intervals.values()].some((timer) => timer.context === context));
    if (action === 'destroy') assert.equal(context.sources.size, 0);
  }
});

// ---- Loopra Stage -------------------------------------------------------------
// These check routing, ordering and determinism of the Stage additions. How they
// sound is for the ears; the numbers here only guard against silent mistakes.
function stageEngine(t, features = { stage: true, timbre: true, variation: true }, seed = 7) {
  const audio = new LoopraAudio({ seed, features });
  t.after(() => audio.destroy());
  return audio;
}

test('classic mode (every Stage feature off) keeps the 0.1.1 signal path', async (t) => {
  const audio = engineFor(t);
  await playing(audio);
  assert.equal(audio._rack, null);
  assert.ok(audio._tapes.every((tape) => tape.gain.connections.has(audio._synthBus)));
});

test('stage: every layer feeds its own distance rack and reaches the output', async (t) => {
  const audio = stageEngine(t);
  const context = await playing(audio);
  const rack = audio._rack;
  assert.equal(rack.lanes.length, 32);
  audio._tapes.forEach((tape, index) => {
    assert.ok(tape.gain.connections.has(rack.lanes[index].input), `layer ${index} must feed its rack lane`);
    assert.ok(!tape.gain.connections.has(audio._synthBus), `layer ${index} must not bypass the rack`);
  });
  context.advance(30);
  assert.ok(reachesOutput(rack.lanes[4].input, context), 'a rack lane must reach the output');
});

test('stage: farther layers are darker, quieter in the direct sound, and wetter', async (t) => {
  const audio = stageEngine(t);
  await playing(audio);
  const lanes = audio._rack.lanes.map((lane) => ({ lane, depth: lane.depth })).sort((a, b) => a.depth - b.depth);
  assert.ok(lanes[0].depth < 0.15 && lanes.at(-1).depth > 0.85, 'the 32 layers must span ears to horizon');
  for (let i = 1; i < lanes.length; i++) {
    const near = lanes[i - 1].lane;
    const far = lanes[i].lane;
    assert.ok(far.low.frequency.initial <= near.low.frequency.initial + 1e-6, 'farther means darker');
    assert.ok(far.dry.gain.initial <= near.dry.gain.initial + 1e-9, 'farther means a quieter direct sound');
    assert.ok(far.sends.hall.gain.initial >= near.sends.hall.gain.initial - 1e-9, 'farther means more hall');
    assert.ok(far.pre.delayTime.initial <= near.pre.delayTime.initial + 1e-9, 'farther means a shorter pre-delay');
  }
});

test('stage: the same seed builds the same rooms, another seed builds other rooms', async (t) => {
  const first = stageEngine(t, undefined, 11);
  await playing(first);
  const twin = stageEngine(t, undefined, 11);
  await playing(twin);
  const other = stageEngine(t, undefined, 12);
  await playing(other);
  const slice = (engine) => Array.from(engine._rack.reverbs.hall.buffer.getChannelData(0).slice(0, 4000));
  assert.deepEqual(slice(first), slice(twin));
  assert.notDeepEqual(slice(first), slice(other));
});

test('stage: with variation at zero loops repeat exactly; above zero each pass is a new take', (t) => {
  const audio = stageEngine(t);
  const tape = audio._tapes[4];
  audio.setStage({ variation: 0 });
  assert.equal(audio._eventShift(4, 3, 0, tape), 0);
  audio.setStage({ variation: 0.8 });
  const shifts = [1, 2, 3, 4].map((cycle) => audio._eventShift(4, cycle, 0, tape));
  assert.equal(new Set(shifts).size, 4);
  assert.ok(shifts.every((shift) => Math.abs(shift) < 3.5), 'takes stay close to their place in the loop');
  const twin = stageEngine(t);
  twin.setLoopDurations(durations(audio));
  twin.setStage({ variation: 0.8 });
  assert.deepEqual([1, 2, 3, 4].map((cycle) => twin._eventShift(4, cycle, 0, twin._tapes[4])), shifts);
});

test('stage: settings are clamped and listening mode is validated', (t) => {
  const audio = stageEngine(t);
  audio.setStage({ amount: 7, walk: -2, size: Number.NaN, listening: 'cathedral' });
  const stage = audio.stage;
  assert.equal(stage.amount, 1);
  assert.equal(stage.walk, 0);
  assert.equal(stage.size, 0);
  assert.equal(stage.listening, 'headphones');
  audio.setStage({ listening: 'speakers', timbre: false });
  assert.equal(audio.stage.listening, 'speakers');
  assert.equal(audio.stage.timbre, false);
});

test('stage: all 32 layers for ten minutes stay bounded, finite and labelled by plane', async (t) => {
  const audio = stageEngine(t);
  for (let i = 0; i < 32; i++) audio.setLoopLevel(i, 1);
  const context = await playing(audio);
  let peak = 0;
  for (let i = 0; i < 600; i++) { context.advance(1); peak = Math.max(peak, audio._voices.size); }
  assert.ok(peak < 160, `voices stayed bounded: ${peak}`);
  assert.ok(audio.getLoopState().every((loop) => Number.isFinite(loop.depth) && ['EAR', 'NEAR', 'ROOM', 'HALL', 'FAR'].includes(loop.plane)));
});

test('stage: solo plays one layer at a clear distance and leaving solo resets the tails', async (t) => {
  const audio = stageEngine(t);
  await playing(audio);
  const before = audio._rack.reverbs.hall.convolver;
  assert.equal(await audio.auditionLoop(13), true);
  assert.ok(Math.abs(audio._rack.lanes[13].depth - 0.28) < 1e-9, 'a soloed layer is brought to a clear, near distance');
  audio.setSoloLoop(null);
  assert.notEqual(audio._rack.reverbs.hall.convolver, before, 'tails start fresh after a solo');
});

test('stage: the harmonic pad starts at 70 % so it does not mask the others; classic keeps 100 %', (t) => {
  const staged = stageEngine(t);
  assert.equal(staged.getLoopState()[0].level, 0.7);
  assert.equal(staged.getLoopState()[1].level, 1);
  const classic = engineFor(t);
  assert.equal(classic.getLoopState()[0].level, 1, 'the 0.1.1 path is untouched');
});

test('stage: Silk & light, a veil that almost never stops, starts at 12 %; classic keeps full level', async (t) => {
  const staged = stageEngine(t);
  const silk = staged.getLoopState().findIndex((loop) => loop.id === 'silk');
  assert.ok(silk > 0, 'the layer exists');
  const stagedContext = await playing(staged);
  assert.equal(staged.getLoopState()[silk].level, 1, 'it stays an ordinary on/off layer');
  assert.ok(Math.abs(staged._tapes[silk].gain.gain.valueAt(stagedContext.currentTime) - 0.12) < 0.005, 'its gain starts at 12 %');
  assert.ok(Math.abs(staged._tapes[1].gain.gain.valueAt(stagedContext.currentTime) - 1) < 0.01, 'other layers are untouched');
  const classic = engineFor(t);
  const classicContext = await playing(classic);
  assert.ok(Math.abs(classic._tapes[silk].gain.gain.valueAt(classicContext.currentTime) - 1) < 0.01, 'the 0.1.1 path is untouched');
});

test('stage: the pad has its own level, and only the pad changes', async (t) => {
  const audio = stageEngine(t);
  const context = await playing(audio);
  audio.setLoopLevel(0, 0.35);
  context.advance(2);
  const loops = audio.getLoopState();
  assert.equal(loops[0].level, 0.35);
  assert.equal(loops[0].effectiveLevel, 0.35);
  assert.equal(loops[1].level, 1);
  assert.ok(Math.abs(audio._tapes[0].gain.gain.valueAt(context.currentTime) - 0.35) < 0.01, 'the pad gain follows its level');
  assert.ok(Math.abs(audio._tapes[1].gain.gain.valueAt(context.currentTime) - 1) < 0.01, 'other layers are untouched');
  audio.setLoopLevel(0, 0);
  context.advance(1);
  assert.equal(audio.getLoopState()[0].effectiveLevel, 0, 'at zero the pad is off');
});
