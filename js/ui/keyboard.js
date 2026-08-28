/*
 * keyboard.js — 44-Tasten-Klaviatur (F1–C5) wie beim Model D.
 * Bedienbar mit Maus, Touch und Computertastatur.
 */

const SEMITONE_IN_OCTAVE = [0, 2, 4, 5, 7, 9, 11];
const BLACK = new Set([1, 3, 6, 8, 10]);
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Zwei Oktaven auf der Computertastatur — untere Reihe + obere Reihe
const KEY_MAP = {
  KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6,
  KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11, Comma: 12, KeyL: 13,
  Period: 14, Semicolon: 15, Slash: 16,
  KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18,
  KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23, KeyI: 24, Digit9: 25,
  KeyO: 26, Digit0: 27, KeyP: 28
};

export class Keyboard {
  constructor(el, { startNote = 29, keyCount = 44, onNoteOn, onNoteOff }) {
    this.el = el;
    this.startNote = startNote;
    this.keyCount = keyCount;
    this.onNoteOn = onNoteOn;
    this.onNoteOff = onNoteOff;
    this.octave = 3;            // Basisoktave der Computertastatur
    this.activeNotes = new Map();
    this.pressed = new Set();
    this.pointerDown = false;

    this.build();
    this.bindPointer();
    this.bindComputerKeys();
  }

  build() {
    this.el.classList.add('keyboard');
    this.el.innerHTML = '';
    this.keys = new Map();

    const whiteKeys = [];
    for (let i = 0; i < this.keyCount; i++) {
      const note = this.startNote + i;
      if (!BLACK.has(note % 12)) whiteKeys.push(note);
    }
    const whiteWidth = 100 / whiteKeys.length;

    let whiteIndex = 0;
    for (let i = 0; i < this.keyCount; i++) {
      const note = this.startNote + i;
      const isBlack = BLACK.has(note % 12);
      const key = document.createElement('div');
      key.className = `key ${isBlack ? 'key--black' : 'key--white'}`;
      key.dataset.note = String(note);
      key.title = `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`;

      if (isBlack) {
        key.style.left = `${whiteIndex * whiteWidth - whiteWidth * 0.3}%`;
        key.style.width = `${whiteWidth * 0.6}%`;
      } else {
        key.style.left = `${whiteIndex * whiteWidth}%`;
        key.style.width = `${whiteWidth}%`;
        whiteIndex++;
      }
      this.el.appendChild(key);
      this.keys.set(note, key);
    }
  }

  noteOn(note, source = 'pointer') {
    if (this.activeNotes.has(note)) return;
    this.activeNotes.set(note, source);
    this.keys.get(note)?.classList.add('is-down');
    this.onNoteOn?.(note);
  }

  noteOff(note) {
    if (!this.activeNotes.has(note)) return;
    this.activeNotes.delete(note);
    this.keys.get(note)?.classList.remove('is-down');
    this.onNoteOff?.(note);
  }

  releaseAll() {
    for (const note of [...this.activeNotes.keys()]) this.noteOff(note);
  }

  noteFromEvent(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || !el.classList.contains('key')) return null;
    return parseInt(el.dataset.note, 10);
  }

  bindPointer() {
    const down = (e) => {
      const note = this.noteFromEvent(e);
      if (note === null) return;
      this.pointerDown = true;
      this.lastPointerNote = note;
      this.noteOn(note);
      e.preventDefault();
    };

    const move = (e) => {
      if (!this.pointerDown) return;
      const note = this.noteFromEvent(e);
      if (note === null || note === this.lastPointerNote) return;
      if (this.lastPointerNote !== null) this.noteOff(this.lastPointerNote);
      this.lastPointerNote = note;
      this.noteOn(note);
    };

    const up = () => {
      if (!this.pointerDown) return;
      this.pointerDown = false;
      if (this.lastPointerNote !== null) this.noteOff(this.lastPointerNote);
      this.lastPointerNote = null;
    };

    this.el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  bindComputerKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT')) return;

      if (e.code === 'ArrowLeft') { this.setOctave(this.octave - 1); e.preventDefault(); return; }
      if (e.code === 'ArrowRight') { this.setOctave(this.octave + 1); e.preventDefault(); return; }

      const offset = KEY_MAP[e.code];
      if (offset === undefined) return;
      const note = 12 * this.octave + 12 + offset;
      if (this.pressed.has(e.code)) return;
      this.pressed.add(e.code);
      this.noteOn(note, 'keyboard');
      e.preventDefault();
    });

    window.addEventListener('keyup', (e) => {
      const offset = KEY_MAP[e.code];
      if (offset === undefined) return;
      this.pressed.delete(e.code);
      this.noteOff(12 * this.octave + 12 + offset);
    });

    window.addEventListener('blur', () => {
      this.pressed.clear();
      this.releaseAll();
    });
  }

  setOctave(value) {
    const next = Math.max(0, Math.min(6, value));
    if (next === this.octave) return;
    this.releaseAll();
    this.pressed.clear();
    this.octave = next;
    this.onOctaveChange?.(next);
  }
}
