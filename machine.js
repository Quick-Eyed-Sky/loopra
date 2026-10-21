// LOOPRA 0.3 · FRIDAY AFTERNOON · the melody machine.
//
// What the Reverb Machine page does (see "LISEZ-MOI.md" here): a bank of independent loops,
// each one a SINGLE note with its own interval, redrawn at random inside [min, max] on every
// pass. Melodies are never written: they happen when the notes meet.
//
// What this does differently, following Loopra's own harmony:
//   - the notes are the CHORD OF THE PLACE (tonal space: key + mode), with the same ranks as the
//     harmonic pad of the engine: root, fifth and third always; the seventh, ninth, eleventh and
//     thirteenth as "Harmonic complexity" rises (the engine's own weights, read live);
//   - every note is checked against the long notes of the other layers AND against the machine's own
//     sounding notes before it is played: no semitone, seventh or tritone ever rubs.
// Pure logic, no audio: the engine and the statistics script both use it, so what is measured is
// what is played.

import { hashSeed, mulberry32 } from './rng.js';

export const MODE_STEPS = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 0, 3, 5, 7, 7, 10],
};

export const PITCH_CLASS = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };

// Scale degrees of the chord, with the rank the engine's pad gives them (audio.js, makeMotifs):
// rank 0 is always there, rank 1 appears with a little complexity, rank 4 only near the top.
const CHORD_DEGREES = [
  { degree: 0, rank: 0 }, { degree: 4, rank: 0 }, { degree: 2, rank: 0 },   // root, fifth, third
  { degree: 6, rank: 1 }, { degree: 1, rank: 2 }, { degree: 3, rank: 3 }, { degree: 5, rank: 4 },   // seventh, ninth, eleventh, thirteenth
];
// Five notes with no semitone and no tritone between any two of them, in any octave.
const MAJOR_PENTATONIC = [0, 2, 4, 7, 9];
const MINOR_PENTATONIC = [0, 3, 5, 7, 10];
const MAJOR_LIKE = new Set(['ionian', 'lydian', 'mixolydian']);

// kind: 'harmony' (the chord of the place, ranked: what the machine uses), 'pentatonic' (a fixed safe pool),
// 'scale' (every note of the mode: what a naive machine does), 'chord' (what the page does: the chord of
// the mode plus its fourth, like G7 + C). Returns [{ midi, rank }] in ascending pitch.
export function poolFor({ rootPitchClass, mode = 'aeolian', low = 50, high = 77, kind = 'harmony' }) {
  const scale = MODE_STEPS[mode] || MODE_STEPS.aeolian;
  const ranked = new Map();   // semitones above the root (0-11) -> lowest rank
  const add = (semitones, rank) => {
    const pc = ((semitones % 12) + 12) % 12;
    if (!ranked.has(pc) || ranked.get(pc) > rank) ranked.set(pc, rank);
  };
  if (kind === 'harmony') for (const { degree, rank } of CHORD_DEGREES) add(scale[degree], rank);
  else if (kind === 'scale') for (const step of scale) add(step, 0);
  else if (kind === 'chord') [scale[0], scale[2], scale[4], scale[6], scale[3]].forEach((step) => add(step, 0));
  else (MAJOR_LIKE.has(mode) ? MAJOR_PENTATONIC : MINOR_PENTATONIC).forEach((step) => add(step, 0));
  const pool = [];
  for (let midi = low; midi <= high; midi++) {
    const pc = (((midi - rootPitchClass) % 12) + 12) % 12;
    if (ranked.has(pc)) pool.push({ midi, rank: ranked.get(pc) });
  }
  return pool;
}

// Two notes that rub when they sound together: a semitone (or a seventh, or a ninth, up to two
// octaves apart) and a tritone within an octave. Whole tones and thirds are welcome.
export function clash(a, b) {
  const distance = Math.abs(a - b);
  const interval = distance % 12;
  return ((interval === 1 || interval === 11) && distance <= 25) || (interval === 6 && distance <= 12);
}

// The long notes that are sounding or about to sound, in the engine's own time (seconds).
export class Ledger {
  constructor() { this.items = []; }
  add(start, end, midi, tag = '') { this.items.push({ start, end, midi, tag }); }
  prune(before) { this.items = this.items.filter((item) => item.end >= before); }
  clashes(midi, from, to) {
    return this.items.some((item) => item.start < to && item.end > from && clash(midi, item.midi));
  }
}

const DEFAULTS = {
  voices: 10, low: 50, high: 77, kind: 'harmony', guard: true, wander: 0.15, maxPoly: 6,
  periodRange: [14, 62], audible: 8, startWithin: 40,
  salt: 0,        // another number draws other intervals and start times (the dice of the page)
  // table: [{ midi, lo, hi, delay }] replays a fixed bank of loops (used to render the page's own machine as a reference).
  table: null,
};

const evenly = (list, count, shift = 0) => Array.from({ length: count }, (_, k) => list[Math.min(list.length - 1, Math.floor(((k + 0.5 + shift) * list.length) / count))]);

// One note per voice, fixed for good (like the page): about 60 % of the voices carry the chord tones
// (always sounding), the others carry the colours (seventh, ninth, eleventh, thirteenth), which only
// sound as much as the Harmonic complexity lets them.
function assignNotes(pool, count) {
  const base = pool.filter((note) => note.rank === 0);
  const colour = pool.filter((note) => note.rank > 0);
  if (!colour.length) return evenly(pool, count);
  const baseCount = Math.max(1, Math.min(count, Math.round(count * 0.6)));
  const notes = evenly(base, baseCount);
  const ranks = [...new Set(colour.map((note) => note.rank))].sort();
  for (let k = 0; k < count - baseCount; k++) {
    const candidates = colour.filter((note) => note.rank === ranks[k % ranks.length]);
    notes.push(candidates[Math.floor((((0.37 + k * 0.618) % 1) * candidates.length))]);
  }
  return notes;
}

export class MelodyPlanner {
  // weight(rank) -> 0..1, the engine's own "Harmonic complexity" weights (read at every note, so the
  // slider is followed live). Default: every rank always on.
  constructor({ seed = 1, rootPitchClass = 2, mode = 'aeolian', weight = () => 1, ...settings } = {}) {
    this.seed = seed >>> 0;
    this.config = { ...DEFAULTS, ...settings };
    this.rootPitchClass = rootPitchClass;
    this.mode = mode;
    this.weight = weight;
    this.pool = poolFor({ rootPitchClass, mode, low: this.config.low, high: this.config.high, kind: this.config.kind });
    const [fast, slow] = this.config.periodRange;
    const notes = this.config.table ? null : assignNotes(this.pool, this.config.voices);
    this.voices = this.config.table ? this.config.table.map((row, index) => ({
      index, rand: mulberry32(hashSeed(this.seed, 'melody', 'voice', index)), lo: row.lo, hi: row.hi,
      note: { midi: row.midi, rank: 0 }, fixed: true, nextAt: row.delay,
    })) : Array.from({ length: this.config.voices }, (_, index) => {
      const rand = mulberry32(hashSeed(this.seed, 'melody', 'voice', index, ...(this.config.salt ? [this.config.salt] : [])));
      // Like the page: most loops are almost regular (3 to 17 % between shortest and longest), a few wander a lot (35 to 70 %).
      const base = fast * (slow / fast) ** rand();
      const spread = 0.03 + 0.95 * rand() ** 3;
      return { index, rand, lo: base * (1 - spread / 2), hi: base * (1 + spread / 2), note: notes[index], fixed: false, nextAt: this.config.startWithin * rand() };
    });
    this.live = [];
  }

  // Decides every note due before `until` (seconds, composition time), in chronological order.
  advance(until, ledger) {
    const decided = [];
    for (;;) {
      let due = null;
      for (const voice of this.voices) if (voice.nextAt <= until && (!due || voice.nextAt < due.nextAt)) due = voice;
      if (!due) break;
      const at = due.nextAt;
      due.nextAt += due.lo + (due.hi - due.lo) * due.rand();
      decided.push(this._decide(due, at, ledger));
    }
    return decided;
  }

  // The chord tone next to a note, going up (+1) or down (-1): a voice sometimes plays it instead of its own note.
  _neighbour(note, direction) {
    const chord = this.pool.filter((candidate) => candidate.rank === 0 && candidate.midi !== note.midi);
    const beyond = chord.filter((candidate) => (direction > 0 ? candidate.midi > note.midi : candidate.midi < note.midi));
    if (!beyond.length) return null;
    return direction > 0 ? beyond[0] : beyond[beyond.length - 1];
  }

  // The notes the guard may fall back on: the nearest ones that the current complexity lets sound.
  _near(note) {
    return this.pool
      .filter((candidate) => candidate.midi !== note.midi && this.weight(candidate.rank) >= 0.5)
      .sort((a, b) => Math.abs(a.midi - note.midi) - Math.abs(b.midi - note.midi) || a.midi - b.midi)
      .slice(0, 4);
  }

  _decide(voice, at, ledger) {
    const { wander, guard, maxPoly, audible } = this.config;
    // Always the same draws, whatever the outcome: a skipped note never changes the others.
    const moves = voice.rand() < wander;
    const direction = voice.rand() < 0.5 ? -1 : 1;
    const velocity = 0.45 + 0.4 * voice.rand();
    const gate = voice.rand();
    const home = voice.note;
    this.live = this.live.filter((entry) => entry.end > at);
    // A colour note sounds only as much as the Harmonic complexity allows.
    if (!voice.fixed && gate >= this.weight(home.rank)) return { at, voice: voice.index, midi: null, wanted: home.midi, velocity, skipped: 'colour' };
    const neighbour = moves && !voice.fixed ? this._neighbour(home, direction) : null;
    const intended = neighbour || home;
    if (this.live.length >= maxPoly) return { at, voice: voice.index, midi: null, wanted: intended.midi, velocity, skipped: 'busy' };
    const order = [intended];
    if (neighbour) order.push(home);
    if (!voice.fixed) for (const near of this._near(home)) if (!order.includes(near)) order.push(near);
    for (const note of order) {
      if (guard && ((ledger && ledger.clashes(note.midi, at, at + audible)) || this.live.some((entry) => clash(note.midi, entry.midi)))) continue;
      this.live.push({ end: at + audible, midi: note.midi });
      return { at, voice: voice.index, midi: note.midi, wanted: intended.midi, velocity, shifted: note.midi !== intended.midi, wandered: Boolean(neighbour) };
    }
    return { at, voice: voice.index, midi: null, wanted: intended.midi, velocity, skipped: 'clash' };
  }
}
