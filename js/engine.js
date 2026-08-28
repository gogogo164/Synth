/*
 * engine.js — Audio-Graph, Stimmverwaltung und Parameter-Routing.
 *
 *   Voices (AudioWorklet) -> Summe -> Hall (optional) -> Master -> Ausgang
 */

export const PARAM_DEFAULTS = {
  masterTune: 0,
  pitchBend: 0,
  modWheel: 0,
  modMix: 0,
  glide: 0.2,
  osc2Tune: 0,
  osc3Tune: 0,
  osc1Level: 0.85,
  osc2Level: 0.6,
  osc3Level: 0,
  noiseLevel: 0,
  cutoff: 0.55,
  emphasis: 0.25,
  contour: 0.55,
  filterAttack: 0.005,
  filterDecay: 0.6,
  filterSustain: 0.25,
  ampAttack: 0.005,
  ampDecay: 0.5,
  ampSustain: 0.85,
  drive: 0.3
};

export const CONFIG_DEFAULTS = {
  osc1Wave: 2, osc2Wave: 2, osc3Wave: 2,
  osc1Range: 3, osc2Range: 3, osc3Range: 2,
  osc1On: true, osc2On: true, osc3On: false, noiseOn: false,
  osc3Control: true,
  noisePink: false,
  oscMod: false,
  filterMod: true,
  kbTrack1: true, kbTrack2: false,
  decayOn: true,
  glideOn: false,
  filterOn: true
};

const POLY_VOICES = 6;

class Voice {
  constructor(ctx, destination) {
    this.node = new AudioWorkletNode(ctx, 'minimoog-voice', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1]
    });
    this.node.connect(destination);
    this.note = null;
    this.startedAt = 0;
  }

  send(msg) {
    this.node.port.postMessage(msg);
  }

  param(name) {
    return this.node.parameters.get(name);
  }
}

export class SynthEngine {
  constructor() {
    this.ctx = null;
    this.voices = [];
    this.ready = false;
    this.params = { ...PARAM_DEFAULTS };
    this.config = { ...CONFIG_DEFAULTS };
    this.mode = 'mono';          // 'mono' | 'poly'
    this.heldNotes = [];         // Notenstapel für monophones Spiel
    this.masterVolume = 0.6;
    this.reverbAmount = 0.15;
  }

  async init() {
    if (this.ready) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: 'interactive' });

    if (!this.ctx.audioWorklet) {
      throw new Error('AudioWorklet wird von diesem Browser nicht unterstützt.');
    }
    // Pfad aus dem Modul heraus auflösen: funktioniert auch, wenn die App in
    // einem Unterverzeichnis liegt (GitHub Pages) oder als PWA gestartet wird.
    await this.ctx.audioWorklet.addModule(
      new URL('worklets/voice-processor.js', import.meta.url)
    );

    const ctx = this.ctx;

    this.voiceBus = ctx.createGain();
    this.voiceBus.gain.value = 1;

    // Hall — im Original nicht vorhanden, aber praktisch fürs Vorspielen.
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = this.createImpulse(1.9, 2.6);

    this.master = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;

    this.voiceBus.connect(this.dry);
    this.voiceBus.connect(this.convolver);
    this.convolver.connect(this.wet);
    this.dry.connect(this.master);
    this.wet.connect(this.master);
    this.master.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    for (let i = 0; i < POLY_VOICES; i++) {
      this.voices.push(new Voice(ctx, this.voiceBus));
    }

    this.ready = true;
    this.applyAllParams();
    this.applyConfig();
    this.setMasterVolume(this.masterVolume);
    this.setReverb(this.reverbAmount);
  }

  createImpulse(duration, decay) {
    const rate = this.ctx.sampleRate;
    const length = Math.floor(rate * duration);
    const buffer = this.ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return buffer;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  /* --------------------------- Parameter --------------------------- */

  setParam(name, value) {
    this.params[name] = value;
    if (!this.ready) return;
    for (const v of this.voices) {
      const p = v.param(name);
      if (p) p.setTargetAtTime(value, this.ctx.currentTime, 0.008);
    }
  }

  // Für Wheels: ohne Glättungs-Verzögerung
  setParamImmediate(name, value) {
    this.params[name] = value;
    if (!this.ready) return;
    for (const v of this.voices) {
      const p = v.param(name);
      if (p) p.setTargetAtTime(value, this.ctx.currentTime, 0.002);
    }
  }

  applyAllParams() {
    for (const [name, value] of Object.entries(this.params)) {
      for (const v of this.voices) {
        const p = v.param(name);
        if (p) p.value = value;
      }
    }
  }

  setConfig(key, value) {
    this.config[key] = value;
    this.applyConfig();
  }

  applyConfig() {
    if (!this.ready) return;
    for (const v of this.voices) v.send({ type: 'config', value: this.config });
  }

  setMasterVolume(value) {
    this.masterVolume = value;
    if (this.ready) {
      this.master.gain.setTargetAtTime(value * value, this.ctx.currentTime, 0.02);
    }
  }

  setReverb(amount) {
    this.reverbAmount = amount;
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.wet.gain.setTargetAtTime(amount * 0.9, t, 0.02);
    this.dry.gain.setTargetAtTime(1 - amount * 0.35, t, 0.02);
  }

  setMode(mode) {
    this.mode = mode;
    this.allNotesOff();
  }

  /* ----------------------------- Noten ----------------------------- */

  noteOn(note, velocity = 1) {
    if (!this.ready) return;
    this.resume();

    if (this.mode === 'mono') {
      const legato = this.heldNotes.length > 0;
      this.heldNotes = this.heldNotes.filter((n) => n !== note);
      this.heldNotes.push(note);
      const v = this.voices[0];
      v.send({ type: 'noteOn', note, velocity, legato });
      v.note = note;
      return;
    }

    // Polyphon: freie Stimme suchen, sonst die älteste stehlen
    let voice = this.voices.find((v) => v.note === note)
      || this.voices.find((v) => v.note === null);
    if (!voice) {
      voice = this.voices.reduce((a, b) => (a.startedAt <= b.startedAt ? a : b));
    }
    voice.note = note;
    voice.startedAt = performance.now();
    voice.send({ type: 'noteOn', note, velocity, legato: false });
  }

  noteOff(note) {
    if (!this.ready) return;

    if (this.mode === 'mono') {
      this.heldNotes = this.heldNotes.filter((n) => n !== note);
      const v = this.voices[0];
      if (this.heldNotes.length > 0) {
        // Zurück zur zuletzt noch gehaltenen Taste (Low-/Last-Note-Priorität)
        const prev = this.heldNotes[this.heldNotes.length - 1];
        v.send({ type: 'noteOn', note: prev, velocity: 1, legato: true });
        v.note = prev;
      } else {
        v.send({ type: 'noteOff' });
        v.note = null;
      }
      return;
    }

    for (const v of this.voices) {
      if (v.note === note) {
        v.send({ type: 'noteOff' });
        v.note = null;
      }
    }
  }

  allNotesOff() {
    this.heldNotes = [];
    if (!this.ready) return;
    for (const v of this.voices) {
      v.send({ type: 'panic' });
      v.note = null;
    }
  }

  getWaveform(array) {
    if (!this.ready) return false;
    this.analyser.getByteTimeDomainData(array);
    return true;
  }
}
