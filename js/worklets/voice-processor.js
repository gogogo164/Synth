/*
 * voice-processor.js — Ein kompletter Minimoog-artiger Voice-Renderer.
 *
 * Signalweg (wie im Model D):
 *   3 Oszillatoren + Rauschen -> Mixer -> 24 dB/Okt Ladder-Filter -> VCA
 *
 * Die Oszillatoren sind PolyBLEP-bandbegrenzt, das Filter ist das
 * nichtlineare Ladder-Modell nach Huovilainen (2004) mit 2-fachem
 * Oversampling und tanh-Sättigung in jeder Stufe — daher die typische
 * Selbstoszillation und der weiche Zusammenbruch des Bassanteils bei
 * hoher Resonanz.
 */

const THERMAL = 0.000025; // 1/(2*Vt), Transistor-Modellkonstante
const NOTE_A4 = 69;

function polyBlep(t, dt) {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/* Oszillator                                                          */
/* ------------------------------------------------------------------ */

// 0 = Dreieck, 1 = Dreieck/Säge, 2 = Sägezahn, 3 = Rechteck,
// 4 = Puls breit (25 %), 5 = Puls schmal (12,5 %)
const PULSE_WIDTH = [0.5, 0.5, 0.5, 0.5, 0.25, 0.125];

class Oscillator {
  constructor() {
    this.phase = Math.random();
    this.tri = 0;
    this.drift = 0;
    this.driftTarget = 0;
    this.driftCounter = 0;
  }

  // Langsame, zufällige Verstimmung — analoge Oszillatoren stehen nie ganz still.
  updateDrift(blocks) {
    this.driftCounter -= blocks;
    if (this.driftCounter <= 0) {
      this.driftCounter = 40 + Math.random() * 120;
      this.driftTarget = (Math.random() * 2 - 1);
    }
    this.drift += (this.driftTarget - this.drift) * 0.02;
    return this.drift;
  }

  render(inc, wave) {
    let value;
    const phase = this.phase;

    if (wave === 2 || wave === 1) {
      // Sägezahn (fallend wie beim Original -> hier steigend, klanglich identisch)
      value = 2 * phase - 1 - polyBlep(phase, inc);
      if (wave === 1) {
        // Dreieck/Säge-Hybrid ("shark tooth")
        const t = this.renderTriangle(inc, phase, 0.5);
        value = 0.55 * value + 0.65 * t;
      }
    } else if (wave === 0) {
      value = this.renderTriangle(inc, phase, 0.5);
    } else {
      const width = PULSE_WIDTH[wave];
      value = phase < width ? 1 : -1;
      value += polyBlep(phase, inc);
      let t2 = phase - width;
      if (t2 < 0) t2 += 1;
      value -= polyBlep(t2, inc);
      // Schmale Pulse leiser machen, damit die Lautstärke über die
      // Wellenform-Positionen hinweg halbwegs konstant bleibt.
      if (wave === 4) value *= 0.85;
      if (wave === 5) value *= 0.75;
      value *= 0.75;
    }

    this.phase += inc;
    if (this.phase >= 1) this.phase -= 1;
    return value;
  }

  renderTriangle(inc, phase, width) {
    // Bandbegrenztes Rechteck integrieren -> Dreieck ohne Aliasing.
    let sq = phase < width ? 1 : -1;
    sq += polyBlep(phase, inc);
    let t2 = phase - width;
    if (t2 < 0) t2 += 1;
    sq -= polyBlep(t2, inc);
    this.tri = inc * sq + (1 - inc) * this.tri;
    return this.tri * 4;
  }
}

/* ------------------------------------------------------------------ */
/* Rauschen                                                            */
/* ------------------------------------------------------------------ */

class Noise {
  constructor() {
    this.b = [0, 0, 0, 0, 0, 0, 0];
    this.smooth = 0;
  }

  white() {
    return Math.random() * 2 - 1;
  }

  // Pink-Noise nach Paul Kellet
  pink() {
    const w = this.white();
    const b = this.b;
    b[0] = 0.99886 * b[0] + w * 0.0555179;
    b[1] = 0.99332 * b[1] + w * 0.0750759;
    b[2] = 0.96900 * b[2] + w * 0.1538520;
    b[3] = 0.86650 * b[3] + w * 0.3104856;
    b[4] = 0.55000 * b[4] + w * 0.5329522;
    b[5] = -0.7616 * b[5] - w * 0.0168980;
    const out = (b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + w * 0.5362) * 0.11;
    b[6] = w * 0.115926;
    return out;
  }
}

/* ------------------------------------------------------------------ */
/* Moog-Ladder-Filter (Huovilainen / Lazzarini)                        */
/* ------------------------------------------------------------------ */

class LadderFilter {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.delay = [0, 0, 0, 0, 0, 0];
    this.tanhStage = [0, 0, 0];
    this.tune = 0;
    this.res4 = 0;
  }

  // Koeffizienten einmal pro Block berechnen — spart die teuren exp()-Aufrufe.
  setCoefficients(cutoff, resonance) {
    const fc = Math.max(20, Math.min(cutoff, this.sr * 0.45)) / this.sr;
    const f = fc * 0.5;
    const fc2 = fc * fc;
    const fc3 = fc2 * fc;
    const fcr = 1.8730 * fc3 + 0.4955 * fc2 - 0.6490 * fc + 0.9988;
    const acr = -3.9364 * fc2 + 1.8409 * fc + 0.9968;
    this.tune = (1 - Math.exp(-(2 * Math.PI * f * fcr))) / THERMAL;
    this.res4 = 4 * resonance * acr;
  }

  process(input) {
    const d = this.delay;
    const t = this.tanhStage;
    const tune = this.tune;
    const res4 = this.res4;
    let stage3 = 0;

    for (let j = 0; j < 2; j++) { // 2-faches Oversampling
      let x = input - res4 * d[5];
      d[0] = x = d[0] + tune * (Math.tanh(x * THERMAL) - t[0]);
      t[0] = Math.tanh(d[0] * THERMAL);

      d[1] = d[1] + tune * (t[0] - t[1]);
      t[1] = Math.tanh(d[1] * THERMAL);

      d[2] = d[2] + tune * (t[1] - t[2]);
      t[2] = Math.tanh(d[2] * THERMAL);

      d[3] = d[3] + tune * (t[2] - Math.tanh(d[3] * THERMAL));
      stage3 = d[3];

      // halbes Sample Verzögerung zur Phasenkompensation der Rückkopplung
      d[5] = (stage3 + d[4]) * 0.5;
      d[4] = stage3;
    }
    return d[5];
  }
}

/* ------------------------------------------------------------------ */
/* Hüllkurve (analoges ADS / Decay-als-Release)                        */
/* ------------------------------------------------------------------ */

class Envelope {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.value = 0;
    this.attacking = false;
    this.gate = false;
  }

  trigger() {
    this.gate = true;
    this.attacking = true;
  }

  release() {
    this.gate = false;
    this.attacking = false;
  }

  process(attack, decay, sustain, release) {
    if (this.gate) {
      if (this.attacking) {
        // Ziel über 1.0 hinaus -> knackiger, "analoger" Attack
        const coef = 1 - Math.exp(-2.2 / (Math.max(attack, 0.0005) * this.sr));
        this.value += (1.25 - this.value) * coef;
        if (this.value >= 1) {
          this.value = 1;
          this.attacking = false;
        }
      } else {
        const coef = 1 - Math.exp(-4.6 / (Math.max(decay, 0.0005) * this.sr));
        this.value += (sustain - this.value) * coef;
      }
    } else {
      const coef = 1 - Math.exp(-4.6 / (Math.max(release, 0.0005) * this.sr));
      this.value += -this.value * coef;
      if (this.value < 1e-5) this.value = 0;
    }
    return this.value;
  }

  get isIdle() {
    return !this.gate && this.value === 0;
  }
}

/* ------------------------------------------------------------------ */
/* Voice                                                               */
/* ------------------------------------------------------------------ */

const FOOTAGE = [-36, -24, -12, 0, 12, 24]; // LO, 32', 16', 8', 4', 2'

class VoiceProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'masterTune', defaultValue: 0, minValue: -12, maxValue: 12, automationRate: 'k-rate' },
      { name: 'pitchBend', defaultValue: 0, minValue: -12, maxValue: 12, automationRate: 'k-rate' },
      { name: 'modWheel', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'modMix', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'glide', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },

      { name: 'osc2Tune', defaultValue: 0, minValue: -12, maxValue: 12, automationRate: 'k-rate' },
      { name: 'osc3Tune', defaultValue: 0, minValue: -12, maxValue: 12, automationRate: 'k-rate' },

      { name: 'osc1Level', defaultValue: 0.8, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'osc2Level', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'osc3Level', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'noiseLevel', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },

      { name: 'cutoff', defaultValue: 0.7, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'emphasis', defaultValue: 0.2, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'contour', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },

      { name: 'filterAttack', defaultValue: 0.005, minValue: 0.0005, maxValue: 20, automationRate: 'k-rate' },
      { name: 'filterDecay', defaultValue: 0.5, minValue: 0.0005, maxValue: 20, automationRate: 'k-rate' },
      { name: 'filterSustain', defaultValue: 0.3, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'ampAttack', defaultValue: 0.005, minValue: 0.0005, maxValue: 20, automationRate: 'k-rate' },
      { name: 'ampDecay', defaultValue: 0.4, minValue: 0.0005, maxValue: 20, automationRate: 'k-rate' },
      { name: 'ampSustain', defaultValue: 0.8, minValue: 0, maxValue: 1, automationRate: 'k-rate' },

      { name: 'drive', defaultValue: 0.3, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;

    this.osc = [new Oscillator(), new Oscillator(), new Oscillator()];
    this.noise = new Noise();
    this.filter = new LadderFilter(this.sr);
    this.filterEnv = new Envelope(this.sr);
    this.ampEnv = new Envelope(this.sr);

    // Schalterzustände (kommen per Message, nicht als AudioParam)
    this.cfg = {
      osc1Wave: 2, osc2Wave: 2, osc3Wave: 2,
      osc1Range: 3, osc2Range: 3, osc3Range: 3,
      osc1On: true, osc2On: false, osc3On: false, noiseOn: false,
      osc3Control: true,   // Osc 3 folgt der Klaviatur
      noisePink: false,
      oscMod: false,       // Modulation auf die Oszillator-Tonhöhe
      filterMod: true,     // Modulation auf die Filterfrequenz
      kbTrack1: false, kbTrack2: false,
      decayOn: true,       // Decay-Schalter: Release = Decay
      glideOn: false,
      filterOn: true
    };

    this.note = 60;
    this.pitch = 60;      // aktuelle (geglittene) Tonhöhe in Halbtönen
    this.targetPitch = 60;
    this.active = false;
    this.velocity = 1;
    this.noiseMod = 0;

    this.port.onmessage = (e) => this.handleMessage(e.data);
  }

  handleMessage(msg) {
    switch (msg.type) {
      case 'noteOn':
        this.targetPitch = msg.note;
        if (!this.active || !this.cfg.glideOn) {
          if (!this.active) this.pitch = msg.note;
        }
        this.note = msg.note;
        this.velocity = msg.velocity == null ? 1 : msg.velocity;
        this.active = true;
        if (!msg.legato) {
          this.filterEnv.trigger();
          this.ampEnv.trigger();
        } else {
          this.filterEnv.gate = true;
          this.ampEnv.gate = true;
        }
        break;
      case 'noteOff':
        this.filterEnv.release();
        this.ampEnv.release();
        this.active = false;
        break;
      case 'config':
        Object.assign(this.cfg, msg.value);
        break;
      case 'panic':
        this.filterEnv.release();
        this.ampEnv.release();
        this.filterEnv.value = 0;
        this.ampEnv.value = 0;
        this.active = false;
        break;
    }
  }

  process(_inputs, outputs, params) {
    const out = outputs[0][0];
    if (!out) return true;

    const cfg = this.cfg;
    const k = (p) => p[0];

    const masterTune = k(params.masterTune);
    const bend = k(params.pitchBend);
    const modWheel = k(params.modWheel);
    const modMix = k(params.modMix);
    const glideAmount = k(params.glide);

    const lvl1 = cfg.osc1On ? k(params.osc1Level) : 0;
    const lvl2 = cfg.osc2On ? k(params.osc2Level) : 0;
    const lvl3 = cfg.osc3On ? k(params.osc3Level) : 0;
    const lvlN = cfg.noiseOn ? k(params.noiseLevel) : 0;

    const emphasis = k(params.emphasis);
    const contour = k(params.contour);
    const drive = k(params.drive);

    const fA = k(params.filterAttack), fD = k(params.filterDecay), fS = k(params.filterSustain);
    const aA = k(params.ampAttack), aD = k(params.ampDecay), aS = k(params.ampSustain);
    const fR = cfg.decayOn ? fD : 0.005;
    const aR = cfg.decayOn ? aD : 0.005;

    // Glide: Zeitkonstante von ca. 2 ms bis 5 s
    const glideTime = cfg.glideOn ? 0.002 + glideAmount * glideAmount * 5 : 0;
    const glideCoef = glideTime > 0
      ? 1 - Math.exp(-1 / (glideTime * this.sr / 128))
      : 1;
    this.pitch += (this.targetPitch - this.pitch) * Math.min(1, glideCoef);

    // Drift pro Block aktualisieren
    const drift0 = this.osc[0].updateDrift(1) * 0.02;
    const drift1 = this.osc[1].updateDrift(1) * 0.03;
    const drift2 = this.osc[2].updateDrift(1) * 0.03;

    // Osc 3 als Modulationsquelle: läuft immer mit
    const basePitch = this.pitch + masterTune + bend;
    const osc3Pitch = (cfg.osc3Control ? basePitch : 36 + masterTune)
      + k(params.osc3Tune) + FOOTAGE[cfg.osc3Range] + drift2;

    const inc1 = this.freqToInc(basePitch + FOOTAGE[cfg.osc1Range] + drift0);
    const inc2 = this.freqToInc(basePitch + k(params.osc2Tune) + FOOTAGE[cfg.osc2Range] + drift1);
    const inc3 = this.freqToInc(osc3Pitch);

    // Cutoff: 20 Hz ... 16 kHz logarithmisch, Tastatur-Tracking wie im Original
    const kbAmount = (cfg.kbTrack1 ? 1 / 3 : 0) + (cfg.kbTrack2 ? 2 / 3 : 0);
    const kbOffset = (this.pitch - 60) * kbAmount;
    const baseCutoffSemi = 20 + k(params.cutoff) * 100; // in Halbtönen über 20 Hz

    const cutoffOn = cfg.filterOn;

    for (let i = 0; i < out.length; i++) {
      const o1 = this.osc[0].render(inc1, cfg.osc1Wave);
      const o2 = this.osc[1].render(inc2, cfg.osc2Wave);
      const o3 = this.osc[2].render(inc3, cfg.osc3Wave);
      const n = cfg.noisePink ? this.noise.pink() : this.noise.white();

      // Modulationsquelle: Überblendung Osc 3 <-> Rauschen (geglättet)
      this.noiseMod += (n - this.noiseMod) * 0.02;
      const modSource = o3 * (1 - modMix) + this.noiseMod * modMix;
      const mod = modSource * modWheel;

      let mix = o1 * lvl1 + o2 * lvl2 + o3 * lvl3 + n * lvlN * 0.7;
      mix *= 1 + drive * 1.5;

      if (cutoffOn) {
        if (i === 0 || (i & 15) === 0) {
          const env = this.filterEnv.value;
          const semi = baseCutoffSemi
            + kbOffset
            + contour * env * 60
            + (cfg.filterMod ? mod * 36 : 0);
          const hz = 20 * Math.pow(2, semi / 12);
          this.filter.setCoefficients(hz, emphasis * 1.05);
        }
        mix = this.filter.process(mix);
      }

      this.filterEnv.process(fA, fD, fS, fR);
      const amp = this.ampEnv.process(aA, aD, aS, aR);

      // Ausgangsstufe: sanfte Sättigung wie beim Ausgangsverstärker
      let v = mix * amp * this.velocity;
      v = Math.tanh(v * (1 + drive * 2)) * 0.8;
      out[i] = v;

      if (cfg.oscMod && mod !== 0) {
        // Tonhöhen-Modulation wirkt blockweise (siehe inc-Berechnung oben),
        // hier nur ein leichter, sample-genauer Vibrato-Anteil auf Osc 1/2.
        this.osc[0].phase += inc1 * mod * 0.06;
        this.osc[1].phase += inc2 * mod * 0.06;
        if (this.osc[0].phase >= 1) this.osc[0].phase -= 1;
        if (this.osc[1].phase >= 1) this.osc[1].phase -= 1;
      }
    }

    return true;
  }

  freqToInc(semitones) {
    const f = 440 * Math.pow(2, (semitones - NOTE_A4) / 12);
    return Math.min(0.45, Math.max(f, 0.01) / this.sr);
  }
}

registerProcessor('minimoog-voice', VoiceProcessor);
