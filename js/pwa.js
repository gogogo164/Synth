/*
 * pwa.js — Installation und Offline-Betrieb.
 *
 * Der Service Worker wird registriert, sobald die Seite steht. Bietet der
 * Browser eine Installation an (Chrome, Edge, Android), erscheint eine
 * Schaltfläche; auf iOS gibt es stattdessen einen kurzen Hinweis, weil
 * Safari nur den Weg über „Teilen → Zum Home-Bildschirm“ kennt.
 */

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches
  || window.navigator.standalone === true;

const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Service Worker gibt es nur in sicherem Kontext (https oder localhost)
  if (!window.isSecureContext) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(new URL('sw.js', document.baseURI), { scope: './' })
      .catch((error) => console.warn('Service Worker nicht registriert:', error.message));
  });
}

export function setupInstall(button, hint) {
  if (isStandalone()) return;   // läuft bereits als App

  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    button.hidden = false;
  });

  button.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    button.disabled = true;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    button.disabled = false;
    if (outcome === 'accepted') button.hidden = true;
  });

  window.addEventListener('appinstalled', () => {
    button.hidden = true;
    if (hint) hint.hidden = true;
  });

  // Safari kennt beforeinstallprompt nicht — dort den Weg beschreiben
  if (isIos() && hint) hint.hidden = false;
}
