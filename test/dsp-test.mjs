/*
 * Prüft den Worklet-DSP außerhalb des Browsers: die AudioWorklet-Globals
 * werden gestubbt, danach wird der Prozessor blockweise gerendert.
 *
 *   node test/dsp-test.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const SR = 48000;
const BLOCK = 128;

let registered = null;
const sandbox = {
  sampleRate: SR,
  currentTime: 0,
  Math, Object, Array, Float32Array, console,
  AudioWorkletProcessor: class {
    constructor() { this.port = { postMessage() {}, onmessage: null }; }
  },
  registerProcessor(name, ctor) { registered = ctor; }
};
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(here, '../js/worklets/voice-processor.js'), 'utf8'), sandbox);

function makeVoice(config = {}, params = {}) {
  const voice = new registered();
  const descriptors = registered.parameterDescriptors;
  const p = {};
  for (const d of descriptors) p[d.name] = [params[d.name] ?? d.defaultValue];
  voice.port.onmessage({ data: { type: 'config', value: config } });
  return { voice, p };
}

function render(voice, p, blocks) {
  const out = new Float32Array(blocks * BLOCK);
  const buf = [[new Float32Array(BLOCK)]];
  for (let b = 0; b < blocks; b++) {
    buf[0][0].fill(0);
    voice.process([], buf, p);
    out.set(buf[0][0], b * BLOCK);
  }
  return out;
}

function stats(buf) {
  let peak = 0, sum = 0, bad = 0;
  for (const v of buf) {
    if (!Number.isFinite(v)) bad++;
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sum += v * v;
  }
  return { peak, rms: Math.sqrt(sum / buf.length), bad };
}

// Nulldurchgänge -> grobe Frequenzschätzung
function estimateFrequency(buf) {
  let crossings = 0;
  for (let i = 1; i < buf.length; i++) {
    if (buf[i - 1] <= 0 && buf[i] > 0) crossings++;
  }
  return crossings / (buf.length / SR);
}

let failures = 0;
function check(name, condition, detail = '') {
  const mark = condition ? '  ok  ' : ' FAIL ';
  if (!condition) failures++;
  console.log(`[${mark}] ${name}${detail ? ` — ${detail}` : ''}`);
}

/* ---------------------------------------------------------------- */

console.log('\nDSP-Prüfung des Model-D-Worklets\n');

// 1. Sägezahn auf A4 (Note 69), Filter weit offen
{
  const { voice, p } = makeVoice(
    { osc1Wave: 2, osc1On: true, osc2On: false, filterOn: true, kbTrack1: false, kbTrack2: false },
    { cutoff: 1, emphasis: 0, contour: 0, ampAttack: 0.001, ampSustain: 1, osc1Level: 0.8 }
  );
  voice.port.onmessage({ data: { type: 'noteOn', note: 69, velocity: 1 } });
  const buf = render(voice, p, 400);
  const tail = buf.subarray(buf.length / 2);
  const s = stats(tail);
  const f = estimateFrequency(tail);
  check('Ausgang ist endlich (keine NaN/Infinity)', s.bad === 0, `${s.bad} ungültige Werte`);
  check('Ausgang schwingt', s.rms > 0.02, `RMS ${s.rms.toFixed(3)}`);
  check('Kein Übersteuern über 1.0', s.peak <= 1.0, `Spitze ${s.peak.toFixed(3)}`);
  check('Tonhöhe ≈ 440 Hz', Math.abs(f - 440) < 20, `gemessen ${f.toFixed(1)} Hz`);
}

// 2. Alle Wellenformen und Fußlagen durchlaufen
{
  let allFinite = true, allSounding = true;
  for (let wave = 0; wave < 6; wave++) {
    for (let range = 1; range < 6; range++) {
      const { voice, p } = makeVoice(
        { osc1Wave: wave, osc1Range: range, osc1On: true, osc2On: false },
        { cutoff: 1, emphasis: 0, contour: 0, ampAttack: 0.001, ampSustain: 1, osc1Level: 0.8 }
      );
      voice.port.onmessage({ data: { type: 'noteOn', note: 60, velocity: 1 } });
      const s = stats(render(voice, p, 200).subarray(12800));
      if (s.bad > 0) allFinite = false;
      if (s.rms < 0.01) { allSounding = false; console.log(`   leise: Welle ${wave}, Lage ${range}, RMS ${s.rms.toFixed(4)}`); }
    }
  }
  check('Alle Wellenform/Fußlagen-Kombinationen endlich', allFinite);
  check('Alle Wellenform/Fußlagen-Kombinationen klingen', allSounding);
}

// 3. Selbstoszillation des Filters bei hoher Resonanz ohne Oszillatoren
{
  const { voice, p } = makeVoice(
    { osc1On: false, osc2On: false, osc3On: false, noiseOn: true, filterOn: true, kbTrack1: false, kbTrack2: false },
    { cutoff: 0.5, emphasis: 1, contour: 0, noiseLevel: 0.02, ampAttack: 0.001, ampSustain: 1 }
  );
  voice.port.onmessage({ data: { type: 'noteOn', note: 60, velocity: 1 } });
  const buf = render(voice, p, 500);
  const s = stats(buf.subarray(buf.length / 2));
  check('Filter schwingt bei voller Emphasis selbst', s.rms > 0.05, `RMS ${s.rms.toFixed(3)}`);
  check('Selbstoszillation bleibt stabil', s.bad === 0 && s.peak <= 1.0, `Spitze ${s.peak.toFixed(3)}`);
}

// 4. Hüllkurve: nach noteOff wird es still
{
  const { voice, p } = makeVoice(
    { osc1On: true, decayOn: true },
    { ampAttack: 0.001, ampDecay: 0.05, ampSustain: 0.8, cutoff: 1, contour: 0 }
  );
  voice.port.onmessage({ data: { type: 'noteOn', note: 60, velocity: 1 } });
  render(voice, p, 100);
  voice.port.onmessage({ data: { type: 'noteOff' } });
  const after = stats(render(voice, p, 200).subarray(12800));
  check('Nach Loslassen ist der Ausgang still', after.rms < 0.001, `RMS ${after.rms.toExponential(2)}`);
}

// 5. Sehr hohe Noten dürfen nicht durchdrehen (Nyquist-Grenze)
{
  const { voice, p } = makeVoice(
    { osc1On: true, osc1Range: 5, osc1Wave: 2 },
    { cutoff: 1, emphasis: 0.5, ampAttack: 0.001, ampSustain: 1, osc1Level: 1 }
  );
  voice.port.onmessage({ data: { type: 'noteOn', note: 108, velocity: 1 } });
  const s = stats(render(voice, p, 200));
  check('Extrem hohe Noten bleiben stabil', s.bad === 0 && s.peak <= 1.0, `Spitze ${s.peak.toFixed(3)}`);
}

console.log(failures === 0
  ? '\nAlle Prüfungen bestanden.\n'
  : `\n${failures} Prüfung(en) fehlgeschlagen.\n`);
process.exit(failures === 0 ? 0 : 1);
