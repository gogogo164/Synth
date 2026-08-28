/*
 * presets.js — Werkseinstellungen im Geist der klassischen Model-D-Sounds.
 * Jedes Preset überschreibt nur die Abweichungen von den Voreinstellungen.
 */

export const PRESETS = {
  'Fetter Bass': {
    params: { osc1Level: 0.9, osc2Level: 0.75, osc3Level: 0, noiseLevel: 0,
      osc2Tune: -0.08, cutoff: 0.32, emphasis: 0.42, contour: 0.55,
      filterAttack: 0.002, filterDecay: 0.38, filterSustain: 0.1,
      ampAttack: 0.002, ampDecay: 0.4, ampSustain: 0.85, drive: 0.45, glide: 0.1 },
    config: { osc1Wave: 2, osc2Wave: 2, osc1Range: 2, osc2Range: 3, osc2On: true,
      osc3On: false, noiseOn: false, kbTrack1: true, kbTrack2: false, decayOn: true, glideOn: false },
    mode: 'mono'
  },

  'Lead (Emerson)': {
    params: { osc1Level: 0.85, osc2Level: 0.8, osc3Level: 0.6,
      osc2Tune: 0.12, osc3Tune: -0.1, cutoff: 0.62, emphasis: 0.55, contour: 0.4,
      filterAttack: 0.02, filterDecay: 0.8, filterSustain: 0.55,
      ampAttack: 0.01, ampDecay: 0.8, ampSustain: 0.95, drive: 0.5, glide: 0.25 },
    config: { osc1Wave: 2, osc2Wave: 2, osc3Wave: 2, osc1Range: 3, osc2Range: 3, osc3Range: 2,
      osc2On: true, osc3On: true, kbTrack1: true, kbTrack2: true, glideOn: true, decayOn: true },
    mode: 'mono'
  },

  'Bläser': {
    params: { osc1Level: 0.8, osc2Level: 0.7, osc3Level: 0.5,
      osc2Tune: 0.1, osc3Tune: -0.1, cutoff: 0.42, emphasis: 0.18, contour: 0.5,
      filterAttack: 0.08, filterDecay: 0.9, filterSustain: 0.45,
      ampAttack: 0.06, ampDecay: 1.0, ampSustain: 0.9, drive: 0.25 },
    config: { osc1Wave: 4, osc2Wave: 2, osc3Wave: 2, osc1Range: 3, osc2Range: 3, osc3Range: 2,
      osc2On: true, osc3On: true, kbTrack1: true, kbTrack2: true, decayOn: true },
    mode: 'poly'
  },

  'Sub-Bass': {
    params: { osc1Level: 1, osc2Level: 0.5, osc3Level: 0,
      osc2Tune: -12, cutoff: 0.22, emphasis: 0.15, contour: 0.3,
      filterAttack: 0.002, filterDecay: 0.25, filterSustain: 0.05,
      ampAttack: 0.002, ampDecay: 0.35, ampSustain: 0.7, drive: 0.55 },
    config: { osc1Wave: 0, osc2Wave: 3, osc1Range: 2, osc2Range: 2, osc2On: true, kbTrack1: true },
    mode: 'mono'
  },

  'Funk-Zupfer': {
    params: { osc1Level: 0.9, osc2Level: 0.6, osc2Tune: 7,
      cutoff: 0.3, emphasis: 0.72, contour: 0.75,
      filterAttack: 0.002, filterDecay: 0.16, filterSustain: 0,
      ampAttack: 0.002, ampDecay: 0.3, ampSustain: 0.3, drive: 0.4 },
    config: { osc1Wave: 5, osc2Wave: 2, osc1Range: 3, osc2Range: 2, osc2On: true, kbTrack1: true, kbTrack2: true },
    mode: 'mono'
  },

  'Flächen-Sweep': {
    params: { osc1Level: 0.7, osc2Level: 0.7, osc3Level: 0.4, osc2Tune: 0.15, osc3Tune: 7,
      cutoff: 0.25, emphasis: 0.55, contour: 0.65,
      filterAttack: 1.2, filterDecay: 3, filterSustain: 0.5,
      ampAttack: 0.7, ampDecay: 2.5, ampSustain: 0.9, drive: 0.2 },
    config: { osc1Wave: 2, osc2Wave: 1, osc3Wave: 0, osc1Range: 3, osc2Range: 3, osc3Range: 4,
      osc2On: true, osc3On: true, kbTrack1: true, kbTrack2: true, decayOn: true },
    mode: 'poly'
  },

  'Osc-3-Vibrato': {
    params: { osc1Level: 0.85, osc2Level: 0.7, osc2Tune: 0.1, osc3Tune: 0, modMix: 0,
      cutoff: 0.5, emphasis: 0.3, contour: 0.4,
      filterAttack: 0.05, filterDecay: 0.7, filterSustain: 0.5,
      ampAttack: 0.04, ampDecay: 0.7, ampSustain: 0.9 },
    config: { osc1Wave: 2, osc2Wave: 3, osc3Wave: 0, osc3Range: 0, osc3Control: false,
      osc2On: true, osc3On: false, oscMod: true, filterMod: false, kbTrack1: true },
    mode: 'mono'
  },

  'Wind & Rauschen': {
    params: { osc1Level: 0, osc2Level: 0, osc3Level: 0, noiseLevel: 0.9, modMix: 1,
      cutoff: 0.4, emphasis: 0.8, contour: 0.3,
      filterAttack: 0.9, filterDecay: 2, filterSustain: 0.6,
      ampAttack: 0.8, ampDecay: 2, ampSustain: 0.9, drive: 0.2 },
    config: { osc1On: false, osc2On: false, osc3On: false, noiseOn: true, noisePink: true,
      filterMod: true, kbTrack1: false, kbTrack2: false },
    mode: 'poly'
  }
};
