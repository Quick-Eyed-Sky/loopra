// LOOPRA 0.3 · FRIDAY AFTERNOON · Loopra Stage + the melody machine.
//
// A homage to Brian Eno's "Thursday Afternoon": a bank of single-note loops, each on its own interval,
// whose melodies are never written but happen when the notes meet. This file extends the engine of
// audio.js without touching it: it adds a few lanes to the same room (every note has its own distance),
// a planner (machine.js) that decides the notes, and the voices (voices.js).
//
// The notes follow the tonal space (key and mode) and the Harmonic complexity: they are the chord of the
// place, with the ranks of the harmonic pad. A guard checks every note against the long notes of the
// layers and against the machine's own notes, so that nothing rubs: no semitone, seventh or tritone.

import { LoopraAudio as BaseAudio, LOOP_COUNT } from './audio.js?v=3';
import { SpaceRack, LANE_DEPTH } from './space.js';
import { unit } from './rng.js';
import { MelodyPlanner, Ledger, PITCH_CLASS } from './machine.js';
import { VOICES, VOICE_SECONDS, VOICE_GAIN } from './voices.js';

export { LOOP_COUNT };

const frequency = (midi) => 440 * 2 ** ((midi - 69) / 12);
export const MAX_VOICES = 16;   // lanes in the room: the number of voices can then change while it plays
export const INSTRUMENTS = ['sine', 'epiano', 'piano'];

export class LoopraAudio extends BaseAudio {
  // options.machine: { enabled, instrument: 'sine' | 'epiano' | 'piano', level (0-5), voices (1-16), tine (0-1.5),
  //                    kind, guard, wander, maxPoly, low, high, periodRange, salt }
  constructor(options = {}) {
    super(options);
    this._machine = { enabled: false, instrument: 'sine', level: 2.5, voices: 10, tine: 1, salt: 0, ...(options.machine || {}) };
    this._machine.voices = Math.max(1, Math.min(MAX_VOICES, Math.round(this._machine.voices)));
    if (!INSTRUMENTS.includes(this._machine.instrument)) this._machine.instrument = 'sine';
    this._planner = null;
    this._plannerKey = '';
    this._machineLanes = [];
    this._machineLog = [];
  }

  getMachine() { return { ...this._machine }; }

  // Changes the machine while it plays. A new planner takes over at the next tick and catches up with the
  // present; the sound settings (instrument, level, tine) need no new planner.
  setMachine(changes = {}) {
    const next = { ...this._machine, ...changes };
    next.voices = Math.max(1, Math.min(MAX_VOICES, Math.round(Number(next.voices) || 1)));
    if (!INSTRUMENTS.includes(next.instrument)) next.instrument = this._machine.instrument;
    next.level = Math.max(0, Math.min(5, Number(next.level) || 0));
    this._machine = next;
    if (this._ctx) {
      this._configureSound();   // the mix stays open for the machine alone, closes when everything is off
      const target = next.enabled ? 1 : 0;
      for (const lane of this._machineLanes) lane.gain.setTargetAtTime(target, this._ctx.currentTime, 0.12);
    }
  }

  // The same room as the engine's, with one more lane per machine voice (each at its own distance).
  _buildStage() {
    const depths = Array.from({ length: MAX_VOICES }, (_, i) => 0.18 + 0.62 * unit(this._seed, 'machine-depth', i));
    this._rack = new SpaceRack(this._ctx, {
      dryOutput: this._synthBus, wetOutput: this._wetReturnGate, seed: this._seed,
      baseDepths: [...LANE_DEPTH, ...depths], laneCount: this._tapes.length + MAX_VOICES, settings: this._stage, trim: 1.13,
    });
    this._tapes.forEach((tape, index) => {
      tape.gain.disconnect();
      tape.gain.connect(this._rack.lanes[index].input);
    });
    this._machineLanes = depths.map((_, i) => {
      const gain = this._ctx.createGain();
      gain.connect(this._rack.lanes[this._tapes.length + i].input);
      return gain;
    });
    this._tone.frequency.value = 20000;
    this._rack.update({ elapsed: this._compositionElapsed(), soloIndex: this._soloLoopIndex, immediate: true });
  }

  // With every layer off the engine mutes its mix; the machine must still be heard.
  _configureSound() {
    super._configureSound();
    if (this._ctx && this._machine.enabled && this._rack) this._compositionMix.gain.setTargetAtTime(1, this._ctx.currentTime, 0.06);
  }

  _tick() {
    super._tick();
    this._machineTick();
  }

  // The notes of the layers that sound for at least `minDuration` seconds between `from` and `to`
  // (composition time), exactly as the engine will schedule them (variation included).
  ledgerFor(from, to, minDuration = 3) {
    const ledger = new Ledger();
    this._tapes.forEach((tape, lane) => {
      if (this._effectiveLevel(lane) <= 0) return;
      const events = this._motifs[lane];
      const longest = Math.max(...events.map((event) => event.duration));
      const first = Math.floor((from + tape.phase - longest) / tape.duration);
      const last = Math.floor((to + tape.phase) / tape.duration);
      for (let cycle = first; cycle <= last; cycle++) {
        events.forEach((event, index) => {
          if (event.duration < minDuration) return;
          const start = cycle * tape.duration + event.at - tape.phase + this._eventShift(lane, cycle, index, tape);
          const end = start + event.duration;
          if (end <= from || start >= to) return;
          event.notes.forEach((note, i) => {
            const rank = event.ranks?.[i] ?? 0;
            if (rank > 0 && this._harmonyWeight(rank) < 0.4) return;
            if (typeof note === 'number') ledger.add(start, end, note, lane);
          });
        });
      }
    });
    return ledger;
  }

  _machineTick() {
    if (!this._machine.enabled || !this._rack || !this.playing || this.isFile || !this._ctx || this._ctx.state !== 'running') return;
    const now = this._ctx.currentTime;
    const elapsed = this._compositionElapsed();
    const ahead = elapsed + 1.5;
    const m = this._machine;
    const signature = JSON.stringify([this._seed, this._key, this._musicalMode, m.voices, m.kind, m.guard, m.wander, m.maxPoly, m.low, m.high, m.periodRange, m.salt || 0]);
    if (!this._planner || this._plannerKey !== signature) {
      this._plannerKey = signature;
      // The notes follow the tonal space (key, mode) and the engine's own Harmonic complexity, read live at every note.
      this._planner = new MelodyPlanner({ seed: this._seed, rootPitchClass: PITCH_CLASS[this._key], mode: this._musicalMode, weight: (rank) => this._harmonyWeight(rank), ...m });
    }
    const audible = this._planner.config.audible;
    const ledger = this._planner.config.guard ? this.ledgerFor(elapsed - 1, ahead + audible + 2) : null;
    for (const note of this._planner.advance(ahead, ledger)) {
      if (note.at < elapsed - 0.05) continue;   // a catch-up after a change of settings: those notes lie in the past
      this._machineLog.push(note);
      if (note.midi === null) continue;
      this._playMachineNote(note, now + Math.max(0.025, note.at - elapsed), elapsed, m.instrument);
    }
    if (this._machineLog.length > 4000) this._machineLog.splice(0, 2000);
  }

  _playMachineNote(note, at, elapsed, instrument) {
    const build = VOICES[instrument];
    if (!build) return;
    const ctx = this._ctx;
    const slot = note.voice % this._machineLanes.length;
    const out = ctx.createGain();
    out.gain.value = this._machine.level * (VOICE_GAIN[instrument] ?? 1);
    const nodes = [out];
    const position = unit(this._seed, 'machine-pan', note.voice, Math.round(note.at * 100)) * 2 - 1;
    this._rack.placeVoice(out, this._machineLanes[slot], this._tapes.length + slot, position, 1, elapsed, nodes);
    const built = build(ctx, out, { hz: frequency(note.midi), at, duration: VOICE_SECONDS[instrument], velocity: note.velocity, tine: this._machine.tine ?? 1 });
    nodes.push(...built.nodes);
    let ended = 0;
    for (const source of built.oscillators) {
      source.onended = () => {
        if (++ended === built.oscillators.length) for (const node of nodes) { try { node.disconnect(); } catch { /* already gone */ } }
      };
    }
  }
}

export { LoopraAudio as MachineAudio };
