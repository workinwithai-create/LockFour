const CDN = 'https://cdn.jsdelivr.net/gh/workinwithai-create/PreEight@d58301e4a494555f411a2afbc448b724136eee76/public/samples';
const STEPS = 16;
const BASE = 8;
const LOCK = 4;
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.12;

const recipes = [
  { id: 'ghost-hat', name: 'Ghost hat', blurb: 'Hats die on 2 and 4. Ghosts on e and a.' },
  { id: 'snare-ghost', name: 'Snare ghost', blurb: 'Light snare ghosts before the 2 and 4.' },
  { id: 'piano-light', name: 'Piano light', blurb: 'Sparse piano accents, no full chords.' },
  { id: 'nylon-chop', name: 'Nylon chop', blurb: 'Short nylon chops on the off.' },
  { id: 'bass-hold', name: 'Bass hold', blurb: 'Bass pedal. No walk.' }
];

function bar(symbol, piano, guitar, bass) { return { symbol, piano, guitar, bass }; }

const grooves = [
  { id: 'amber', name: 'Amber Walk', bpm: 98, key: 'A minor',
    base: [bar('Am',[45,48,52,57],[45,52,57],33), bar('F',[41,45,48,53],[41,48,53],41), bar('C',[48,52,55,60],[48,52,55],36), bar('G',[43,47,50,55],[43,47,50],31), bar('Am',[45,48,52,57],[45,52,57],33), bar('F',[41,45,48,53],[41,48,53],41), bar('C',[48,52,55,60],[48,52,55],36), bar('G',[43,47,50,55],[43,47,50],31)],
    lock: [bar('Am',[45,48,52,57],[45,52,57],33), bar('F',[41,45,48,53],[41,48,53],41), bar('C',[48,52,55,60],[48,52,55],36), bar('G',[43,47,50,55],[43,47,50],31)] },
  { id: 'porch', name: 'Porch Climb', bpm: 86, key: 'E major',
    base: [bar('E',[40,44,47,52],[40,47,52],28), bar('B',[35,39,42,47],[35,42,47],23), bar('C#m',[44,47,51,56],[44,51,56],32), bar('A',[33,37,40,45],[33,40,45],33), bar('E',[40,44,47,52],[40,47,52],28), bar('B',[35,39,42,47],[35,42,47],23), bar('C#m',[44,47,51,56],[44,51,56],32), bar('A',[33,37,40,45],[33,40,45],33)],
    lock: [bar('A',[33,37,40,45],[33,40,45],33), bar('B',[35,39,42,47],[35,42,47],23), bar('E',[40,44,47,52],[40,47,52],28), bar('E',[40,44,47,52],[40,47,52],28)] }
];

const state = {
  groove: grooves[0],
  recipe: recipes[0],
  playing: false,
  step: 0,
  nextStepTime: 0,
  mode: null,
  bpm: 98,
  key: 'A minor',
  bars: 12
};

let ctx, bus, master, compressor, buffers = {}, rawBuffers = {}, activeSources = [], timerId = null, rafId = null;

async function load() {
  if (ctx) return;
  ctx = new AudioContext();
  bus = ctx.createGain();
  bus.gain.value = 0.4;
  compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -12;
  compressor.knee.value = 6;
  compressor.ratio.value = 8;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.25;
  bus.connect(compressor);
  compressor.connect(ctx.destination);

  const files = [
    ['kick', `${CDN}/drums/kick.mp3`],
    ['snare', `${CDN}/drums/snare.mp3`],
    ['hat', `${CDN}/drums/hihat.mp3`],
    ['pC4', `${CDN}/piano/C4.mp3`],
    ['pA3', `${CDN}/piano/A3.mp3`],
    ['bA1', `${CDN}/bass/A1.mp3`],
    ['gA2', `${CDN}/guitar/A2.mp3`],
    ['tC4', `${CDN}/trumpet/C4.mp3`],
    ['vA3', `${CDN}/violin/A3.mp3`]
  ];
  const missing = [];
  for (const [k, url] of files) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(r.status);
      const ab = await r.arrayBuffer();
      rawBuffers[k] = ab;
      buffers[k] = await ctx.decodeAudioData(ab.slice(0));
    } catch (e) {
      missing.push(k);
      console.warn(k, e);
    }
  }
  const status = document.getElementById('status');
  if (missing.length) {
    status.textContent = `Missing instruments: ${missing.join(', ')}`;
  } else {
    status.textContent = 'Chairs seated · live FluidR3 + kit · tap to start audio';
  }
}

function rateFromMidi(midi, baseMidi) {
  const semitones = midi - baseMidi;
  if (Math.abs(semitones) > 4) return 1; // never pitch more than ±4
  return Math.pow(2, semitones / 12);
}

function chordAt(barIndex) {
  return barIndex < BASE ? state.groove.base[barIndex] : state.groove.lock[barIndex - BASE];
}

function scheduleStep(step, when) {
  const barIndex = Math.floor(step / STEPS);
  const s = step % STEPS;
  const ch = chordAt(barIndex);
  const onLock = barIndex >= BASE;
  const rec = state.recipe.id;
  const stepDur = 60 / state.bpm / 4;

  const play = (name, time, rate = 1, gain = 0.4, sustain = false) => {
    const b = buffers[name];
    if (!b) return;
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(gain, time + 0.01);
    if (sustain) {
      g.gain.setValueAtTime(gain * 0.7, time + stepDur * 0.8);
    }
    g.gain.linearRampToValueAtTime(0, time + stepDur * 0.95);
    src.connect(g);
    g.connect(bus);
    src.start(time);
    src.stop(time + stepDur + 0.05);
    activeSources.push(src);
  };

  // Base kit
  if (s === 0) play('kick', when, 1, 0.7);
  if (s === 8 && !(onLock && rec === 'ghost-hat')) play('snare', when, 1, 0.45);
  if (s % 2 === 0) {
    const hatGain = onLock && rec === 'ghost-hat' ? 0.03 : 0.06;
    play('hat', when, 1, hatGain);
  }

  // Chords on downbeat
  if (s === 0) {
    play('pC4', when, rateFromMidi(ch.piano[2] || 60, 60), onLock && rec === 'piano-light' ? 0.12 : 0.22);
    play('pA3', when, rateFromMidi(ch.piano[1] || 57, 57), 0.18);
    play('bA1', when, rateFromMidi(ch.bass, 33), rec === 'bass-hold' && onLock ? 0.5 : 0.4);
    play('gA2', when, rateFromMidi(ch.guitar[0] || 45, 45), onLock && rec === 'nylon-chop' ? 0.1 : 0.18);
  }

  // Ghosts on lock
  if (onLock) {
    if (rec === 'snare-ghost' && (s === 6 || s === 14)) play('snare', when, 1, 0.08);
    if (rec === 'nylon-chop' && (s === 4 || s === 12)) play('gA2', when, rateFromMidi(ch.guitar[1] || 48, 45), 0.12);
  }
}

function scheduler() {
  while (state.nextStepTime < ctx.currentTime + SCHEDULE_AHEAD) {
    scheduleStep(state.step, state.nextStepTime);
    const stepDur = 60 / state.bpm / 4;
    state.nextStepTime += stepDur;
    state.step = (state.step + 1) % (state.bars * STEPS);
  }
}

function start(mode) {
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume();
  stop();
  state.playing = true;
  state.mode = mode;
  state.step = mode === 'four' ? BASE * STEPS : 0;
  state.bars = mode === 'four' ? LOCK : BASE + LOCK;
  state.nextStepTime = ctx.currentTime + 0.1;
  timerId = setInterval(scheduler, LOOKAHEAD_MS);
  paint();
  rafId = requestAnimationFrame(updatePlayhead);
}

function stop() {
  state.playing = false;
  state.mode = null;
  if (timerId) clearInterval(timerId);
  timerId = null;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  activeSources.forEach(s => { try { s.stop(); } catch (e) {} });
  activeSources = [];
  paint();
}

function updatePlayhead() {
  if (!state.playing) return;
  const elapsed = ctx.currentTime - (state.nextStepTime - (state.step * (60 / state.bpm / 4)));
  // simple bar highlight from currentTime
  paint();
  rafId = requestAnimationFrame(updatePlayhead);
}

function punch() {
  const g = state.groove, r = state.recipe;
  return `LockFour punch list\n${g.name} · ${state.bpm} BPM · ${g.key} · ${r.name}\n\nThe problem: straight loops never lock. Session players add ghosts and accents so the pocket sits.\nThe move: ${r.blurb}\n\nBase (bars 1-8)\n${g.base.map((b,i)=>`  ${i+1}. ${b.symbol}`).join('\n')}\n\nLock (bars 9-12) — ${r.name}\n${g.lock.map((b,i)=>`  ${i+9}. ${b.symbol}`).join('\n')}\n\nLive chairs only. Distinct from TagFour, LiftTwo, PreEight, TightFour, MotionEight.\nDrop the WAV on bars 9-12.`;
}

function paint() {
  document.getElementById('grooves').innerHTML = grooves.map(g => `<button class="card${state.groove.id===g.id?' on':''}" data-id="${g.id}">${g.name}<span>${g.bpm} BPM · ${g.key}</span></button>`).join('');
  document.getElementById('recipes').innerHTML = recipes.map(r => `<button class="card${state.recipe.id===r.id?' on':''}" data-id="${r.id}">${r.name}<span>${r.blurb}</span></button>`).join('');
  document.getElementById('bars').innerHTML = Array.from({length:12}, (_,i) => {
    const ch = chordAt(i);
    const active = state.playing && Math.floor(state.step / STEPS) === i;
    return `<div class="bar${i>=8?' tag':''}${active?' active':''}"><div class="n">${i+1} · ${i>=8?'L':'B'}</div><div class="c">${ch.symbol}</div></div>`;
  }).join('');
  document.getElementById('punch').textContent = punch();
}

// Event wiring
document.getElementById('playA').onclick = () => start('loop');
document.getElementById('playB').onclick = () => start('full');
document.getElementById('play4').onclick = () => start('four');
document.getElementById('stop').onclick = stop;
document.getElementById('copy').onclick = () => navigator.clipboard.writeText(punch());

// Live controls
document.getElementById('grooves').onclick = e => {
  const id = e.target.closest('button')?.dataset.id;
  if (id) { state.groove = grooves.find(g => g.id === id); state.bpm = state.groove.bpm; paint(); }
};
document.getElementById('recipes').onclick = e => {
  const id = e.target.closest('button')?.dataset.id;
  if (id) { state.recipe = recipes.find(r => r.id === id); paint(); }
};

// Lifecycle
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });

// Tap to start
document.body.addEventListener('pointerdown', async () => {
  if (!ctx) await load();
  if (ctx && ctx.state === 'suspended') await ctx.resume();
}, { once: false });

paint();
load();
