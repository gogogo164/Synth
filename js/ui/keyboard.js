/*
 * keyboard.js — Klaviatur mit Maus-, Mehrfinger- und Computertastatur-Bedienung.
 *
 * Auf großen Bildschirmen zeigt sie die 44 Tasten des Originals (F1–C5).
 * Auf schmalen Geräten wird der Umfang so weit verkleinert, dass eine weiße
 * Taste breit genug für einen Finger bleibt; der sichtbare Ausschnitt lässt
 * sich dann oktavweise verschieben.
 */

const BLACK = new Set([1, 3, 6, 8, 10]);
const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

const MIN_WHITE_KEY = 30;   // Mindestbreite einer weißen Taste in px
const MAX_WHITE_KEYS = 26;  // 26 weiße Tasten = die 44 Tasten des Model D

// Zwei Oktaven auf der Computertastatur — untere Reihe + obere Reihe
const KEY_MAP = {
  KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6,
  KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11, Comma: 12, KeyL: 13,
  Period: 14, Semicolon: 15, Slash: 16,
  KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18,
  KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23, KeyI: 24, Digit9: 25,
  KeyO: 26, Digit0: 27, KeyP: 28
};

function noteName(note) {
  return `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`;
}

export class Keyboard {
  constructor(el, { startNote = 29, onNoteOn, onNoteOff }) {
    this.el = el;
    // 0 bedeutet "noch nichts gebaut" — layout() baut daher immer einmal auf
    this.startNote = 0;
    this.keyCount = 0;
    this.fullStart = startNote;      // Anfang, wenn alle 44 Tasten passen
    this.preferredStart = startNote;
    this.userShifted = false;        // sobald selbst verschoben wurde, gilt die Wahl
    this.onNoteOn = onNoteOn;
    this.onNoteOff = onNoteOff;
    this.octave = 3;                 // Basisoktave der Computertastatur

    // note -> Menge der Auslöser ("p:3" für Zeiger, "k:KeyZ" für Tasten).
    // Erst wenn der letzte Auslöser loslässt, endet der Ton — sonst schneidet
    // ein zweiter Finger auf derselben Taste den ersten Ton ab.
    this.holders = new Map();
    this.pointerNotes = new Map();   // pointerId -> zuletzt gespielte Note

    this.layout();
    this.bindPointer();
    this.bindComputerKeys();

    this.resizeObserver = new ResizeObserver(() => this.layout());
    this.resizeObserver.observe(this.el);
  }

  /* ------------------------------ Aufbau ------------------------------ */

  // Wie viele Tasten passen bei der aktuellen Breite noch mit Finger drauf?
  layout() {
    const width = this.el.clientWidth || 800;
    const whiteKeys = Math.max(7, Math.min(MAX_WHITE_KEYS, Math.floor(width / MIN_WHITE_KEY)));

    // Passt nicht alles, beginnt der Ausschnitt bei C3 statt beim tiefen F1 —
    // dort liegt die brauchbarere Lage zum Spielen.
    if (!this.userShifted) {
      this.preferredStart = whiteKeys >= MAX_WHITE_KEYS ? this.fullStart : 48;
    }

    // Ausschnitt beginnt auf einer weißen Taste und endet auf einer weißen Taste
    let start = this.preferredStart;
    while (BLACK.has(start % 12)) start++;

    let count = 0;
    let white = 0;
    while (white < whiteKeys) {
      if (!BLACK.has((start + count) % 12)) white++;
      count++;
    }
    while (BLACK.has((start + count - 1) % 12)) count--;

    if (start === this.startNote && count === this.keyCount) return;
    this.startNote = start;
    this.keyCount = count;
    this.build();
    this.onRangeChange?.(this.rangeLabel());
  }

  rangeLabel() {
    return `${noteName(this.startNote)}–${noteName(this.startNote + this.keyCount - 1)}`;
  }

  build() {
    this.el.classList.add('keyboard');
    this.el.innerHTML = '';
    this.keys = new Map();

    let whiteTotal = 0;
    for (let i = 0; i < this.keyCount; i++) {
      if (!BLACK.has((this.startNote + i) % 12)) whiteTotal++;
    }
    const whiteWidth = 100 / whiteTotal;

    let whiteIndex = 0;
    for (let i = 0; i < this.keyCount; i++) {
      const note = this.startNote + i;
      const isBlack = BLACK.has(note % 12);
      const key = document.createElement('div');
      key.className = `key ${isBlack ? 'key--black' : 'key--white'}`;
      key.dataset.note = String(note);
      key.title = noteName(note);

      if (isBlack) {
        key.style.left = `${whiteIndex * whiteWidth - whiteWidth * 0.3}%`;
        key.style.width = `${whiteWidth * 0.6}%`;
      } else {
        key.style.left = `${whiteIndex * whiteWidth}%`;
        key.style.width = `${whiteWidth}%`;
        if (note % 12 === 0) {
          const label = document.createElement('span');
          label.className = 'key__name';
          label.textContent = noteName(note);
          key.appendChild(label);
        }
        whiteIndex++;
      }
      this.el.appendChild(key);
      this.keys.set(note, key);
    }

    // Gehaltene Töne nach einem Neuaufbau weiter hervorheben
    for (const note of this.holders.keys()) {
      this.keys.get(note)?.classList.add('is-down');
    }
  }

  // Ausschnitt oktavweise verschieben (Handy) — hält sich im MIDI-Bereich
  shiftRange(octaves) {
    const next = this.preferredStart + octaves * 12;
    if (next < 12 || next + this.keyCount > 120) return;
    this.userShifted = true;
    this.preferredStart = next;
    this.releaseAllPointers();
    this.startNote = 0;       // Neuaufbau erzwingen
    this.layout();
  }

  /* ------------------------------- Töne ------------------------------- */

  noteOn(note, holder) {
    let set = this.holders.get(note);
    if (!set) {
      set = new Set();
      this.holders.set(note, set);
      this.keys.get(note)?.classList.add('is-down');
      this.onNoteOn?.(note);
    }
    set.add(holder);
  }

  noteOff(note, holder) {
    const set = this.holders.get(note);
    if (!set) return;
    set.delete(holder);
    if (set.size > 0) return;
    this.holders.delete(note);
    this.keys.get(note)?.classList.remove('is-down');
    this.onNoteOff?.(note);
  }

  releaseAll() {
    for (const [note, set] of [...this.holders]) {
      for (const holder of [...set]) this.noteOff(note, holder);
    }
    this.pointerNotes.clear();
    this.pressed?.clear();
  }

  releaseAllPointers() {
    for (const [id, note] of [...this.pointerNotes]) {
      this.noteOff(note, `p:${id}`);
      this.pointerNotes.delete(id);
    }
  }

  noteAt(x, y) {
    const el = document.elementFromPoint(x, y);
    const key = el && el.closest ? el.closest('.key') : null;
    return key ? parseInt(key.dataset.note, 10) : null;
  }

  /* ------------------------- Maus und Finger -------------------------- */

  bindPointer() {
    const el = this.el;

    el.addEventListener('pointerdown', (e) => {
      const note = this.noteAt(e.clientX, e.clientY);
      if (note === null) return;
      // Zeiger einfangen: dann kommen auch Bewegungen außerhalb der
      // Klaviatur noch hier an, und jeder Finger wird einzeln verfolgt.
      // Schlägt das fehl, fangen die Fensterereignisse unten den Ton ab —
      // der Klang darf daran auf keinen Fall scheitern.
      try { el.setPointerCapture(e.pointerId); } catch { /* nicht kritisch */ }
      this.pointerNotes.set(e.pointerId, note);
      this.noteOn(note, `p:${e.pointerId}`);
      e.preventDefault();
    });

    el.addEventListener('pointermove', (e) => {
      if (!this.pointerNotes.has(e.pointerId)) return;
      const note = this.noteAt(e.clientX, e.clientY);
      const current = this.pointerNotes.get(e.pointerId);
      if (note === null || note === current) return;
      this.noteOff(current, `p:${e.pointerId}`);
      this.pointerNotes.set(e.pointerId, note);
      this.noteOn(note, `p:${e.pointerId}`);
    });

    const end = (e) => {
      const note = this.pointerNotes.get(e.pointerId);
      if (note === undefined) return;
      this.pointerNotes.delete(e.pointerId);
      this.noteOff(note, `p:${e.pointerId}`);
    };

    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
    // Sicherheitsnetz, falls der Zeiger nicht eingefangen werden konnte und
    // der Finger außerhalb der Klaviatur loslässt
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    // Kontextmenü bei langem Fingerdruck unterdrücken
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /* ------------------------- Computertastatur ------------------------- */

  bindComputerKeys() {
    this.pressed = new Set();

    window.addEventListener('keydown', (e) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT')) return;

      if (e.code === 'ArrowLeft') { this.setOctave(this.octave - 1); e.preventDefault(); return; }
      if (e.code === 'ArrowRight') { this.setOctave(this.octave + 1); e.preventDefault(); return; }

      const offset = KEY_MAP[e.code];
      if (offset === undefined || this.pressed.has(e.code)) return;
      this.pressed.add(e.code);
      this.noteOn(this.noteForKey(offset), `k:${e.code}`);
      e.preventDefault();
    });

    window.addEventListener('keyup', (e) => {
      const offset = KEY_MAP[e.code];
      if (offset === undefined || !this.pressed.has(e.code)) return;
      this.pressed.delete(e.code);
      this.noteOff(this.noteForKey(offset), `k:${e.code}`);
    });

    window.addEventListener('blur', () => this.releaseAll());
  }

  noteForKey(offset) {
    return 12 * this.octave + 12 + offset;
  }

  setOctave(value) {
    const next = Math.max(0, Math.min(7, value));
    if (next === this.octave) return;
    // Erst die klingenden Töne der alten Oktave beenden
    for (const code of [...this.pressed]) {
      this.noteOff(this.noteForKey(KEY_MAP[code]), `k:${code}`);
    }
    this.pressed.clear();
    this.octave = next;
    this.onOctaveChange?.(next);
  }
}
