/*
 * main.js — verbindet Bedienoberfläche, Presets und Klangerzeugung.
 */

import { SynthEngine, PARAM_DEFAULTS, CONFIG_DEFAULTS } from './engine.js';
import { Knob, Selector, Toggle, Wheel } from './ui/controls.js';
import { Keyboard } from './ui/keyboard.js';
import { PRESETS } from './presets.js';

const engine = new SynthEngine();
const knobs = new Map();      // Parametername -> Knob
const selectors = new Map();  // Konfigurationsschlüssel -> Selector
const toggles = new Map();    // Konfigurationsschlüssel -> Toggle

/* ------------------------------------------------------------------ */
/* Bedienelemente aufbauen                                             */
/* ------------------------------------------------------------------ */

function scaleOf(el) {
  return parseFloat(el.dataset.scale || '1');
}

function buildControls() {
  document.querySelectorAll('[data-control="knob"]').forEach((el) => {
    const param = el.dataset.param;
    const scale = scaleOf(el);
    const knob = new Knob(el, (value) => applyParam(param, value * scale));
    knobs.set(param, knob);
  });

  document.querySelectorAll('[data-control="selector"]').forEach((el) => {
    const key = el.dataset.config;
    selectors.set(key, new Selector(el, (index) => engine.setConfig(key, index)));
  });

  document.querySelectorAll('[data-control="toggle"]').forEach((el) => {
    const key = el.dataset.config;
    toggles.set(key, new Toggle(el, (value) => engine.setConfig(key, value)));
  });

  document.querySelectorAll('[data-control="wheel"]').forEach((el) => {
    const param = el.dataset.param;
    new Wheel(el, (value) => {
      if (param === 'pitchBend') {
        engine.setParamImmediate('pitchBend', (value - 0.5) * 4); // ±2 Halbtöne
      } else {
        engine.setParamImmediate('modWheel', value);
      }
    });
  });
}

function applyParam(param, value) {
  if (param === '__volume') return engine.setMasterVolume(value);
  if (param === '__reverb') return engine.setReverb(value);
  engine.setParam(param, value);
}

/* ------------------------------------------------------------------ */
/* Presets                                                             */
/* ------------------------------------------------------------------ */

// Engine-Wert -> Reglerstellung (Umkehrung von Knob.scaled)
function knobValueFromParam(knob, value) {
  const el = knob.el;
  if (knob.curve === 'exp') {
    const lo = parseFloat(el.dataset.expMin || '0.001');
    const hi = parseFloat(el.dataset.expMax || '10');
    const norm = Math.log(Math.max(value, lo) / lo) / Math.log(hi / lo);
    return knob.min + norm * (knob.max - knob.min);
  }
  return value / scaleOf(el);
}

function loadPreset(name) {
  const preset = PRESETS[name];
  if (!preset) return;

  const params = { ...PARAM_DEFAULTS, ...preset.params };
  const config = { ...CONFIG_DEFAULTS, ...preset.config };

  for (const [param, knob] of knobs) {
    if (param.startsWith('__')) continue;
    if (!(param in params)) continue;
    knob.set(knobValueFromParam(knob, params[param]), false);
    applyParam(param, params[param]);
  }

  for (const [key, selector] of selectors) {
    selector.set(config[key], false);
  }
  for (const [key, toggle] of toggles) {
    toggle.set(Boolean(config[key]), false);
  }

  Object.entries(config).forEach(([key, value]) => { engine.config[key] = value; });
  engine.applyConfig();

  const mode = preset.mode || 'mono';
  document.getElementById('modeSelect').value = mode;
  engine.setMode(mode);
}

function buildPresetList() {
  const select = document.getElementById('presetSelect');
  for (const name of Object.keys(PRESETS)) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  }
  select.addEventListener('change', () => loadPreset(select.value));
}

/* ------------------------------------------------------------------ */
/* Oszilloskop                                                         */
/* ------------------------------------------------------------------ */

function startScope() {
  const canvas = document.getElementById('scope');
  const ctx = canvas.getContext('2d');
  const data = new Uint8Array(1024);

  const draw = () => {
    requestAnimationFrame(draw);
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);
    if (!engine.getWaveform(data)) return;

    ctx.strokeStyle = 'rgba(255, 92, 60, 0.95)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i < width; i++) {
      const v = data[Math.floor((i / width) * data.length)] / 128 - 1;
      const y = height / 2 - v * (height / 2 - 3);
      i === 0 ? ctx.moveTo(i, y) : ctx.lineTo(i, y);
    }
    ctx.stroke();
  };
  draw();
}

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

let keyboard;

function setupKeyboard() {
  keyboard = new Keyboard(document.getElementById('keyboard'), {
    startNote: 29,   // F1
    keyCount: 44,    // bis C5 — wie beim Original
    onNoteOn: (note) => engine.noteOn(note, 1),
    onNoteOff: (note) => engine.noteOff(note)
  });
  keyboard.onOctaveChange = (octave) => {
    document.getElementById('octaveDisplay').textContent = String(octave);
  };
}

async function powerOn() {
  const button = document.getElementById('powerOn');
  button.disabled = true;
  button.textContent = 'Startet …';

  try {
    await engine.init();
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Einschalten';
    const box = document.querySelector('.splash__box');
    const msg = document.createElement('p');
    msg.className = 'splash__error';
    msg.textContent = `Audio konnte nicht gestartet werden: ${error.message} `
      + '(Die Seite muss über http:// oder https:// geladen werden, nicht über file://.)';
    box.appendChild(msg);
    return;
  }

  document.getElementById('splash').hidden = true;
  document.getElementById('synth').hidden = false;
  window.modelD = engine; // für die Konsole: modelD.setParam('cutoff', 0.3)

  buildControls();
  buildPresetList();
  setupKeyboard();
  startScope();
  loadPreset(Object.keys(PRESETS)[0]);

  document.getElementById('modeSelect').addEventListener('change', (e) => {
    engine.setMode(e.target.value);
    keyboard.releaseAll();
  });

  document.getElementById('panic').addEventListener('click', () => {
    keyboard.releaseAll();
    engine.allNotesOff();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      keyboard.releaseAll();
      engine.allNotesOff();
    }
  });
}

document.getElementById('powerOn').addEventListener('click', powerOn);
