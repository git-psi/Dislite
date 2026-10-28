// Petits sons de l'interface, synthétisés (aucun fichier audio).
// Le contexte audio est fermé après 2 s de silence : rien ne reste ouvert vers PipeWire.

import { settings } from "../store/settings";

export type Sound = "message" | "mention" | "join" | "leave" | "mute" | "unmute" | "deafen" | "undeafen" | "connected" | "disconnected";

/** Notes (fréquence en Hz, début et durée en secondes). */
const SOUNDS: Record<Sound, [number, number, number][]> = {
  message: [[880, 0, 0.12]],
  mention: [[880, 0, 0.1], [1175, 0.1, 0.16]],
  join: [[523, 0, 0.1], [784, 0.09, 0.14]],
  leave: [[784, 0, 0.1], [523, 0.09, 0.14]],
  mute: [[440, 0, 0.08], [330, 0.07, 0.1]],
  unmute: [[330, 0, 0.08], [440, 0.07, 0.1]],
  deafen: [[392, 0, 0.1], [262, 0.09, 0.14]],
  undeafen: [[262, 0, 0.1], [392, 0.09, 0.14]],
  connected: [[523, 0, 0.09], [659, 0.08, 0.09], [784, 0.16, 0.16]],
  disconnected: [[784, 0, 0.09], [659, 0.08, 0.09], [523, 0.16, 0.16]],
};

let ctx: AudioContext | null = null;
let closeTimer: number | undefined;

export function playSound(name: Sound) {
  if (!settings.sounds || settings.soundVolume <= 0) return;
  try {
    ctx ??= new AudioContext();
  } catch {
    return;
  }
  const t0 = ctx.currentTime + 0.01;
  const peak = 0.12 * settings.soundVolume;
  for (const [freq, start, dur] of SOUNDS[name]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t0 + start);
    gain.gain.linearRampToValueAtTime(peak, t0 + start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0 + start);
    osc.stop(t0 + start + dur + 0.02);
  }
  clearTimeout(closeTimer);
  closeTimer = window.setTimeout(() => {
    void ctx?.close();
    ctx = null;
  }, 2000);
}
