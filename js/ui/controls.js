/*
 * controls.js — Drehregler, Wahlschalter, Kippschalter und Räder.
 *
 * Alle Elemente werden aus dem Markup heraus "aufgewertet": im HTML steht
 * nur ein <div> mit data-Attributen, das Verhalten kommt von hier.
 */

const ANGLE_RANGE = 150; // Zeiger bewegt sich von -150° bis +150°

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

/* ------------------------------------------------------------------ */
/* Stufenloser Drehregler                                              */
/* ------------------------------------------------------------------ */

export class Knob {
  constructor(el, onChange) {
    this.el = el;
    this.onChange = onChange;
    this.min = parseFloat(el.dataset.min ?? '0');
    this.max = parseFloat(el.dataset.max ?? '10');
    this.curve = el.dataset.curve || 'linear'; // linear | exp
    this.default = parseFloat(el.dataset.default ?? this.min);
    this.unit = el.dataset.unit || '';
    this.value = this.default;

    el.classList.add('knob');
    el.tabIndex = 0;
    el.setAttribute('role', 'slider');
    el.setAttribute('aria-label', el.dataset.label || el.dataset.param || 'Regler');

    el.innerHTML = `
      <div class="knob__scale">${this.buildTicks()}</div>
      <div class="knob__body"><div class="knob__pointer"></div></div>
      <div class="knob__label">${el.dataset.label || ''}</div>
      <div class="knob__readout"></div>`;

    this.body = el.querySelector('.knob__body');
    this.pointer = el.querySelector('.knob__pointer');
    this.readout = el.querySelector('.knob__readout');

    this.bindPointer();
    this.set(this.default, false);
  }

  buildTicks() {
    const count = parseInt(this.el.dataset.ticks || '11', 10);
    let html = '';
    for (let i = 0; i < count; i++) {
      const a = -ANGLE_RANGE + (i / (count - 1)) * ANGLE_RANGE * 2;
      const major = i === 0 || i === count - 1 || (count === 11 && i % 5 === 0);
      html += `<i class="knob__tick${major ? ' is-major' : ''}" style="transform:rotate(${a}deg)"></i>`;
    }
    return html;
  }

  get norm() {
    return (this.value - this.min) / (this.max - this.min);
  }

  set(value, notify = true) {
    this.value = clamp(value, this.min, this.max);
    const n = this.norm;
    this.pointer.style.transform = `rotate(${-ANGLE_RANGE + n * ANGLE_RANGE * 2}deg)`;
    this.readout.textContent = this.format();
    this.el.setAttribute('aria-valuenow', this.value.toFixed(2));
    this.el.setAttribute('aria-valuetext', this.format());
    if (notify && this.onChange) this.onChange(this.scaled(), this);
  }

  // Der an die Engine gereichte Wert — optional exponentiell gespreizt.
  scaled() {
    if (this.curve === 'exp') {
      const lo = parseFloat(this.el.dataset.expMin || '0.001');
      const hi = parseFloat(this.el.dataset.expMax || '10');
      return lo * Math.pow(hi / lo, this.norm);
    }
    return this.value;
  }

  format() {
    if (this.curve === 'exp') {
      const s = this.scaled();
      return s < 1 ? `${Math.round(s * 1000)} ms` : `${s.toFixed(2)} s`;
    }
    const decimals = parseInt(this.el.dataset.decimals ?? '1', 10);
    return `${this.value.toFixed(decimals)}${this.unit}`;
  }

  bindPointer() {
    const el = this.el;
    let startY = 0;
    let startValue = 0;
    let dragging = false;

    const move = (e) => {
      if (!dragging) return;
      const fine = e.shiftKey ? 0.25 : 1;
      const dy = startY - e.clientY;
      const range = this.max - this.min;
      this.set(startValue + (dy / 160) * range * fine);
    };

    const up = () => {
      dragging = false;
      el.classList.remove('is-active');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };

    el.addEventListener('pointerdown', (e) => {
      dragging = true;
      startY = e.clientY;
      startValue = this.value;
      el.classList.add('is-active');
      el.focus();
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      e.preventDefault();
    });

    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const step = (this.max - this.min) / (e.shiftKey ? 200 : 40);
      this.set(this.value - Math.sign(e.deltaY) * step);
    }, { passive: false });

    el.addEventListener('dblclick', () => this.set(this.default));

    el.addEventListener('keydown', (e) => {
      const step = (this.max - this.min) / (e.shiftKey ? 100 : 20);
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') this.set(this.value + step);
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') this.set(this.value - step);
      else if (e.key === 'Home') this.set(this.min);
      else if (e.key === 'End') this.set(this.max);
      else return;
      e.preventDefault();
    });
  }
}

/* ------------------------------------------------------------------ */
/* Rastender Wahlschalter (Fußlage, Wellenform)                        */
/* ------------------------------------------------------------------ */

export class Selector {
  constructor(el, onChange) {
    this.el = el;
    this.onChange = onChange;
    this.steps = (el.dataset.steps || '').split('|');
    this.index = parseInt(el.dataset.default || '0', 10);

    el.classList.add('knob', 'knob--selector');
    el.tabIndex = 0;
    el.setAttribute('role', 'listbox');
    el.setAttribute('aria-label', el.dataset.label || 'Wahlschalter');

    let ticks = '';
    for (let i = 0; i < this.steps.length; i++) {
      const a = -ANGLE_RANGE + (i / (this.steps.length - 1)) * ANGLE_RANGE * 2;
      ticks += `<i class="knob__tick is-major" style="transform:rotate(${a}deg)"></i>`;
    }

    el.innerHTML = `
      <div class="knob__scale">${ticks}</div>
      <div class="knob__body knob__body--selector"><div class="knob__pointer"></div></div>
      <div class="knob__label">${el.dataset.label || ''}</div>
      <div class="knob__readout"></div>`;

    this.pointer = el.querySelector('.knob__pointer');
    this.readout = el.querySelector('.knob__readout');
    this.bind();
    this.set(this.index, false);
  }

  set(index, notify = true) {
    this.index = clamp(index, 0, this.steps.length - 1);
    const n = this.index / (this.steps.length - 1);
    this.pointer.style.transform = `rotate(${-ANGLE_RANGE + n * ANGLE_RANGE * 2}deg)`;
    this.readout.textContent = this.steps[this.index];
    this.el.setAttribute('aria-valuetext', this.steps[this.index]);
    if (notify && this.onChange) this.onChange(this.index, this);
  }

  bind() {
    const el = this.el;
    let startY = 0;
    let startIndex = 0;
    let dragging = false;

    const move = (e) => {
      if (!dragging) return;
      const dy = startY - e.clientY;
      this.set(startIndex + Math.round(dy / 26));
    };
    const up = () => {
      dragging = false;
      el.classList.remove('is-active');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };

    el.addEventListener('pointerdown', (e) => {
      dragging = true;
      startY = e.clientY;
      startIndex = this.index;
      el.classList.add('is-active');
      el.focus();
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      e.preventDefault();
    });

    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.set(this.index - Math.sign(e.deltaY));
    }, { passive: false });

    el.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') this.set(this.index + 1);
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') this.set(this.index - 1);
      else return;
      e.preventDefault();
    });
  }
}

/* ------------------------------------------------------------------ */
/* Kippschalter                                                        */
/* ------------------------------------------------------------------ */

export class Toggle {
  constructor(el, onChange) {
    this.el = el;
    this.onChange = onChange;
    this.value = el.dataset.default === 'on';
    const [off, on] = (el.dataset.states || 'OFF|ON').split('|');

    el.classList.add('toggle');
    el.tabIndex = 0;
    el.setAttribute('role', 'switch');
    el.innerHTML = `
      <span class="toggle__state toggle__state--on">${on}</span>
      <div class="toggle__rocker"><i></i></div>
      <span class="toggle__state toggle__state--off">${off}</span>
      <div class="toggle__label">${el.dataset.label || ''}</div>`;

    el.addEventListener('click', () => this.set(!this.value));
    el.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        this.set(!this.value);
      }
    });
    this.set(this.value, false);
  }

  set(value, notify = true) {
    this.value = value;
    this.el.classList.toggle('is-on', value);
    this.el.setAttribute('aria-checked', String(value));
    if (notify && this.onChange) this.onChange(value, this);
  }
}

/* ------------------------------------------------------------------ */
/* Pitch- und Modulationsrad                                           */
/* ------------------------------------------------------------------ */

export class Wheel {
  constructor(el, onChange) {
    this.el = el;
    this.onChange = onChange;
    this.spring = el.dataset.spring === 'true'; // Pitchrad federt zurück
    this.value = this.spring ? 0.5 : parseFloat(el.dataset.default || '0');

    el.classList.add('wheel');
    el.tabIndex = 0;
    el.setAttribute('role', 'slider');
    el.setAttribute('aria-label', el.dataset.label || 'Rad');
    el.innerHTML = `
      <div class="wheel__track"><div class="wheel__grip"></div></div>
      <div class="wheel__label">${el.dataset.label || ''}</div>`;

    this.grip = el.querySelector('.wheel__grip');
    this.bind();
    this.set(this.value, false);
  }

  set(value, notify = true) {
    this.value = clamp(value, 0, 1);
    this.grip.style.transform = `translateY(${(0.5 - this.value) * 74}px)`;
    this.el.setAttribute('aria-valuenow', this.value.toFixed(2));
    if (notify && this.onChange) this.onChange(this.value, this);
  }

  bind() {
    const el = this.el;
    let startY = 0;
    let startValue = 0;
    let dragging = false;

    const move = (e) => {
      if (!dragging) return;
      this.set(startValue + (startY - e.clientY) / 110);
    };
    const up = () => {
      dragging = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (this.spring) this.springBack();
    };

    el.addEventListener('pointerdown', (e) => {
      dragging = true;
      startY = e.clientY;
      startValue = this.value;
      el.focus();
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      e.preventDefault();
    });

    el.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp') this.set(this.value + 0.05);
      else if (e.key === 'ArrowDown') this.set(this.value - 0.05);
      else return;
      e.preventDefault();
    });
  }

  springBack() {
    const step = () => {
      const delta = 0.5 - this.value;
      if (Math.abs(delta) < 0.002) {
        this.set(0.5);
        return;
      }
      this.set(this.value + delta * 0.25);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}
