// Présence automatique : « absent » après un moment sans activité (pas en appel),
// et activité choisie dans les réglages renvoyée à chaque connexion.

import { createEffect, createRoot, on } from "solid-js";
import { onConnected, sendPresence } from "../gateway/client";
import { settings } from "../store/settings";
import { state } from "../store/state";
import { voice } from "../store/voice";

let lastInput = Date.now();
let autoIdle = false;

const refresh = () => {
  if (state.ready) void sendPresence(state.status, state.customStatus, autoIdle).catch(() => {});
};

export function startPresence() {
  const touch = () => {
    lastInput = Date.now();
    if (autoIdle) {
      autoIdle = false;
      refresh();
    }
  };
  for (const ev of ["mousedown", "keydown", "wheel"]) document.addEventListener(ev, touch, { passive: true, capture: true });
  // Une vérification par minute : aucun coût entre-temps.
  setInterval(() => {
    const minutes = settings.autoIdleMinutes;
    if (!minutes || autoIdle || state.status !== "online" || voice.session) return;
    if (Date.now() - lastInput > minutes * 60_000) {
      autoIdle = true;
      void sendPresence("idle", state.customStatus, true).catch(() => {});
    }
  }, 60_000);
  onConnected(() => settings.activityName.trim() && refresh());
  createRoot(() => createEffect(on(() => [settings.activityName, settings.activityType], refresh, { defer: true })));
}
