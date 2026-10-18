import { LoopraAudio, LOOP_COUNT } from './audio.js?v=2';

const audio = new LoopraAudio();
const $ = (id) => document.getElementById(id);
const storageKey = 'loopra.setup.v1';
const catalogue = audio.getLoopState();
const keys = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const modes = ['aeolian', 'ionian', 'dorian', 'lydian', 'mixolydian', 'phrygian', 'pentatonic'];
const ids = catalogue.map((loop) => loop.id);
let selection = ids.slice(0, 16);
let settings = { key: 'D', mode: 'aeolian', complexity: 45, volume: 50 };
let toastTimer, saveTimer;
let busy = false;
let elapsed = 0;
let startedAt = null;
let previousPlaying = false;
let lastFrame = 0;

const time = (seconds) => {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

function notify(message) {
  $('toast').textContent = message;
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 4200);
}

function setupSnapshot() {
  return {
    format: 'loopra-setup', version: 1,
    ...settings,
    enabled: [...selection],
    durations: audio.getLoopState().map((loop) => loop.duration),
  };
}

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(setupSnapshot())); }
    catch { /* Listening works when browser storage is unavailable. */ }
  }, 180);
}

function validateSetup(value) {
  if (!value || value.format !== 'loopra-setup' || value.version !== 1
    || !keys.includes(value.key) || !modes.includes(value.mode)
    || !Number.isFinite(value.complexity) || value.complexity < 0 || value.complexity > 100
    || !Number.isFinite(value.volume) || value.volume < 0 || value.volume > 100
    || !Array.isArray(value.enabled) || value.enabled.length > LOOP_COUNT
    || value.enabled.some((id) => !ids.includes(id))
    || new Set(value.enabled).size !== value.enabled.length
    || !Array.isArray(value.durations) || value.durations.length !== LOOP_COUNT
    || value.durations.some((duration) => !Number.isFinite(duration) || duration < 1 || duration > 600)) {
    throw new Error('This is not a valid Loopra setup. Choose a file saved by Loopra.');
  }
  return value;
}

function applySetup(value) {
  audio.setSoloLoop(null);
  settings = { key: value.key, mode: value.mode, complexity: value.complexity, volume: value.volume };
  selection = [...value.enabled];
  audio.setKey(settings.key);
  audio.setMusicalMode(settings.mode);
  audio.setHarmonyComplexity(settings.complexity / 100);
  audio.setVolume(settings.volume * 0.0064);
  audio.setLoopDurations(value.durations);
  catalogue.forEach((loop, index) => audio.setLoopLevel(index, selection.includes(loop.id) ? 1 : 0));
}

try {
  const saved = localStorage.getItem(storageKey);
  if (saved) applySetup(validateSetup(JSON.parse(saved)));
} catch { /* Invalid or old stored settings fall back to the original score. */ }
audio.setHarmonyComplexity(settings.complexity / 100);
audio.setVolume(settings.volume * 0.0064);

const cards = catalogue.map((loop, index) => {
  const card = document.createElement('div');
  card.className = 'loop-card';
  const button = document.createElement('button');
  button.className = 'loop-toggle';
  button.type = 'button';
  button.title = loop.description || loop.name;
  button.innerHTML = '<span class="reel" aria-hidden="true"><i></i></span><span class="loop-copy"><strong class="loop-name"></strong><span class="loop-bottom"><span class="loop-track"><i></i></span><span class="loop-duration"></span></span></span><i class="sound-dot" aria-hidden="true"></i>';
  button.querySelector('.loop-name').textContent = loop.name;
  button.addEventListener('click', () => {
    audio.setSoloLoop(null);
    selection = selection.includes(loop.id) ? selection.filter((id) => id !== loop.id) : [...selection, loop.id];
    audio.setLoopLevel(index, selection.includes(loop.id) ? 1 : 0);
    render();
    persist();
  });
  const solo = document.createElement('button');
  solo.className = 'solo-button';
  solo.type = 'button';
  solo.innerHTML = '<svg aria-hidden="true"><use href="#headphones"/></svg>';
  solo.addEventListener('click', async () => {
    if (audio.soloLoopIndex === index) {
      audio.setSoloLoop(null);
      render();
      return;
    }
    try { await audio.auditionLoop(index); }
    catch (error) { notify(error.message || 'This layer could not play. Please try again.'); }
    finally { render(); }
  });
  card.append(button, solo);
  $('loopList').append(card);
  return { card, button, solo };
});

function paintRange(input) {
  input.style.setProperty('--range', `${100 * (input.value - input.min) / (input.max - input.min)}%`);
}

function render() {
  $('loopCount').value = selection.length;
  $('loopCountValue').firstChild.textContent = `${selection.length} `;
  $('enabledBadge').textContent = `${selection.length} ON · ${LOOP_COUNT} AVAILABLE`;
  $('key').value = settings.key;
  $('mode').value = settings.mode;
  $('complexity').value = settings.complexity;
  $('complexityValue').value = settings.complexity;
  $('volume').value = settings.volume;
  $('volumeValue').value = settings.volume;
  $('keyReadout').textContent = `${settings.key} ${settings.mode === 'aeolian' ? 'MINOR' : settings.mode === 'ionian' ? 'MAJOR' : settings.mode.toUpperCase()}`;
  document.querySelectorAll('input[type="range"]').forEach(paintRange);
  const soloIndex = audio.soloLoopIndex;
  const soloName = catalogue[soloIndex]?.name;
  $('soloPanel').hidden = soloIndex === null;
  $('soloName').textContent = soloName || '';
  $('transport').setAttribute('aria-pressed', String(audio.playing));
  $('transport').setAttribute('aria-label', audio.playing ? 'Pause listening' : 'Start listening');
  $('transport').querySelector('use').setAttribute('href', audio.playing ? '#pause' : '#play');
  $('transportText').textContent = audio.playing ? 'Pause listening' : 'Start listening';
  $('transportDot').classList.toggle('playing', audio.playing);
  $('sourceName').textContent = soloName ? `Solo · ${soloName}` : 'Independent loops · one shared key';
  $('playStatus').textContent = soloName ? (audio.playing ? 'One layer. Your mix is waiting.' : 'Solo paused. Your mix is waiting.')
    : selection.length === 0 ? 'All layers are off. Let one in.'
      : settings.volume === 0 ? 'Volume is at zero.'
        : audio.playing ? 'The loops are finding each other.' : elapsed > 0 ? 'Paused. The loops will wait.' : 'Ready when you are.';
  updateLoops();
}

function updateLoops() {
  audio.getLoopState().forEach((loop, index) => {
    const { card, button, solo } = cards[index];
    const enabled = selection.includes(loop.id);
    const soloed = audio.soloLoopIndex === index;
    button.setAttribute('aria-pressed', String(enabled));
    button.setAttribute('aria-label', `${loop.name}, ${enabled ? 'on' : 'off'}, loop length ${time(loop.duration)}`);
    solo.setAttribute('aria-pressed', String(soloed));
    solo.setAttribute('aria-label', soloed ? `Stop soloing ${loop.name}` : `Listen to ${loop.name} only`);
    solo.title = soloed ? `Return to your mix · ${loop.name}` : `Listen to ${loop.name} only`;
    card.classList.toggle('muted', !enabled);
    card.classList.toggle('sounding', loop.active);
    card.classList.toggle('soloed', soloed);
    card.classList.toggle('solo-silenced', audio.soloLoopIndex !== null && !soloed);
    card.style.setProperty('--phase', `${100 * loop.position / loop.duration}%`);
    card.querySelector('.loop-duration').textContent = time(loop.duration);
  });
}

audio.addEventListener('statechange', (event) => {
  if (audio.playing !== previousPlaying) {
    if (audio.playing) startedAt = performance.now();
    else if (startedAt !== null) { elapsed += (performance.now() - startedAt) / 1000; startedAt = null; }
    previousPlaying = audio.playing;
  }
  if (event.detail.error) notify(event.detail.error);
  render();
});

async function togglePlayback() {
  if (busy) return;
  busy = true;
  try { await audio.toggle(); }
  catch (error) { notify(error.message || 'Sound could not start. Please try again.'); }
  finally { busy = false; render(); }
}
$('transport').addEventListener('click', togglePlayback);

function setCount(count) {
  audio.setSoloLoop(null);
  while (selection.length > count) selection.pop();
  for (const id of ids) {
    if (selection.length >= count) break;
    if (!selection.includes(id)) selection.push(id);
  }
  catalogue.forEach((loop, index) => audio.setLoopLevel(index, selection.includes(loop.id) ? 1 : 0));
  render();
  persist();
}
$('loopCount').addEventListener('input', (event) => setCount(Number(event.target.value)));
$('allOn').addEventListener('click', () => setCount(LOOP_COUNT));
$('allOff').addEventListener('click', () => setCount(0));
$('key').addEventListener('change', (event) => {
  settings.key = event.target.value;
  audio.setKey(settings.key);
  render(); persist();
});
$('mode').addEventListener('change', (event) => {
  settings.mode = event.target.value;
  audio.setMusicalMode(settings.mode);
  render(); persist();
});
$('complexity').addEventListener('input', (event) => {
  settings.complexity = Number(event.target.value);
  audio.setHarmonyComplexity(settings.complexity / 100);
  render(); persist();
});
$('volume').addEventListener('input', (event) => {
  settings.volume = Number(event.target.value);
  audio.setVolume(settings.volume * 0.0064);
  render(); persist();
});
$('renew').addEventListener('click', () => {
  audio.rerollLoops();
  render(); persist();
  notify('New lengths. New encounters. Your chosen layers stay.');
});

$('returnToMix').addEventListener('click', () => { audio.setSoloLoop(null); render(); });

$('saveSetup').addEventListener('click', () => {
  const blob = new Blob([`${JSON.stringify(setupSnapshot(), null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = 'loopra-setup.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify('Setup saved. Load it here or share it with another listener.');
});
$('loadSetup').addEventListener('click', () => $('setupFile').click());
$('setupFile').addEventListener('change', async (event) => {
  const file = event.target.files[0]; event.target.value = '';
  if (!file) return;
  try {
    if (file.size > 65536) throw new Error('This file is too large to be a Loopra setup.');
    let value;
    try { value = JSON.parse(await file.text()); }
    catch { throw new Error('This is not a readable Loopra setup file.'); }
    const valid = validateSetup(value);
    applySetup(valid);
    render(); persist();
    notify('Your setup is ready.');
  } catch (error) { notify(error.message); }
});

$('helpButton').addEventListener('click', () => $('about').showModal());
$('closeAbout').addEventListener('click', () => $('about').close());
$('aboutDone').addEventListener('click', () => $('about').close());
$('about').addEventListener('click', (event) => { if (event.target === $('about')) $('about').close(); });
document.addEventListener('keydown', (event) => {
  if (event.code !== 'Space' || event.repeat || event.altKey || event.ctrlKey || event.metaKey || $('about').open) return;
  if (event.target.closest('input, select, textarea, button, a, [contenteditable="true"]')) return;
  event.preventDefault(); togglePlayback();
});
window.addEventListener('pagehide', () => {
  try { localStorage.setItem(storageKey, JSON.stringify(setupSnapshot())); } catch { /* Optional storage. */ }
  audio.stop();
});

function animate(now) {
  if (now - lastFrame > 100) {
    updateLoops();
    $('elapsed').textContent = time(elapsed + (startedAt === null ? 0 : (now - startedAt) / 1000)).padStart(5, '0');
    lastFrame = now;
  }
  requestAnimationFrame(animate);
}
render();
requestAnimationFrame(animate);
