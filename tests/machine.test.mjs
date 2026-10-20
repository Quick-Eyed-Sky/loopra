// Properties the melody machine must keep, whatever the key, mode, seed or complexity.
// Run:  node --test tests/*.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { Ledger, MelodyPlanner, PITCH_CLASS, MODE_STEPS, clash, poolFor } from '../dist/machine.js';

const MODES = Object.keys(MODE_STEPS);
const KEYS = Object.values(PITCH_CLASS);
// The engine's own Harmonic complexity weights (audio.js, _harmonyWeight), for a complexity between 0 and 1.
const clamp = (value) => Math.min(1, Math.max(0, value));
const weights = (amount) => (rank) => (!rank ? 1 : rank === 1 ? clamp(amount / 0.5) : rank === 2 ? clamp((amount - 0.18) / 0.45) : rank === 3 ? clamp((amount - 0.48) / 0.4) : clamp((amount - 0.68) / 0.32));
const pairsThatRub = (notes) => notes.flatMap((a, i) => notes.slice(i + 1).filter((b) => clash(a, b)).map((b) => [a, b]));

test('the fixed pentatonic pool never has a semitone, a major seventh or a tritone, in any key and mode', () => {
  for (const mode of MODES) for (const rootPitchClass of KEYS) {
    const pool = poolFor({ rootPitchClass, mode, kind: 'pentatonic' }).map((note) => note.midi);
    assert.ok(pool.length >= 10, `${mode}: enough notes`);
    assert.deepEqual(pairsThatRub(pool), [], `${mode} in ${rootPitchClass}`);
  }
});

test('the chord tones of the place (root, third, fifth) never rub, in any key and mode', () => {
  for (const mode of MODES) for (const rootPitchClass of KEYS) {
    const chord = poolFor({ rootPitchClass, mode, kind: 'harmony' }).filter((note) => note.rank === 0).map((note) => note.midi);
    assert.ok(chord.length >= 6);
    assert.deepEqual(pairsThatRub(chord), [], `${mode} in ${rootPitchClass}`);
  }
});

test('the harmony pool carries the ranks of the engine: seventh 1, ninth 2, eleventh 3, thirteenth 4', () => {
  const pool = poolFor({ rootPitchClass: PITCH_CLASS.D, mode: 'aeolian', kind: 'harmony' });
  const rankOf = (name) => pool.find((note) => note.midi % 12 === PITCH_CLASS[name]).rank;
  assert.deepEqual(['D', 'F', 'A', 'C', 'E', 'G', 'A#'].map(rankOf), [0, 0, 0, 1, 2, 3, 4]);
});

test('a note that is played never rubs against the layers or against the machine itself (guard on)', () => {
  for (const mode of MODES) for (const seed of [1, 7, 42]) for (const amount of [0, 0.45, 1]) {
    const ledger = new Ledger();
    // Long notes of the layers: a few chords that change, including notes outside the chord.
    for (let t = 0; t < 1300; t += 31) for (const midi of [50 + (t % 5), 57, 64 + (t % 3), 71]) ledger.add(t, t + 42, midi);
    const planner = new MelodyPlanner({ seed, rootPitchClass: PITCH_CLASS.D, mode, weight: weights(amount) });
    const played = planner.advance(1200, ledger).filter((note) => note.midi !== null);
    assert.ok(played.length > 40, 'it plays');
    played.forEach((note, i) => {
      assert.equal(ledger.clashes(note.midi, note.at, note.at + 8), false, `${mode} seed ${seed}: against the layers`);
      for (const earlier of played.slice(0, i)) if (earlier.at + 8 > note.at) assert.equal(clash(note.midi, earlier.midi), false, `${mode} seed ${seed}: against itself`);
    });
  }
});

test('Harmonic complexity gates the colours, but never moves a note in time', () => {
  const run = (amount) => new MelodyPlanner({ seed: 42, rootPitchClass: PITCH_CLASS.D, mode: 'aeolian', guard: false, weight: weights(amount) }).advance(1500, null);
  const plain = run(0);
  const rich = run(1);
  assert.deepEqual(plain.map((note) => note.at), rich.map((note) => note.at), 'the same moments, whatever the slider');
  assert.ok(plain.filter((note) => note.midi !== null).every((note) => [0, 3, 7].includes((note.midi - 38) % 12 === 0 ? 0 : ((note.midi - 38) % 12))), 'only the chord tones of D minor at complexity 0');
  assert.ok(plain.some((note) => note.skipped === 'colour'));
  const seen = new Set(rich.filter((note) => note.midi !== null).map((note) => ((note.midi - 38) % 12 + 12) % 12));
  for (const semitones of [0, 3, 7, 10, 2, 5, 8]) assert.ok(seen.has(semitones), `semitone ${semitones} above D is heard at complexity 100`);
});

test('the same seed gives the same machine, and at most maxPoly notes sound together', () => {
  const run = () => new MelodyPlanner({ seed: 99, rootPitchClass: PITCH_CLASS.G, mode: 'dorian', weight: weights(0.6), maxPoly: 4 }).advance(900, null);
  assert.deepEqual(run(), run());
  const played = run().filter((note) => note.midi !== null);
  for (const note of played) assert.ok(played.filter((other) => other.at <= note.at && other.at + 8 > note.at).length <= 4);
});

test('the page\'s own bank of loops replays as written', () => {
  const table = [{ midi: 50, lo: 14.7, hi: 15.8, delay: 6.5 }, { midi: 62, lo: 40, hi: 82, delay: 21 }];
  const notes = new MelodyPlanner({ seed: 1, rootPitchClass: PITCH_CLASS.G, mode: 'mixolydian', table, guard: false, maxPoly: 99 }).advance(300, null);
  assert.deepEqual(new Set(notes.map((note) => note.midi)), new Set([50, 62]));
  assert.equal(notes.find((note) => note.midi === 50).at, 6.5);
  assert.equal(notes.find((note) => note.midi === 62).at, 21);
});
