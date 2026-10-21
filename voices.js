// LOOPRA 0.3 · FRIDAY AFTERNOON · the voices of the melody machine.
//
// Three ways to make one struck note with Web Audio alone (no sample, no download):
//
//   sine    : a sine with a decay, the sound of Eno's piece as it is rebuilt on the Reverb Machine page:
//             attack at once, 2.11 s of decay down to -18 dB, then the note holds until it lets go.
//   epiano  : an FM electric piano in the manner of the DX7: a short bell-like "tine" (a modulator at 14
//             times the pitch that dies in a tenth of a second) on a soft 1:1 "tone" that mellows as it
//             rings, plus a second tone a few cents away that slowly blooms.
//   piano   : a soft, felted piano by additive synthesis: three bands of harmonics that die at three speeds
//             (the highs first), two strings a hair apart (one lasts twice as long: the "aftersound"),
//             and a short thump of felt on the string.
//
// The two pianos turn into the sine as the pitch rises (from F#4 to E5): up there a struck piano or an
// electric piano sounds like a dry toy, and a sine with a decay does not.
//
// Each voice is built by hand at `at` (context time) and lasts about `duration` seconds. It returns
// { nodes, oscillators } so that the caller can clean up when the last source has ended.

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

export const VOICE_SECONDS = { sine: 12, epiano: 11, piano: 14 };
// Calibrated so that one note at velocity 0.7 has the same loudness in the three voices.
export const VOICE_GAIN = { sine: 0.106, epiano: 0.0615, piano: 0.223 };

// 0 up to F#4 (370 Hz), 1 from E5 (660 Hz): how much of the note is a plain sine.
const toSine = (hz) => clamp(Math.log2(hz / 370) / Math.log2(660 / 370), 0, 1);

function noiseBuffer(ctx) {
  if (!ctx.__machineNoise) {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let state = 0x9E3779B9 | 0;
    for (let i = 0; i < data.length; i++) {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      data[i] = ((state >>> 0) / 4294967296) * 2 - 1;
    }
    ctx.__machineNoise = buffer;
  }
  return ctx.__machineNoise;
}

export function sineVoice(ctx, out, { hz, at, duration, velocity = 0.7 }) {
  const oscillator = ctx.createOscillator();
  oscillator.type = 'sine';
  oscillator.frequency.value = hz;
  const gain = ctx.createGain();
  const peak = 0.5 * velocity;
  const end = at + duration;
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(peak, at + 0.005);
  // Decay 2.11 s down to -18 dB, then hold; let go at the end.
  gain.gain.setTargetAtTime(peak * 0.126, at + 0.005, 2.11 / 3.5);
  gain.gain.setTargetAtTime(0, end - 1.8, 0.45);
  oscillator.connect(gain);
  gain.connect(out);
  oscillator.start(at);
  oscillator.stop(end + 0.2);
  return { nodes: [oscillator, gain], oscillators: [oscillator] };
}

// The sine part of a piano note that is turning into a sine: `share` of the note, at the loudness a sine of
// this voice gain would have.
function sineShare(ctx, sum, params, share, relativeGain, nodes, oscillators) {
  if (share <= 0.001) return;
  const part = sineVoice(ctx, sum, { ...params, velocity: params.velocity * share * relativeGain });
  nodes.push(...part.nodes);
  oscillators.push(...part.oscillators);
}

export function epianoVoice(ctx, out, { hz, at, duration, velocity = 0.7, tine = 1 }) {
  const nodes = [];
  const oscillators = [];
  const sum = ctx.createGain();
  nodes.push(sum);
  const end = at + duration;
  const share = toSine(hz);
  const solid = 1 - share;
  // Low notes ring longer, high notes brighter and shorter, as on a real instrument.
  const ring = clamp((220 / hz) ** 0.4, 0.55, 1.7);
  // FM sidebands of high notes would fold back over the top of the spectrum: keep their indices modest.
  const bright = clamp((262 / hz) ** 0.5, 0.25, 1.3);
  const pair = (carrierRatio, modulatorRatio, level, indexStart, indexEnd, indexTau, ampTau, cents) => {
    const carrier = ctx.createOscillator();
    carrier.frequency.value = hz * carrierRatio;
    carrier.detune.value = cents;
    const modulator = ctx.createOscillator();
    modulator.frequency.value = hz * modulatorRatio;
    const depth = ctx.createGain();
    const modulatorHz = hz * modulatorRatio;
    depth.gain.setValueAtTime(indexStart * bright * modulatorHz, at);
    depth.gain.setTargetAtTime(indexEnd * bright * modulatorHz, at, indexTau);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, at);
    amp.gain.linearRampToValueAtTime(level * velocity, at + 0.003);
    amp.gain.setTargetAtTime(0.0001, at + 0.003, ampTau * ring);
    amp.gain.setTargetAtTime(0, end - 1.2, 0.3);
    modulator.connect(depth);
    depth.connect(carrier.frequency);
    carrier.connect(amp);
    amp.connect(sum);
    carrier.start(at); modulator.start(at);
    carrier.stop(end + 0.2); modulator.stop(end + 0.2);
    nodes.push(carrier, modulator, depth, amp);
    oscillators.push(carrier, modulator);
  };
  const touch = 0.5 + velocity;       // a harder touch opens the FM brighter, as on a real one
  if (solid > 0.001) {
    pair(1, 14, 0.20 * tine * solid, 1.6 * touch * (0.5 + 0.5 * tine), 0.0, 0.07, 0.55, 0);   // the tine: a bell-like tick that dies fast (0 = none, 1 = as designed)
    pair(1, 1, 0.52 * solid, 1.0 * touch, 0.22, 0.9, 1.9, +2.2);                              // the tone: soft, mellows as it rings
    pair(1, 1, 0.30 * solid, 0.7 * touch, 0.18, 1.1, 2.6, -2.8);                              // a second tone, a few cents away: the slow bloom
  }
  sineShare(ctx, sum, { hz, at, duration, velocity }, share, VOICE_GAIN.sine / VOICE_GAIN.epiano, nodes, oscillators);
  sum.connect(out);
  return { nodes, oscillators };
}

// Harmonic waves, shared by every note of a context: band 1 = harmonics 1-3, band 2 = 4-8, band 3 = 9-18.
function pianoWaves(ctx) {
  if (!ctx.__machinePianoWaves) {
    const bands = [[1, 3], [4, 8], [9, 18]];
    ctx.__machinePianoWaves = bands.map(([from, to]) => {
      const real = new Float32Array(to + 1);
      const imag = new Float32Array(to + 1);
      for (let n = from; n <= to; n++) {
        // Falling spectrum, softened by the felt, with the dip where the hammer strikes (an eighth of the string).
        imag[n] = (n ** -1.05) * Math.abs(Math.sin(Math.PI * n / 8) || 0.15) / (1 + (n / 6) ** 2);
      }
      return ctx.createPeriodicWave(real, imag, { disableNormalization: true });
    });
  }
  return ctx.__machinePianoWaves;
}

export function pianoVoice(ctx, out, { hz, at, duration, velocity = 0.7 }) {
  const nodes = [];
  const oscillators = [];
  const end = at + duration;
  const share = toSine(hz);
  const solid = 1 - share;
  const felt = ctx.createBiquadFilter();
  felt.type = 'lowpass';
  felt.frequency.value = clamp(1500 + 3800 * velocity, 1500, 5200);
  felt.Q.value = 0.4;
  const sum = ctx.createGain();
  sum.connect(felt);
  felt.connect(out);
  nodes.push(sum, felt);
  if (solid > 0.001) {
    const waves = pianoWaves(ctx);
    // Time for the first band to fall by 60 dB: about 12 s on a D3, shorter on higher notes.
    const t60 = clamp(12 * (146.8 / hz) ** 0.55, 3, 16);
    const tau = t60 / 6.9;
    const bands = [
      { wave: waves[0], tau, level: 1.0 },
      { wave: waves[1], tau: tau * 0.5, level: 0.55 },
      { wave: waves[2], tau: tau * 0.2, level: hz < 700 ? 0.3 : 0 },
    ];
    const strings = [{ cents: -0.9, share: 0.62, slow: 1 }, { cents: 1.1, share: 0.38, slow: 2.3 }];
    for (const band of bands) {
      if (!band.level) continue;
      for (const string of strings) {
        const oscillator = ctx.createOscillator();
        oscillator.setPeriodicWave(band.wave);
        oscillator.frequency.value = hz;
        oscillator.detune.value = string.cents;
        const amp = ctx.createGain();
        amp.gain.setValueAtTime(0, at);
        amp.gain.linearRampToValueAtTime(0.42 * velocity * band.level * string.share * solid, at + 0.0015);
        amp.gain.setTargetAtTime(0.0001, at + 0.0015, band.tau * string.slow);
        amp.gain.setTargetAtTime(0, end - 1.5, 0.35);
        oscillator.connect(amp);
        amp.connect(sum);
        oscillator.start(at);
        oscillator.stop(end + 0.2);
        nodes.push(oscillator, amp);
        oscillators.push(oscillator);
      }
    }
    // The thump of the felt on the string: a few tens of milliseconds of low, filtered noise.
    const thump = ctx.createBufferSource();
    thump.buffer = noiseBuffer(ctx);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = clamp(hz * 2.4, 180, 1400);
    band.Q.value = 0.9;
    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(0, at);
    thumpGain.gain.linearRampToValueAtTime(0.11 * velocity * solid, at + 0.002);
    thumpGain.gain.exponentialRampToValueAtTime(0.00001, at + 0.05);
    thump.connect(band);
    band.connect(thumpGain);
    thumpGain.connect(sum);
    thump.start(at, 0.3 + 0.9 * ((hz * 7.31) % 1));
    thump.stop(at + 0.08);
    nodes.push(thump, band, thumpGain);
    oscillators.push(thump);
  }
  sineShare(ctx, sum, { hz, at, duration, velocity }, share, VOICE_GAIN.sine / VOICE_GAIN.piano, nodes, oscillators);
  return { nodes, oscillators };
}

export const VOICES = { sine: sineVoice, epiano: epianoVoice, piano: pianoVoice };
